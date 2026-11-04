import { useCallback, useEffect, useState } from "react";
import "./tenant.css";

type Conversation = { connection_id: string; chat_id: string; last_at: string };
type Message = { id: number; body: string; direction: string; created_at: string };
type Profile = { account: { owner_id: string; enabled: boolean; consent_at: string | null; tone: string; language: string }; connections: { id: string; enabled: boolean; can_reply: boolean }[]; jobs: { update_id: string; status: string; chat_id: string }[]; usage: { day: string; used: number }[] };
type TelegramWindow = Window & { Telegram?: { WebApp?: { initData: string; ready(): void; expand(): void } } };
export default function TenantApp() {
  const [auth,setAuth]=useState(""), [notice,setNotice]=useState("Opening your secure Telegram session…"), [busy,setBusy]=useState(false);
  const [profile,setProfile]=useState<Profile|null>(null), [conversations,setConversations]=useState<Conversation[]>([]), [selected,setSelected]=useState<Conversation|null>(null), [messages,setMessages]=useState<Message[]>([]);
  const [tone,setTone]=useState("friendly, respectful, concise"), [language,setLanguage]=useState("match the sender"), [enabled,setEnabled]=useState(false), [consent,setConsent]=useState(false), [draft,setDraft]=useState("");
  const [page,setPage]=useState(0);
  useEffect(()=>{
    const ready=()=>{
      const app=(window as TelegramWindow).Telegram?.WebApp;
      app?.ready(); app?.expand();
      if(app?.initData) {setAuth(app.initData);setNotice("");}
      else setNotice("Open this private dashboard using /dashboard in your Telegram bot. A normal browser link cannot sign you in.");
    };
    if((window as TelegramWindow).Telegram?.WebApp) {ready();return;}
    const script=document.createElement("script");script.src="https://telegram.org/js/telegram-web-app.js";script.onload=ready;script.onerror=()=>setNotice("Could not load Telegram sign-in. Reopen from the bot.");document.head.appendChild(script);
    return ()=>{script.onload=null;script.onerror=null;script.remove();};
  },[]);
  const api=useCallback(async(path:string,method="GET",body?:unknown,extra?:Record<string,string>)=>{
    const r=await fetch(`/api/user${path}`,{method,headers:{"x-telegram-init-data":auth,"Content-Type":"application/json",...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const d=await r.json();if(!r.ok)throw new Error(d.error||"Request failed.");return d;
  },[auth]);
  const refresh=useCallback(async()=>{
    const p:Profile=await api("/me");setProfile(p);setTone(p.account.tone);setLanguage(p.account.language);setEnabled(p.account.enabled);
    const inbox=await api(`/inbox?offset=${page*100}`);setConversations(inbox.conversations);
  },[api,page]);
  useEffect(()=>{if(auth)void refresh().catch(e=>setNotice(e.message));},[auth,refresh]);
  useEffect(()=>{
    if(!selected||!auth) {setMessages([]);return;}
    let cancelled=false;
    setMessages([]);
    api(`/messages?connection=${encodeURIComponent(selected.connection_id)}&chat=${encodeURIComponent(selected.chat_id)}`).then(d=>{if(!cancelled)setMessages(d.messages);}).catch(e=>{if(!cancelled)setNotice(e.message);});
    return()=>{cancelled=true;};
  },[selected,auth,api]);
  const act=async(fn:()=>Promise<void>)=>{setBusy(true);setNotice("");try{await fn();}catch(e){setNotice(e instanceof Error?e.message:"Operation failed.");}finally{setBusy(false);}};
  return <div className="tenant-app"><header className="tenant-header"><div><span className="tenant-kicker">YOUR TELEGRAM ASSISTANT</span><h1>My agent</h1><p>Your account. Your conversations. Your controls.</p></div><span className={"tenant-badge "+(profile?.account.enabled?"active":"")}>{profile?.account.enabled?"Auto-reply on":"Paused"}</span></header>
    {notice&&<div className="tenant-notice" role="status">{notice}</div>}
    {!profile?<section className="tenant-card"><h2>Private sign-in</h2><p>Use the dashboard button in your bot chat. Telegram signs you in without a shared password or administrator token.</p></section>:<>
      <div className="tenant-stats"><section className="tenant-card"><small>Signed-in account</small><b>{profile.account.owner_id}</b></section><section className="tenant-card"><small>Connected accounts</small><b>{profile.connections.filter(c=>c.enabled&&c.can_reply).length}</b></section><section className="tenant-card"><small>Reply attempts · {profile.usage[0]?.day||"today"}</small><b>{profile.usage[0]?.used||0}</b></section></div>
      <div className="tenant-grid"><section className="tenant-card"><h2>Reply preferences</h2><label className="tenant-toggle"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/> Enable automatic replies</label><p>Connect the bot in Telegram’s Business/Secretary settings and select your chats. Replies require current Telegram permissions.</p><label>Reply tone<input value={tone} maxLength={160} onChange={e=>setTone(e.target.value)}/></label><label>Language preference<input value={language} maxLength={80} onChange={e=>setLanguage(e.target.value)}/></label>
      {!profile.account.consent_at&&<label className="tenant-toggle"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/> I agree to send selected incoming message text to the configured AI provider and store copies for up to 7 days while the worker runs, or until I clear them sooner.</label>}
      <button disabled={busy} onClick={()=>void act(async()=>{await api("/settings","PUT",{enabled,tone,language,consent});await refresh();setNotice("Preferences saved. Pausing cancels queued replies; a send already in progress may finish.");})}>Save preferences</button>
      <button className="tenant-secondary" disabled={busy} onClick={()=>void act(async()=>{await api("/settings","PUT",{enabled:false,tone,language});await refresh();setNotice("Paused. Queued replies cancelled.");})}>Pause now</button>
      <hr/><h3>Storage</h3><p>Clear your stored message copies while keeping conversation IDs. Original Telegram messages stay unchanged.</p><button className="tenant-secondary" disabled={busy} onClick={()=>{
        if(!window.confirm("Delete your stored message copies and cancel queued replies? This cannot be undone. Telegram messages are unaffected. An in-progress send may complete."))return;
        void act(async()=>{const d=await api("/history","DELETE",undefined,{"x-confirm-inbox-cleanup":"DELETE_STORED_COPIES_ONLY"});setMessages([]);await refresh();setNotice(`Cleared ${d.deletedCount} copies.`);});
      }}>Clear my database copies</button></section>
      <section className="tenant-card"><div className="tenant-row"><h2>My inbox</h2><button className="tenant-secondary" disabled={busy} onClick={()=>void act(async()=>{await refresh();if(selected){const d=await api(`/messages?connection=${encodeURIComponent(selected.connection_id)}&chat=${encodeURIComponent(selected.chat_id)}`);setMessages(d.messages);}})}>Refresh</button></div>
      {!conversations.length&&<p>No conversations on this page. Connect your account and enable AI processing; new selected text messages will appear here.</p>}
      <div className="tenant-conversations">{conversations.map(c=><button className={selected?.connection_id===c.connection_id&&selected?.chat_id===c.chat_id?"selected":"tenant-secondary"} key={c.connection_id+":"+c.chat_id} onClick={()=>setSelected(c)}>Chat {c.chat_id}<small>{new Date(c.last_at).toLocaleString()}</small></button>)}</div>
      <div className="tenant-row"><button className="tenant-secondary" disabled={page===0||busy} onClick={()=>setPage(p=>p-1)}>Previous</button><span>Page {page+1}</span><button className="tenant-secondary" disabled={conversations.length<100||busy} onClick={()=>setPage(p=>p+1)}>Next</button></div>
      {selected&&<><h3>Chat {selected.chat_id}</h3><div className="tenant-messages">{messages.length?messages.map(m=><div className={"tenant-message "+m.direction} key={m.id}><small>{m.direction==="incoming"?"Contact":"You / agent"}</small><p>{m.body}</p></div>):<p>No stored history. This conversation remains available.</p>}</div><label>Manual reply<textarea value={draft} maxLength={4096} onChange={e=>setDraft(e.target.value)}/></label><button disabled={busy||!draft.trim()} onClick={()=>void act(async()=>{const result=await api("/reply","POST",{connection:selected.connection_id,chat:selected.chat_id,text:draft});setDraft("");const d=await api(`/messages?connection=${encodeURIComponent(selected.connection_id)}&chat=${encodeURIComponent(selected.chat_id)}`);setMessages(d.messages);setNotice(result.stored?"Reply sent.":"Reply sent; the database copy could not be saved. Do not resend.");})}>Send reply</button></>}
      </section></div>
      <section className="tenant-card"><h2>Recent reply jobs</h2><p>Failed or uncertain sends are never retried automatically. Check the Telegram conversation before dismissing them. An uncertain job pauses later replies in that chat.</p>{profile.jobs.map(j=><div className="tenant-row tenant-job" key={j.update_id}><span>Chat {j.chat_id} · {j.status}</span>{["failed","uncertain","pending"].includes(j.status)&&<button className="tenant-secondary" disabled={busy} onClick={()=>void act(async()=>{await api(`/jobs/${encodeURIComponent(j.update_id)}/cancel`,"POST");await refresh();})}>Dismiss</button>}</div>)}</section>
    </>}
  </div>;
}
