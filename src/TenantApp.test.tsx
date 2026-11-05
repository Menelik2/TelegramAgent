// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TenantApp from "./TenantApp";

type Account={owner_id:string;enabled:boolean;consent_at:string|null;tone:string;language:string;manual_inbox?:boolean};
let account:Account, writes:{path:string;body:Record<string,unknown>}[], failure:string, inboxFailure:boolean, profileFailure:boolean;
let hold:Promise<void>|undefined;
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json"}});
const toggle=()=>screen.getByRole("checkbox",{name:"Enable automatic replies"}) as HTMLInputElement;
const agree=()=>fireEvent.click(screen.getByRole("checkbox",{name:/I agree to send/}));
beforeEach(()=>{
  account={owner_id:"1",enabled:false,consent_at:null,tone:"friendly",language:"Amharic"};writes=[];failure="";inboxFailure=false;profileFailure=false;hold=undefined;
  Object.defineProperty(window,"Telegram",{configurable:true,value:{WebApp:{initData:"signed-test-session",ready:vi.fn(),expand:vi.fn()}}});
  vi.stubGlobal("fetch",vi.fn(async(input:string,init:RequestInit={})=>{
    expect((init.headers as Record<string,string>)["x-telegram-init-data"]).toBe("signed-test-session");
    const path=new URL(input,"https://app.test").pathname;
    if(path==="/api/user/me"&&profileFailure)return json({error:"Reopen the dashboard in Telegram to sign in again."},401);
    if(path==="/api/user/me")return json({account,connections:[{id:"c1",enabled:true,can_reply:true}],jobs:[],usage:[]});
    if(path==="/api/user/manual-inbox"){
      const body=JSON.parse(String(init.body));writes.push({path,body});account.manual_inbox=body.enabled;return json({enabled:account.manual_inbox});
    }
    if(path==="/api/user/ai-key")return json({configured:false});
    if(path==="/api/user/inbox")return inboxFailure?json({error:"Inbox unavailable"},503):json({conversations:[]});
    if(path==="/api/user/automation"||path==="/api/user/settings"){
      const body=JSON.parse(String(init.body));writes.push({path,body});
      if(hold)await hold;
      if(failure)return json({error:failure},503);
      if(body.enabled!==undefined)account.enabled=body.enabled;
      if(body.enabled&&body.consent)account.consent_at="2026-11-04T12:00:00Z";
      if(body.tone!==undefined)account.tone=body.tone;
      if(body.language!==undefined)account.language=body.language;
      return json({ok:true,account});
    }
    throw new Error("Unexpected request "+path);
  }));
});
afterEach(()=>{cleanup();Reflect.deleteProperty(window,"Telegram");vi.unstubAllGlobals();vi.restoreAllMocks();});
async function open(){render(<TenantApp/>);fireEvent.click(screen.getByRole("button",{name:"Auto-reply & settings"}));await screen.findByRole("checkbox",{name:"Enable automatic replies"});}

describe("private user automatic reply controls",()=>{
  it("can start the manual inbox without enabling AI or agreeing to AI processing",async()=>{
    await open();fireEvent.click(screen.getByRole("checkbox",{name:"Save incoming messages for manual replies"}));
    await screen.findByText("Manual inbox enabled for new messages.");
    expect(writes).toEqual([{path:"/api/user/manual-inbox",body:{enabled:true}}]);
    expect(toggle().checked).toBe(false);expect(toggle().disabled).toBe(true);
  });
  it("requires consent and persists activation immediately without saving preferences",async()=>{
    await open();expect(toggle().disabled).toBe(true);agree();fireEvent.click(toggle());
    await screen.findByText("Auto-reply on");expect(toggle().checked).toBe(true);
    expect(writes).toEqual([{path:"/api/user/automation",body:{enabled:true,consent:true}}]);
    cleanup();await open();expect(toggle().checked).toBe(true);
  });
  it("waits for server confirmation and prevents repeated activation requests",async()=>{
    let release!:()=>void;hold=new Promise(resolve=>{release=resolve;});
    await open();agree();fireEvent.click(toggle());
    expect(toggle().disabled).toBe(true);expect(toggle().checked).toBe(false);
    fireEvent.click(toggle());expect(writes).toHaveLength(1);
    release();await screen.findByText("Auto-reply on");
  });
  it("keeps the saved state and shows the server's actionable activation error",async()=>{
    failure="Telegram reply permission is disabled or revoked. Reconnect this bot or allow replies in Telegram, then try again.";
    await open();agree();fireEvent.click(toggle());await screen.findByText(failure);
    expect(toggle().checked).toBe(false);expect(screen.queryByText("Auto-reply on")).toBeNull();
    failure="";fireEvent.click(toggle());await screen.findByText("Auto-reply on");
  });
  it("preserves unsaved preferences while toggling and never includes automation in preference saves",async()=>{
    account.consent_at="2026-11-04";await open();
    fireEvent.change(screen.getByRole("textbox",{name:"Reply tone"}),{target:{value:"polite"}});
    fireEvent.click(toggle());await screen.findByText("Auto-reply on");
    expect((screen.getByRole("textbox",{name:"Reply tone"}) as HTMLInputElement).value).toBe("polite");
    fireEvent.click(screen.getByRole("button",{name:"Save preferences"}));await screen.findByText("Reply preferences saved.");
    expect(writes[1]).toEqual({path:"/api/user/settings",body:{tone:"polite",language:"Amharic"}});
    expect(toggle().checked).toBe(true);
  });
  it("pauses immediately even when preference fields are empty",async()=>{
    account.enabled=true;account.consent_at="2026-11-04";await open();
    fireEvent.change(screen.getByRole("textbox",{name:"Reply tone"}),{target:{value:""}});
    fireEvent.click(screen.getByRole("button",{name:"Pause now"}));await screen.findByText("Paused");
    expect(writes[0]).toEqual({path:"/api/user/automation",body:{enabled:false,consent:false}});
    expect(toggle().checked).toBe(false);
  });
  it("does not claim pause succeeded when saving fails",async()=>{
    account.enabled=true;account.consent_at="2026-11-04";failure="Operation could not be confirmed. Refresh to check saved settings.";
    await open();fireEvent.click(screen.getByRole("button",{name:"Pause now"}));await screen.findByText(failure);
    expect(toggle().checked).toBe(true);expect(screen.getByText("Auto-reply on")).toBeTruthy();
  });
  it("keeps confirmed activation independent of inbox refresh errors",async()=>{
    await open();inboxFailure=true;agree();fireEvent.click(toggle());
    await screen.findByText("Auto-reply on");
    await waitFor(()=>expect(screen.getByText(/Automatic replies enabled for new messages/)).toBeTruthy());
    expect(screen.queryByText("Inbox unavailable")).toBeNull();
  });
});


describe("dashboard auto-reply status synchronization",()=>{
  it("updates a Telegram-side pause when returning to the dashboard without erasing drafts",async()=>{
    account.enabled=true;account.consent_at="2026-11-04";await open();
    fireEvent.change(screen.getByRole("textbox",{name:"Reply tone"}),{target:{value:"unsaved tone"}});
    account={...account,enabled:false};fireEvent(window,new Event("focus"));
    await screen.findByText("Paused");expect(toggle().checked).toBe(false);
    expect((screen.getByRole("textbox",{name:"Reply tone"}) as HTMLInputElement).value).toBe("unsaved tone");
    expect(writes).toHaveLength(0);
  });
  it("marks status unavailable when the Telegram session expires",async()=>{
    account.enabled=true;account.consent_at="2026-11-04";await open();profileFailure=true;
    fireEvent(window,new Event("focus"));await screen.findByText("Status unavailable");
    expect(screen.getByRole("alert").textContent).toContain("Reopen the dashboard in Telegram");
    expect(screen.queryByText("Auto-reply on")).toBeNull();
    profileFailure=false;fireEvent(window,new Event("focus"));await screen.findByText("Auto-reply on");
  });
  it("does not overwrite a successful activation with an older status response",async()=>{
    await open();agree();const old={...account};let release!:(r:Response)=>void;
    vi.mocked(fetch).mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
    fireEvent(window,new Event("focus"));fireEvent.click(toggle());await screen.findByText("Auto-reply on");
    await act(async()=>{release(json({account:old,connections:[],jobs:[],usage:[]}));});
    expect(toggle().checked).toBe(true);expect(screen.getByText("Auto-reply on")).toBeTruthy();
  });
});
