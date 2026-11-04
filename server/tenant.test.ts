import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Server } from "node:http";
import { PGlite } from "@electric-sql/pglite";
import { telegramAccount } from "./tenant-auth.js";
import { tenantDb, type TenantJob } from "./tenant-store.js";
import { processTenantJob, tenantWebhook } from "./tenant-agent.js";
vi.mock("./ai.js", () => ({ generateReply: vi.fn(async () => "Test reply"), isAiConfigured: () => true, getAiProviderLabel: () => "test" }));
import { generateReply } from "./ai.js";
const token="test-bot-token";
function signed(id:number,date=Math.floor(Date.now()/1000)) {
  const p=new URLSearchParams({auth_date:String(date),user:JSON.stringify({id,first_name:"Test"})});
  const check=[...p.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join("\n");
  const key=createHmac("sha256","WebAppData").update(token).digest();
  p.set("hash",createHmac("sha256",key).update(check).digest("hex"));return p.toString();
}
const nativeFetch=globalThis.fetch;
let db:PGlite, server:Server, base:string;
let sent:Record<string,unknown>[]=[], revoked=false, brokenStorage=false, uncertainSend=false;
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json"}});
const ident=(s:string)=>{if(!/^[a-z_][a-z0-9_]*$/.test(s))throw new Error("Bad test identifier");return '"'+s+'"';};
async function sqlRest(url:URL,init:RequestInit) {
  const name=url.pathname.replace("/rest/v1/","");
  const data=init.body?JSON.parse(String(init.body)):{};
  if(name.startsWith("rpc/")) {
    const fn=name.slice(4),keys=Object.keys(data);
    const rows=(await db.query(`select * from ${ident(fn)}(${keys.map((k,i)=>`${ident(k)} => $${i+1}`).join(",")})`,Object.values(data))).rows as Record<string,unknown>[];
    return fn==="tenant_claim_job"?rows:rows[0]?.[fn]??null;
  }
  const values:unknown[]=[],where:string[]=[];
  const bind=(v:unknown)=>{values.push(v);return "$"+values.length;};
  let set="";
  if(init.method==="PATCH") set=Object.entries(data).map(([k,v])=>`${ident(k)}=${bind(v)}`).join(",");
  for(const [key,val] of url.searchParams) {
    if(["select","order","limit","offset"].includes(key))continue;
    if(val.startsWith("eq."))where.push(`${ident(key)}=${bind(val.slice(3))}`);
    else if(val==="not.is.null")where.push(`${ident(key)} is not null`);
    else if(val.startsWith("in.("))where.push(`${ident(key)} in (${val.slice(4,-1).split(",").map(bind).join(",")})`);
    else throw new Error("Unsupported test filter "+val);
  }
  const filter=where.length?" where "+where.join(" and "):"";
  let query:string;
  if(init.method==="POST") {
    const keys=Object.keys(data);values.length=0;
    query=`insert into ${ident(name)}(${keys.map(ident).join(",")}) values(${Object.values(data).map(bind).join(",")}) returning *`;
  } else if(init.method==="PATCH")query=`update ${ident(name)} set ${set}${filter} returning *`;
  else if(init.method==="DELETE")query=`delete from ${ident(name)}${filter} returning *`;
  else {
    const select=url.searchParams.get("select");
    query=`select ${select?select.split(",").map(ident).join(","):"*"} from ${ident(name)}${filter}`;
    const order=url.searchParams.get("order");
    if(order) query+=" order by "+order.split(",").map(v=>{const[k,d]=v.split(".");return ident(k)+(d==="desc"?" desc":" asc");}).join(",");
    query+=` limit ${Number(url.searchParams.get("limit")||1000)} offset ${Number(url.searchParams.get("offset")||0)}`;
  }
  return (await db.query(query,values)).rows;
}
async function request(path:string,who=1,method="GET",body?:unknown,extra:Record<string,string>={}) {
  return nativeFetch(base+"/api/user"+path,{method,headers:{"x-telegram-init-data":signed(who),"content-type":"application/json",...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});
}
async function connect(id:number,enabled=true) {
  await tenantDb("rpc/tenant_connect","POST",{p_owner:String(id),p_connection:"c"+id,p_enabled:true,p_reply:true});
  if(enabled) await db.query("update tenant_accounts set enabled=true,consent_at=now(),tone=$1 where owner_id=$2",["tone-"+id,String(id)]);
}
async function ingest(owner:number,update:string,chat="42") {
  await tenantDb("rpc/tenant_ingest","POST",{p_update:update,p_connection:"c"+owner,p_chat:chat,p_text:"private-for-"+owner,p_telegram:Number(update.replace(/\D/g,""))||1});
  await db.exec("update tenant_jobs set available_at=now()-interval '1 second'");
}
async function claim(){return (await tenantDb<TenantJob[]>("rpc/tenant_claim_job","POST",{}))[0];}

beforeAll(async()=>{
  vi.stubEnv("TELEGRAM_BOT_TOKEN",token);vi.stubEnv("TELEGRAM_WEBHOOK_SECRET","webhook-secret");vi.stubEnv("MULTI_USER_ENABLED","true");vi.stubEnv("VERCEL","1");
  vi.stubEnv("SUPABASE_URL","https://tenant-storage.test");vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY","test-only");vi.stubEnv("CRON_SECRET","x".repeat(40));vi.stubEnv("APP_BASE_URL","https://app.test");
  db=new PGlite();await db.exec("create role anon;create role authenticated;create role service_role;");
  await db.exec(await readFile("supabase/migrations/20261104010000_multi_user_agent.sql","utf8"));
  vi.stubGlobal("fetch",vi.fn(async(input:string|URL|Request,init:RequestInit={})=>{
    const url=new URL(String(input));
    if(url.hostname==="tenant-storage.test") {
      if(brokenStorage)return json({},503);
      return json(await sqlRest(url,init));
    }
    if(url.hostname!=="api.telegram.org")throw new Error("Unexpected external request");
    const payload=JSON.parse(String(init.body));
    if(url.pathname.endsWith("getBusinessConnection"))return json({ok:true,result:{id:payload.business_connection_id,user:{id:Number(payload.business_connection_id.slice(1))},is_enabled:!revoked,rights:{can_reply:!revoked}}});
    if(url.pathname.endsWith("answerCallbackQuery")) return json({ok:true,result:true});
    if(url.pathname.endsWith("sendMessage")){
      sent.push(payload);if(uncertainSend)throw new Error("Network timeout");return json({ok:true,result:{message_id:101}});
    }
    throw new Error("Unexpected Telegram method");
  }));
  const {default:app}=await import("./index.js");server=app.listen(0,"127.0.0.1");await new Promise<void>(resolve=>server.once("listening",resolve));const addr=server.address();if(!addr||typeof addr==="string")throw new Error("Missing port");base=`http://127.0.0.1:${addr.port}`;
},30000);
beforeEach(async()=>{
  await db.exec("truncate tenant_accounts,tenant_connections,tenant_conversations,tenant_messages,tenant_jobs,tenant_daily_usage,tenant_control_updates cascade");
  sent=[];revoked=brokenStorage=uncertainSend=false;vi.mocked(generateReply).mockReset().mockResolvedValue("Test reply");
});
afterAll(async()=>{if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));if(db)await db.close();vi.unstubAllGlobals();vi.unstubAllEnvs();});

describe("multi-user account boundary",()=>{
  it("accepts fresh signed identity; rejects tampering, duplicate fields, expiry and future timestamps",()=>{
    expect(telegramAccount(signed(1),token)).toBe("1");
    expect(telegramAccount(signed(1).replace("Test","Other"),token)).toBeNull();
    expect(telegramAccount(signed(1)+"&auth_date=1",token)).toBeNull();
    expect(telegramAccount(signed(1,1),token)).toBeNull();
    expect(telegramAccount(signed(1,Math.floor(Date.now()/1000)+100),token)).toBeNull();
    expect(telegramAccount(signed(1),"other-token")).toBeNull();
  });
  it("requires signed login rather than a user ID or admin token",async()=>{
    const r=await nativeFetch(base+"/api/user/me",{headers:{"x-dashboard-token":"anything","x-owner-id":"1"}});expect(r.status).toBe(401);
  });
  it("creates 60 isolated accounts without adding them to the global owner list",async()=>{
    for(let n=1;n<=60;n++){await connect(n);await ingest(n,String(n));}
    for(const n of [1,30,60]){
      const profile=await(await request("/me",n)).json();expect(profile.account.owner_id).toBe(String(n));expect(profile.connections.map((c:{id:string})=>c.id)).toEqual(["c"+n]);
      const inbox=await(await request("/inbox",n)).json();expect(inbox.conversations).toHaveLength(1);expect(inbox.conversations[0].owner_id).toBe(String(n));
    }
    expect((await db.query("select * from tenant_jobs")).rows).toHaveLength(60);
  });
  it("cannot read, reply to, or clear another user's conversation, even when chat IDs match",async()=>{
    await connect(1);await connect(2);await ingest(1,"1");await ingest(2,"2");
    const other=await(await request("/messages?connection=c2&chat=42",1)).json();expect(other.messages).toEqual([]);
    expect((await request("/reply",1,"POST",{connection:"c2",chat:"42",text:"no"})).status).toBe(404);
    expect((await request("/history",1,"DELETE")).status).toBe(400);
    expect((await request("/history",1,"DELETE",undefined,{"x-confirm-inbox-cleanup":"DELETE_STORED_COPIES_ONLY"})).status).toBe(200);
    expect((await db.query("select * from tenant_messages where owner_id='2'")).rows).toHaveLength(1);
    expect((await db.query("select * from tenant_conversations where owner_id='1'")).rows).toHaveLength(1);expect(sent).toEqual([]);
  });
  it("does not permit connection ownership to be reassigned",async()=>{
    await connect(1);await expect(tenantDb("rpc/tenant_connect","POST",{p_owner:"2",p_connection:"c1",p_enabled:true,p_reply:true})).rejects.toThrow();
    expect((await db.query<{owner_id:string}>("select owner_id from tenant_connections where id='c1'")).rows[0].owner_id).toBe("1");
  });
  it("does not store or queue private text before consent; deduplicates after consent",async()=>{
    await connect(1,false);await ingest(1,"1");expect((await db.query("select * from tenant_messages")).rows).toHaveLength(0);
    await connect(1);await ingest(1,"1");await ingest(1,"1");expect((await db.query("select * from tenant_messages")).rows).toHaveLength(1);
  });
  it("uses only the tenant's settings and thread when generating and delivering",async()=>{
    await connect(1);await connect(2);await ingest(1,"1");await ingest(2,"2");
    const job=await claim();await processTenantJob(job);
    expect(generateReply).toHaveBeenCalledWith(expect.objectContaining({incomingText:"private-for-1",tone:"tone-1"}));
    expect(JSON.stringify(vi.mocked(generateReply).mock.calls)).not.toContain("private-for-2");
    expect(sent[0]).toMatchObject({business_connection_id:"c1",chat_id:"42"});
    expect((await db.query<{status:string}>("select status from tenant_jobs where update_id='1'")).rows[0].status).toBe("sent");
  });
  it("serializes jobs in one chat but lets another account proceed",async()=>{
    await connect(1);await connect(2);await ingest(1,"1");await ingest(1,"2");await ingest(2,"3");
    expect((await claim()).update_id).toBe("1");expect((await claim()).update_id).toBe("3");expect(await claim()).toBeUndefined();
  });
  it("stops a queued reply when the user pauses or permissions are revoked",async()=>{
    await connect(1);await ingest(1,"1");let job=await claim();revoked=true;await processTenantJob(job);expect(sent).toEqual([]);
    revoked=false;await connect(1);await ingest(1,"2");job=await claim();
    vi.mocked(generateReply).mockImplementationOnce(async()=>{await db.exec("update tenant_accounts set enabled=false where owner_id='1'");return "no";});
    await processTenantJob(job);expect(sent).toEqual([]);
  });
  it("cleanup during generation cancels the job and preserves the destination",async()=>{
    await connect(1);await ingest(1,"1");const job=await claim();
    vi.mocked(generateReply).mockImplementationOnce(async()=>{await tenantDb("rpc/tenant_clear_history","POST",{p_owner:"1"});return "no";});
    await processTenantJob(job);expect(sent).toEqual([]);expect((await db.query("select * from tenant_conversations")).rows).toHaveLength(1);
  });
  it("never automatically resends an uncertain delivery or stale worker claim",async()=>{
    await connect(1);await ingest(1,"1");const job=await claim();uncertainSend=true;await processTenantJob(job);expect(sent).toHaveLength(1);
    await ingest(1,"2");expect(await claim()).toBeUndefined();
    expect((await db.query<{status:string}>("select status from tenant_jobs where update_id='1'")).rows[0].status).toBe("uncertain");
    await request("/jobs/1/cancel",1,"POST");const next=await claim();expect(next.update_id).toBe("2");
    await db.exec("update tenant_jobs set locked_at=now()-interval '10 minutes' where update_id='2'");expect(await claim()).toBeUndefined();
    expect((await db.query<{status:string}>("select status from tenant_jobs where update_id='2'")).rows[0].status).toBe("uncertain");
  });
  it("enforces an atomic daily budget for each account",async()=>{
    await connect(1);await connect(2);
    const take=(id:string)=>tenantDb<boolean>("rpc/tenant_budget","POST",{p_owner:id,p_limit:2});
    expect(await take("1")).toBe(true);expect(await take("1")).toBe(true);expect(await take("1")).toBe(false);expect(await take("2")).toBe(true);
  });
  it("rejects untrusted webhook requests and keeps tenant updates out of legacy storage",async()=>{
    expect((await nativeFetch(base+"/api/telegram/webhook",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({update_id:1})})).status).toBe(401);
    await connect(1);
    const update={update_id:22,business_message:{business_connection_id:"c1",chat:{type:"private",id:42},from:{id:42},message_id:20,text:"hello"}};
    const r=await nativeFetch(base+"/api/telegram/webhook",{method:"POST",headers:{"content-type":"application/json","x-telegram-bot-api-secret-token":"webhook-secret"},body:JSON.stringify(update)});
    expect(r.status).toBe(200);expect((await db.query("select * from tenant_jobs")).rows).toHaveLength(1);
  });
  it("provides private onboarding and deduplicates control commands",async()=>{
    await tenantWebhook({update_id:1,message:{chat:{type:"private",id:1},from:{id:1},text:"/start"}});
    await tenantWebhook({update_id:1,message:{chat:{type:"private",id:1},from:{id:1},text:"/start"}});
    expect(sent).toHaveLength(1);expect(sent[0].chat_id).toBe("1");expect(sent[0]).toHaveProperty("reply_markup");
    expect((await db.query<{enabled:boolean}>("select * from tenant_accounts")).rows[0].enabled).toBe(false);
  });
  it("handles private control buttons only for the owning Telegram account",async()=>{
    await connect(1);await connect(2);
    await tenantWebhook({update_id:55,callback_query:{id:"callback",from:{id:1},message:{chat:{type:"private",id:1}},data:"tenant:pause"}});
    const rows=(await db.query<{owner_id:string;enabled:boolean}>("select owner_id,enabled from tenant_accounts order by owner_id")).rows;
    expect(rows).toEqual([{owner_id:"1",enabled:false},{owner_id:"2",enabled:true}]);
    await tenantWebhook({update_id:56,callback_query:{id:"spoof",from:{id:1},message:{chat:{type:"private",id:2}},data:"tenant:pause"}});
    expect((await db.query<{enabled:boolean}>("select enabled from tenant_accounts where owner_id='2'")).rows[0].enabled).toBe(true);
  });
  it("fails closed on storage failure and restricts the worker secret",async()=>{
    await connect(1);brokenStorage=true;expect((await request("/me")).status).toBe(503);
    expect((await nativeFetch(base+"/api/tenant-worker")).status).toBe(401);expect(sent).toEqual([]);
  });
  it("requires explicit consent and changes only the signed-in user's settings",async()=>{
    await connect(1,false);await connect(2);
    expect((await request("/settings",1,"PUT",{enabled:true,tone:"polite",language:"Amharic",owner_id:"2"})).status).toBe(400);
    expect((await request("/settings",1,"PUT",{enabled:true,tone:"polite",language:"Amharic",consent:true,owner_id:"2"})).status).toBe(200);
    const rows=(await db.query<{owner_id:string;tone:string;consent_at:string}>("select * from tenant_accounts order by owner_id")).rows;
    expect(rows[0].tone).toBe("polite");expect(rows[0].consent_at).not.toBeNull();expect(rows[1].tone).toBe("tone-2");
  });
  it("retains manual reply access after cleanup and blocks revoked rights",async()=>{
    await connect(1);await ingest(1,"1");await tenantDb("rpc/tenant_clear_history","POST",{p_owner:"1"});
    expect((await request("/reply",1,"POST",{connection:"c1",chat:"42",text:"manual"})).status).toBe(200);
    expect(sent[0]).toMatchObject({business_connection_id:"c1",chat_id:"42",text:"manual"});
    revoked=true;expect((await request("/reply",1,"POST",{connection:"c1",chat:"42",text:"blocked"})).status).toBe(403);expect(sent).toHaveLength(1);
  });
  it("runs the authenticated worker and removes expired copies without forgetting destinations",async()=>{
    await connect(1);await ingest(1,"1");
    const response=await nativeFetch(base+"/api/tenant-worker",{headers:{authorization:"Bearer "+"x".repeat(40)}});
    expect(response.status).toBe(200);expect(sent).toHaveLength(1);
    await db.exec("update tenant_messages set created_at=now()-interval '8 days'");
    await tenantDb("rpc/tenant_retention","POST",{});
    expect((await db.query("select * from tenant_messages")).rows).toHaveLength(0);
    expect((await db.query("select * from tenant_conversations")).rows).toHaveLength(1);
  });
  it("caps daily incoming storage independently of the reply budget",async()=>{
    await connect(1);await ingest(1,"1");await db.exec("update tenant_daily_usage set received=1000 where owner_id='1'");
    await ingest(1,"2");expect((await db.query("select * from tenant_messages")).rows).toHaveLength(1);
  });
  it("denies direct SQL access to anonymous and authenticated browser roles",async()=>{
    for(const role of ["anon","authenticated"]){await db.exec(`set role ${role}`);try{await expect(db.query("select * from tenant_messages")).rejects.toThrow(/permission denied/);await expect(db.query("select tenant_clear_history('1')")).rejects.toThrow(/permission denied/);}finally{await db.exec("reset role");}}
  });
});
