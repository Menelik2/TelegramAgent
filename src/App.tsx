import { useEffect, useMemo, useState } from "react";
import { Activity, Bot, BrainCircuit, Check, ChevronDown, CircleHelp, Clock3, Command, ContactRound, Gauge, MessageCircle, Moon, MoreHorizontal, Pause, Play, Plus, Search, Send, Settings2, ShieldCheck, Sparkles, Square, Zap } from "lucide-react";

type Status = { ok: boolean; automationEnabled: boolean; telegramConfigured: boolean; aiConfigured: boolean; storageConfigured?: boolean; mode: string };
type Contact = { id: string; senderId?: string; name: string; handle: string; initials: string; color: string; last: string; time: string; unread?: number; allowed: boolean; messages: { from: "them" | "ai"; text: string; time: string }[] };
const initialContacts: Contact[] = [
  { id: "1", name: "Mimi Bekele", handle: "@mimi_b", initials: "MB", color: "lilac", last: "Are we still meeting this afternoon?", time: "2m", unread: 2, allowed: true, messages: [{ from: "them", text: "Hey! Hope your morning is going well ☀️", time: "9:14" }, { from: "ai", text: "Hey Mimi! It is, thank you 😊 Hope yours is too!", time: "9:15" }, { from: "them", text: "Are we still meeting this afternoon?", time: "9:18" }] },
  { id: "2", name: "Daniel T.", handle: "@daniel_t", initials: "DT", color: "blue", last: "Sent you the notes from yesterday", time: "18m", allowed: false, messages: [{ from: "them", text: "Sent you the notes from yesterday.", time: "8:52" }] },
  { id: "3", name: "Selam Work", handle: "@selam_work", initials: "SW", color: "mint", last: "Thanks, that helps a lot!", time: "1h", allowed: true, messages: [{ from: "them", text: "Do you have a minute to look at this?", time: "8:02" }, { from: "ai", text: "Sure, send it over and I’ll take a look.", time: "8:04" }, { from: "them", text: "Thanks, that helps a lot!", time: "8:08" }] },
  { id: "4", name: "Abel Girma", handle: "@abelg", initials: "AG", color: "peach", last: "Can you send me the link?", time: "3h", allowed: false, messages: [{ from: "them", text: "Can you send me the link?", time: "06:42" }] }
];
const nav = [{ label: "Overview", icon: Gauge }, { label: "Inbox", icon: MessageCircle }, { label: "AI personality", icon: Sparkles }, { label: "Contacts", icon: ContactRound }, { label: "Memory", icon: BrainCircuit }, { label: "Automation", icon: Zap }, { label: "Settings", icon: Settings2 }];
export default function App() {
  const [page, setPage] = useState("Overview");
  const [contacts, setContacts] = useState(initialContacts);
  const [selectedId, setSelectedId] = useState("1");
  const [query, setQuery] = useState("");
  const [automation, setAutomation] = useState(false);
  const [mode, setMode] = useState("Allowed contacts");
  const [status, setStatus] = useState<Status | null>(null);
  const [activityEvents, setActivityEvents] = useState<Array<{id?:number;kind:string;detail:string;createdAt?:string}>>([]);
  const [liveMetrics, setLiveMetrics] = useState({ messages: 0, replies: 0, review: 0 });
  const [inboxLive, setInboxLive] = useState(false);
  const [inboxLoading, setInboxLoading] = useState(false);
  const [dashboardToken, setDashboardToken] = useState(() => window.sessionStorage.getItem("dashboardApiToken") || "");
  const apiBase = import.meta.env.VITE_API_BASE_URL || "";
  const apiRequest = (path: string, init: RequestInit = {}) => fetch(`${apiBase}${path}`, { ...init, headers: { ...(init.headers || {}), "x-dashboard-token": dashboardToken } });
  const [draft, setDraft] = useState("");
  const [toast, setToast] = useState("");
  const selected = contacts.find(c => c.id === selectedId) ?? contacts[0] ?? (inboxLive ? undefined : initialContacts[0]);
  const filtered = useMemo(() => contacts.filter(c => (c.name + c.handle).toLowerCase().includes(query.toLowerCase())), [contacts, query]);
  useEffect(() => { fetch(`${apiBase}/api/status`).then(r => r.json()).then((value: Status) => { setStatus(value); setAutomation(value.automationEnabled); }).catch(() => setStatus(null)); }, [apiBase]);
  useEffect(() => { if (dashboardToken) window.sessionStorage.setItem("dashboardApiToken", dashboardToken); else window.sessionStorage.removeItem("dashboardApiToken"); }, [dashboardToken]);
  useEffect(() => {
    if (!dashboardToken) {
      setActivityEvents([]);
      setLiveMetrics({ messages: 0, replies: 0, review: 0 });
      return;
    }
    let active = true;
    Promise.all([apiRequest("/api/activity?limit=100"), apiRequest("/api/inbox")])
      .then(async ([activityResponse, inboxResponse]) => {
        const activityData = await activityResponse.json();
        const inboxData = await inboxResponse.json();
        if (!activityResponse.ok) throw new Error(activityData.error || "Activity is unavailable.");
        if (!inboxResponse.ok) throw new Error(inboxData.error || "Inbox metrics are unavailable.");
        const events = (activityData.events || []) as Array<{id?:number;kind:string;detail:string;createdAt?:string}>;
        const conversations = (inboxData.conversations || []) as Array<{messageCount?:number}>;
        if (!active) return;
        setActivityEvents(events);
        setLiveMetrics({
          messages: conversations.reduce((total, item) => total + Number(item.messageCount || 0), 0),
          replies: events.filter(event => event.kind === "reply_sent" || event.kind === "manual_reply_sent").length,
          review: events.filter(event => event.kind === "owner_review_required" || event.kind === "blocked" || event.kind === "delivery_failed").length
        });
      })
      .catch(() => {
        if (active) {
          setActivityEvents([]);
          setLiveMetrics({ messages: 0, replies: 0, review: 0 });
        }
      });
    return () => { active = false; };
  }, [dashboardToken, apiBase]);

  const flash = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 2600); };
  const refreshLiveInbox = async () => {
    if (!dashboardToken) { flash("Enter your dashboard API token in Settings first."); return; }
    setInboxLoading(true);
    try {
      const [inboxResponse, contactsResponse] = await Promise.all([
        apiRequest("/api/inbox"),
        apiRequest("/api/agent/contacts")
      ]);
      const inboxData = await inboxResponse.json();
      if (!inboxResponse.ok) throw new Error(inboxData.error || "Live inbox could not be loaded.");
      const contactData = contactsResponse.ok ? await contactsResponse.json() : { contacts: [] };
      const permissions = new Map<string, boolean>((contactData.contacts || []).map((x: {senderId:string;enabled:boolean}) => [x.senderId, x.enabled]));
      const colors = ["lilac", "blue", "mint", "peach"];
      const mapped: Contact[] = (inboxData.conversations || []).map((item: {chatId:string;senderId?:string;senderName:string;username:string;lastMessage:string;lastMessageAt:string;lastDirection:string}, i:number) => ({
        id: item.chatId, senderId: item.senderId, name: item.senderName || item.username || item.chatId,
        handle: item.username ? "@" + item.username : item.chatId, initials: (item.senderName || item.username || item.chatId).split(/\s+/).slice(0,2).map((s:string)=>s[0]).join("").toUpperCase(),
        color: colors[i % colors.length], last: item.lastMessage, time: new Date(item.lastMessageAt).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}),
        allowed: item.senderId ? permissions.get(item.senderId) === true : false, messages: []
      }));
      setInboxLive(true);
      if (mapped.length) {
        setContacts(mapped);
        setSelectedId(previous => mapped.some(item => item.id === previous) ? previous : mapped[0].id);
      } else {
        setContacts([]);
        setSelectedId("");
      }
      flash(mapped.length ? "Live Telegram inbox loaded." : "No Telegram conversations yet. Send or receive a business message first.");
    } catch (error) {
      flash(error instanceof Error ? error.message : "Live inbox unavailable.");
    } finally { setInboxLoading(false); }
  };
  useEffect(() => {
    if (!dashboardToken) { setInboxLive(false); setContacts(initialContacts); setSelectedId("1"); return; }
    const timer = window.setTimeout(() => { void refreshLiveInbox(); }, 700);
    return () => window.clearTimeout(timer);
  }, [dashboardToken, apiBase]);
  useEffect(() => {
    if (page !== "Inbox" || !inboxLive || !selectedId || !dashboardToken) return;
    let active = true;
    apiRequest("/api/inbox/" + encodeURIComponent(selectedId) + "/messages").then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load conversation.");
      if (!active) return;
      setContacts(previous => previous.map(contact => contact.id === selectedId ? { ...contact, messages: (data.messages || []).map((m: {direction:string;text:string;createdAt?:string}) => ({ from: m.direction === "outgoing" ? "ai" as const : "them" as const, text: m.text, time: m.createdAt ? new Date(m.createdAt).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}) : "" })) } : contact));
    }).catch(error => { if (active) flash(error instanceof Error ? error.message : "Could not load conversation."); });
    return () => { active = false; };
  }, [page, inboxLive, selectedId, dashboardToken]);
  const toggleContact = (id: string) => {
    const contact = contacts.find(item => item.id === id);
    if (!contact) return;
    if (inboxLive && contact.senderId) {
      const enabled = !contact.allowed;
      apiRequest("/api/agent/contacts/" + encodeURIComponent(contact.senderId), {method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled,note:"Owner-managed allowlist"})})
        .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || "Permission update failed."); setContacts(previous => previous.map(item => item.id === id ? {...item,allowed:enabled}:item)); flash(enabled ? "Contact allowed for automatic replies." : "Contact set to manual-only."); })
        .catch(error => flash(error instanceof Error ? error.message : "Permission update failed."));
    } else if (!inboxLive) setContacts(previous => previous.map(item => item.id === id ? { ...item, allowed: !item.allowed } : item));
    else flash("This conversation has no sender ID, so automatic replies cannot be enabled.");
  };
  const sendDemo = async () => {
    if (!draft.trim() || !selected) return;
    if (inboxLive) {
      try {
        const response = await apiRequest("/api/inbox/" + encodeURIComponent(selected.id) + "/reply", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:draft.trim()})});
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Telegram reply failed.");
        setDraft(""); flash("Reply sent through Telegram."); await refreshLiveInbox();
      } catch (error) { flash(error instanceof Error ? error.message : "Telegram reply failed."); }
      return;
    }
    setContacts(previous => previous.map(item => item.id === selectedId ? { ...item, messages: [...item.messages, { from: "ai", text: draft.trim(), time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }], last: draft.trim() } : item));
    setDraft(""); flash("Preview added locally. Connect Telegram to send real messages.");
  };
    return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Bot size={21}/></div><div><strong>telegram<span>agent</span></strong><small>PERSONAL AI</small></div><button className="icon-button side-more" aria-label="More"><MoreHorizontal size={18}/></button></div>
      <div className="workspace"><div className="workspace-avatar">M</div><div className="workspace-text"><b>My assistant</b><span>Personal workspace</span></div><ChevronDown size={15} className="subtle"/></div>
      <div className="nav-label">WORKSPACE</div>
      <nav>{nav.map(item => <button key={item.label} onClick={() => setPage(item.label)} className={"nav-item " + (page === item.label ? "active" : "")}><item.icon size={18}/><span>{item.label}</span>{item.label === "Inbox" && <em>{inboxLive ? contacts.length : "—"}</em>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="upgrade"><div className="upgrade-icon"><Sparkles size={17}/></div><b>Your assistant, your rules.</b><p>Thoughtful replies. Complete control.</p><button onClick={() => setPage("Settings")}>Configure agent <span>↗</span></button></div><div className="user-row"><div className="user-avatar">M</div><div><b>Menelik</b><small>Personal account</small></div><MoreHorizontal size={18} className="subtle"/></div></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div className="crumb">Workspace <span>/</span> <b>{page}</b></div><div className="top-actions"><div className="connection-pill"><span className={"dot " + (status?.telegramConfigured ? "green" : "amber")}></span>{status?.telegramConfigured ? "Telegram connected" : "Telegram not connected"}</div><button className="icon-button" aria-label="Help" onClick={() => flash("Connect Telegram using the setup guide in Settings.")}><CircleHelp size={18}/></button><button className="icon-button" aria-label="Theme"><Moon size={18}/></button><div className="user-avatar small">M</div></div></header>
      <div className="content">
        {page === "Inbox" ? <div className="inbox-page">
          <div className="page-heading"><div><div className="eyebrow">YOUR CONVERSATIONS</div><h1>Inbox<span className="heading-count">{inboxLive ? contacts.length : "04"}</span></h1><p>{inboxLive ? "Live Telegram Business conversations." : "Preview conversations — connect your dashboard to load real messages."}</p></div><button className="secondary-button" onClick={() => void refreshLiveInbox()} disabled={inboxLoading}><Command size={16}/> {inboxLoading ? "Loading…" : "Refresh live inbox"}</button></div>
          <div className="inbox-layout"><section className="inbox-list"><div className="searchbox"><Search size={16}/><input placeholder="Search conversations..." value={query} onChange={e => setQuery(e.target.value)}/><kbd>⌘ K</kbd></div><div className="filter-row"><button className="filter-active">All <span>{filtered.length}</span></button><button>Unread</button><button>Auto-reply</button></div>{filtered.map(c => <button className={"conversation " + (selectedId === c.id ? "selected" : "")} key={c.id} onClick={() => setSelectedId(c.id)}><div className={"contact-avatar " + c.color}>{c.initials}</div><div className="conversation-copy"><div className="conversation-name"><b>{c.name}</b><time>{c.time}</time></div><p>{c.last}</p><div className="conversation-tags">{c.allowed ? <span className="tag enabled"><Zap size={11}/> Auto-reply</span> : <span className="tag paused"><Pause size={10}/> Manual</span>}{c.unread && <span className="unread">{c.unread}</span>}</div></div></button>)}{filtered.length === 0 && <p className="helper-text" style={{padding:20}}>{inboxLive ? "No live conversations yet. Once Telegram Business delivers a message, it will appear here." : "No matching preview conversations."}</p>}</section>
          {selected ? <section className="chat-panel"><div className="chat-header"><div className={"contact-avatar " + selected.color}>{selected.initials}</div><div className="chat-contact"><b>{selected.name}</b><span>{selected.handle} · {selected.allowed ? "Auto-reply enabled" : "Manual replies only"}</span></div><button className="secondary-button compact" onClick={() => toggleContact(selected.id)}>{selected.allowed ? <Pause size={14}/> : <Play size={14}/>} {selected.allowed ? "Pause AI" : "Allow AI"}</button><button className="icon-button" aria-label="More options"><MoreHorizontal size={18}/></button></div><div className="chat-notice"><ShieldCheck size={15}/><span>Private conversation · replies follow your contact permissions</span></div><div className="message-stream"><div className="date-divider"><span>TODAY</span></div>{selected.messages.map((m,i) => <div key={i} className={"message-row " + (m.from === "ai" ? "outgoing" : "")}>{m.from === "ai" && <div className="ai-mini"><Sparkles size={12}/></div>}<div className={"bubble " + (m.from === "ai" ? "bubble-ai" : "bubble-them")}>{m.from === "ai" && <div className="bubble-label"><Sparkles size={11}/> AI ASSISTANT</div>}{m.text}<time>{m.time}</time></div></div>)}</div><div className="reply-box"><div className="reply-mode"><Sparkles size={13}/> {inboxLive ? "Manual reply" : "AI reply composer"} <span>{inboxLive ? "Live Telegram" : "Preview mode"}</span></div><textarea value={draft} onChange={e => setDraft(e.target.value)} placeholder="Write a reply or test your assistant's style..." rows={2}/><div className="reply-tools"><button className="tool-button" onClick={() => setDraft("Hey! Thanks for reaching out 😊 Let me check and get back to you.")}><Sparkles size={14}/> Suggest reply</button><button className="primary-button" onClick={() => void sendDemo()}><Send size={14}/> {inboxLive ? "Send reply" : "Add preview"} <span>↗</span></button></div></div></section> : <section className="chat-panel"><div className="empty-state" style={{padding:32,textAlign:"center"}}><MessageCircle size={28}/><h3>No conversation selected</h3><p>Incoming Telegram Business messages will appear here after you connect the bot and apply the live inbox migration.</p></div></section>}</div>
        </div> : page === "Overview" ? <><div className="welcome-row"><div><div className="eyebrow"><span className="eyebrow-dot"></span> YOUR PERSONAL AI ASSISTANT</div><h1>Good morning, Menelik <span>✳</span></h1><p>Your conversations, a little more effortless.</p></div><button className={"primary-button " + (automation ? "running" : "")} onClick={() => { const next = !automation; apiRequest(next ? "/api/agent/resume" : "/api/agent/pause", { method: "POST" }).then(async r => { const data = await r.json(); if (!r.ok) throw new Error(data.error || "Request failed"); setAutomation(data.automationEnabled); flash(data.automationEnabled ? "Automatic replies enabled on server." : "Automation paused on server."); }).catch(error => flash(error instanceof Error ? error.message : "Could not update automation.")); }}><span className="status-dot"></span>{automation ? "Pause automation" : "Start automation"} <ChevronDown size={15}/></button></div>
        <div className="notice-card"><div className="notice-icon"><ShieldCheck size={20}/></div><div className="notice-copy"><b>{automation ? "Automatic replies are enabled" : "You're in safe mode"}</b><p>{automation ? "The server replies only to explicitly permitted contacts and escalates sensitive messages." : "Your agent won't send messages until Telegram is connected and you explicitly enable permitted contacts."}</p></div><button onClick={() => setPage("Automation")}>Review settings <span>→</span></button></div>
        <div className="section-head"><div><h2>Your overview</h2><p>A quiet look at what your assistant has been up to.</p></div><button className="range-select">Last 7 days <ChevronDown size={14}/></button></div>
        <div className="stats-grid"><Stat icon={<MessageCircle size={17}/>} label="Stored messages" value={dashboardToken ? String(liveMetrics.messages) : "—"} trend={dashboardToken ? "Live" : "Connect"} tone="violet" note="from Telegram inbox"/><Stat icon={<Sparkles size={17}/>} label="Recent replies sent" value={dashboardToken ? String(liveMetrics.replies) : "—"} trend={dashboardToken ? "Live" : "Connect"} tone="green" note="in latest 100 events"/><Stat icon={<Clock3 size={17}/>} label="Time saved" value="—" trend="Not tracked" tone="blue" note="no estimate shown"/><Stat icon={<ShieldCheck size={17}/>} label="Review flags" value={dashboardToken ? String(liveMetrics.review) : "—"} trend={dashboardToken ? "Recent" : "Connect"} tone="amber" note="in latest 100 events"/></div>
        <div className="lower-grid"><section className="panel activity-panel"><div className="panel-heading"><div><h3>Recent activity</h3><p>Here's what's happening with your agent.</p></div><button className="icon-button" aria-label="Activity options"><MoreHorizontal size={18}/></button></div><div className="activity-list">{activityEvents.length ? activityEvents.slice(0,4).map((event,i)=><ActivityRow key={event.id ?? i} icon={<Activity size={15}/>} color={event.kind.includes("blocked") || event.kind.includes("failed") || event.kind.includes("review") ? "amber" : event.kind.includes("sent") ? "green" : "violet"} title={event.kind.replace(/_/g," ").replace(/^\w/,letter=>letter.toUpperCase())} detail={event.detail} time={event.createdAt ? new Date(event.createdAt).toLocaleString([], {month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}) : "Recent"} badge={event.kind==="blocked" ? "Protected" : event.kind.includes("failed") ? "Failed" : undefined}/> ) : <p className="helper-text" style={{padding:16}}>{dashboardToken ? "No recent stored activity. Telegram events will appear here after the webhook is configured." : "Enter your dashboard token in Settings to load real activity."}</p>}</div><button className="text-link" onClick={() => setPage("Inbox")}>View all conversations <span>→</span></button></section>
        <section className="panel right-panel"><div className="panel-heading"><div><h3>Agent health</h3><p>Your assistant at a glance.</p></div><span className="live-label"><span className="dot green"></span> ONLINE</span></div><div className="health-summary"><div className="health-ring"><div><b>{status?.aiConfigured ? "98" : "—"}</b><span>HEALTH</span></div></div><div className="health-copy"><b>{status?.aiConfigured ? "Looking good" : "Almost ready"}</b><p>{status?.aiConfigured ? "AI provider is configured." : "Add your AI key and Telegram token to connect live services."}</p></div></div><div className="service-list"><Service name="Telegram connection" state={status?.telegramConfigured ? "Connected" : "Setup needed"} good={!!status?.telegramConfigured}/><Service name="AI provider" state={status?.aiConfigured ? "Configured" : "API key needed"} good={!!status?.aiConfigured}/><Service name="Contact permissions" state="Allowlist mode" good={true}/></div><button className="outline-full" onClick={() => setPage("Settings")}>Open system settings <span>↗</span></button></section></div>
        <div className="bottom-tip"><div className="tip-spark"><Sparkles size={18}/></div><div><b>A little more you, in every reply.</b><p>Teach your assistant your tone, favorite phrases, and how you like to show up.</p></div><button onClick={() => setPage("AI personality")}>Personalize your AI <span>→</span></button></div>
        </> : <SettingsPage page={page} setPage={setPage} mode={mode} setMode={setMode} contacts={contacts} toggleContact={toggleContact} automation={automation} setAutomation={setAutomation} flash={flash} status={status} dashboardToken={dashboardToken} setDashboardToken={(value) => { setDashboardToken(value); window.sessionStorage.setItem("dashboardApiToken", value); }} apiRequest={apiRequest}/>}
      </div>
      {toast && <div className="toast"><Check size={16}/>{toast}</div>}
    </main>
  </div>;
}
function Stat({ icon, label, value, trend, tone, note }: {icon: React.ReactNode; label: string; value: string; trend: string; tone: string; note: string}) { return <div className="stat-card"><div className="stat-top"><span className={"stat-icon " + tone}>{icon}</span><span className={"trend " + tone}>{trend}</span></div><div className="stat-value">{value}</div><div className="stat-label">{label}</div><div className="stat-note">{note}</div></div>; }
function ActivityRow({icon,color,title,detail,time,badge}:{icon:React.ReactNode;color:string;title:string;detail:string;time:string;badge?:string}) { return <div className="activity-row"><div className={"activity-icon "+color}>{icon}</div><div className="activity-copy"><b>{title}</b><p>{detail}</p></div><div className="activity-meta"><time>{time}</time>{badge && <span className={"mini-badge "+(badge==="Protected"?"protected":"")}>{badge}</span>}</div></div>; }
function Service({name,state,good}:{name:string;state:string;good:boolean}) { return <div className="service-row"><span className={"service-dot "+(good?"good":"pending")}></span><span>{name}</span><small className={good?"service-good":""}>{state}</small></div>; }
function SettingsPage({page,setPage,mode,setMode,contacts,toggleContact,automation,setAutomation,flash,status,dashboardToken,setDashboardToken,apiRequest}:{page:string;setPage:(p:string)=>void;mode:string;setMode:(p:string)=>void;contacts:Contact[];toggleContact:(id:string)=>void;automation:boolean;setAutomation:(v:boolean|((p:boolean)=>boolean))=>void;flash:(m:string)=>void;status:Status|null;dashboardToken:string;setDashboardToken:(value:string)=>void;apiRequest:(path:string,init?:RequestInit)=>Promise<Response>}) {
 const [tone,setTone]=useState("warm, friendly, natural");
 const [language,setLanguage]=useState("match the sender");
 const [replyLength,setReplyLength]=useState("concise");
 const [memoryEnabled,setMemoryEnabled]=useState(true);
 const [memories,setMemories]=useState<Array<{id:number;memory:string;category:string;enabled:boolean}>>([]);
 const [memoryDraft,setMemoryDraft]=useState("");
 const [senderId,setSenderId]=useState("");
 const [allowedContacts,setAllowedContacts]=useState<Array<{senderId:string;enabled:boolean;note:string}>>([]);
 const [loading,setLoading]=useState(false);
 const [persistent,setPersistent]=useState(false);
 const postJson=async(path:string,method:string,body?:unknown)=>{const r=await apiRequest(path,{method,headers:{"Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw new Error(d.error||"Request failed");return d;};
 const refresh=async()=>{setLoading(true);try{
   if(page==="Memory"){const d=await postJson("/api/agent/memories","GET");setMemories(d.memories||[]);setPersistent(!!d.persistent);}
   if(page==="Contacts"){const d=await postJson("/api/agent/contacts","GET");setAllowedContacts(d.contacts||[]);setPersistent(true);}
   if(page==="AI personality"){const d=await postJson("/api/agent/preferences","GET");setTone(d.preferences.tone);setLanguage(d.preferences.language);setReplyLength(d.preferences.replyLength);setMemoryEnabled(d.preferences.memoryEnabled);setPersistent(!!d.persistent);}
 }catch(e){flash(e instanceof Error?e.message:"Could not load settings.");}finally{setLoading(false);}};
 useEffect(()=>{void refresh();},[page]);
 const savePersonality=async()=>{try{await postJson("/api/agent/preferences","PUT",{tone,language,replyLength,memoryEnabled});flash("Personality preferences saved.");}catch(e){flash(e instanceof Error?e.message:"Save failed.");}};
 const addMemory=async()=>{if(!memoryDraft.trim())return;try{await postJson("/api/agent/memories","POST",{memory:memoryDraft.trim(),category:"owner note"});setMemoryDraft("");await refresh();flash("Memory saved.");}catch(e){flash(e instanceof Error?e.message:"Could not save memory.");}};
 const removeMemory=async(id:number)=>{try{await postJson("/api/agent/memories/"+id,"DELETE");await refresh();flash("Memory deleted.");}catch(e){flash(e instanceof Error?e.message:"Could not delete memory.");}};
 const saveContact=async(id:string,enabled:boolean):Promise<boolean>=>{try{await postJson("/api/agent/contacts/"+encodeURIComponent(id),"PUT",{enabled,note:"Owner-managed allowlist"});await refresh();flash(enabled?"Contact allowed for automatic replies.":"Contact changed to manual-only.");return true;}catch(e){flash(e instanceof Error?e.message:"Could not save contact permission.");return false;}};
 return <><div className="page-heading"><div><div className="eyebrow">PERSONALIZE YOUR AGENT</div><h1>{page}</h1><p>Make your assistant work the way you do.</p></div><button className="secondary-button" onClick={()=>setPage("Overview")}>Back to overview</button></div>
 <div className="settings-layout"><div className="settings-nav">{["AI personality","Contacts","Memory","Automation","Settings"].map(s=><button key={s} onClick={()=>setPage(s)} className={s===page?"settings-active":""}>{s}</button>)}</div><div className="settings-content">
 {page==="AI personality" && <div className="panel settings-panel"><div className="panel-heading"><div><h3><Sparkles size={17}/> Your assistant's personality</h3><p>Preferences are applied to new AI replies when saved in Supabase.</p></div><span className={"tag "+(persistent?"enabled":"paused")}>{persistent?"Persistent":"Database needed"}</span></div><label className="field-label">Reply style</label><div className="choice-grid">{[["warm, friendly, natural","Warm & friendly"],["natural texting, concise, emojis when appropriate","Natural texting"],["casual & playful","Casual & playful"],["professional","Professional"],["short & direct","Short & direct"]].map(([v,label])=><button key={v} className={"choice "+(tone===v?"choice-selected":"")} onClick={()=>setTone(v)}>{label}{tone===v&&<Check size={15}/>}</button>)}</div><p className="helper-text">The agent mirrors the sender’s English or Amharic, follows the conversation context, and uses emojis only when they fit naturally.</p><label className="field-label">Language</label><select className="form-control" value={language} onChange={e=>setLanguage(e.target.value)}><option value="match the sender">Match sender</option><option value="English">English</option><option value="Amharic">Amharic</option><option value="English or Amharic">English + Amharic</option></select><label className="field-label">Reply length</label><select className="form-control" value={replyLength} onChange={e=>setReplyLength(e.target.value)}><option value="very short">Very short</option><option value="concise">Concise</option><option value="natural conversation">Natural conversation</option><option value="detailed">Detailed</option></select><div className="toggle-row"><div><b>Use saved memory</b><p>Owner-entered memories may personalize new replies.</p></div><label className="switch"><input type="checkbox" checked={memoryEnabled} onChange={e=>setMemoryEnabled(e.target.checked)}/><span/></label></div><button className="primary-button" onClick={()=>void savePersonality()}>Save personality <Check size={15}/></button></div>}
 {page==="Contacts" && <div className="panel settings-panel"><div className="panel-heading"><div><h3><ContactRound size={17}/> Contact permissions</h3><p>Only numeric Telegram sender IDs explicitly enabled here can receive replies.</p></div><span className="tag enabled">Allowlist</span></div><form onSubmit={e=>{e.preventDefault();if(!/^\d{1,22}$/.test(senderId.trim())){flash("Enter a numeric Telegram sender ID.");return;}void saveContact(senderId.trim(),false).then(saved=>{if(saved)setSenderId("");});}}><label className="field-label">Add Telegram sender ID</label><div style={{display:"flex",gap:8}}><input className="form-control" value={senderId} onChange={e=>setSenderId(e.target.value)} placeholder="Example: 123456789"/><button className="secondary-button compact" type="submit">Add</button></div></form>{loading&&<p className="helper-text">Loading contact permissions…</p>}{allowedContacts.map(c=><div className="permission-row" key={c.senderId}><div className="contact-avatar blue"><ContactRound size={18}/></div><div className="permission-copy"><b>{c.senderId}</b><span>{c.note||"Telegram sender ID"}</span></div><label className="switch"><input type="checkbox" checked={c.enabled} onChange={e=>void saveContact(c.senderId,e.target.checked)}/><span/></label><small>{c.enabled?"Allowed":"Manual only"}</small></div>)}{!loading&&allowedContacts.length===0&&<p className="helper-text">No persisted contacts yet. Add a numeric sender ID above. Supabase and the latest contact migration must be configured.</p>}</div>}
 {page==="Memory" && <div className="panel settings-panel"><div className="panel-heading"><div><h3><BrainCircuit size={17}/> Personal memory</h3><p>Only memories you explicitly add are stored and used as context.</p></div><span className={"tag "+(persistent?"enabled":"paused")}>{persistent?"Persistent":"Database needed"}</span></div><label className="field-label">Add a memory</label><textarea className="form-control" rows={3} value={memoryDraft} onChange={e=>setMemoryDraft(e.target.value)} placeholder="Example: I prefer brief, friendly replies. Never promise a meeting without asking me."/><button className="primary-button" onClick={()=>void addMemory()} disabled={!memoryDraft.trim()}>Save memory <Plus size={15}/></button>{loading&&<p className="helper-text">Loading memories…</p>}{memories.map(m=><div className="memory-card" key={m.id}><span className="memory-icon"><BrainCircuit size={16}/></span><div><b>{m.category}</b><p>{m.memory}</p><small>Saved owner memory</small></div><button className="text-link" onClick={()=>void removeMemory(m.id)}>Delete</button></div>)}{!loading&&memories.length===0&&<p className="helper-text">No saved memories. Add a preference above to begin.</p>}<p className="helper-text">Memory is not automatically extracted from private conversations. You stay in control of what is saved.</p></div>}
 {page==="Automation" && <div className="panel settings-panel"><div className="panel-heading"><div><h3><Zap size={17}/> Automation controls</h3><p>Only enabled contacts can receive automatic replies.</p></div><span className={"tag "+(automation?"enabled":"paused")}>{automation?"On":"Off"}</span></div><div className="toggle-row"><div><b>Automatic replies</b><p>Server-controlled; requires Telegram, AI, and at least one allowed contact.</p></div><label className="switch"><input type="checkbox" checked={automation} onChange={e=>{const next=e.target.checked;apiRequest(next?"/api/agent/resume":"/api/agent/pause",{method:"POST"}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error||"Request failed");setAutomation(d.automationEnabled);flash(d.automationEnabled?"Automatic replies enabled.":"Automation paused.");}).catch(e=>flash(e instanceof Error?e.message:"Could not update automation."));}}/><span/></label></div><div className="toggle-row"><div><b>Escalate sensitive messages</b><p>Payment, security, health, legal, or uncertain requests.</p></div><span className="tag enabled">Always on</span></div><button className="danger-button" onClick={()=>apiRequest("/api/agent/emergency-stop",{method:"POST"}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error||"Stop failed");setAutomation(false);setMode("Off");flash("Emergency stop enabled.");}).catch(e=>flash(e instanceof Error?e.message:"Emergency stop failed."))}><Square size={14}/> Emergency stop</button></div>}
 {page==="Settings" && <div className="panel settings-panel"><div className="panel-heading"><div><h3><Settings2 size={17}/> Integrations & system</h3><p>Connect your services securely.</p></div></div><div className="security-note"><ShieldCheck size={18}/><div><b>Dashboard authorization</b><p>Enter the DASHBOARD_API_TOKEN configured on your API host. It stays in this browser session.</p><input className="form-control" type="password" autoComplete="off" value={dashboardToken} onChange={e=>setDashboardToken(e.target.value)} placeholder="Paste dashboard API token"/><div style={{display:"flex",gap:8,marginTop:10}}><button className="secondary-button compact" onClick={()=>postJson("/api/agent/settings","GET").then(()=>flash("Dashboard authorization verified.")).catch(e=>flash(e instanceof Error?e.message:"Authorization failed."))}>Verify token</button><button className="text-link" onClick={()=>{setDashboardToken("");window.sessionStorage.removeItem("dashboardApiToken");flash("Dashboard token cleared.");}}>Clear</button></div></div></div><div className="integration-row"><div className="integration-logo telegram-logo"><Send size={18}/></div><div><b>Telegram Business</b><p>{status?.telegramConfigured?"Bot token configured":"Not connected"} · official Business Bot API</p></div><button className="secondary-button compact" onClick={()=>flash("Configure TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET on the API host, then set the webhook.")}>Setup guide</button></div><div className="integration-row"><div className="integration-logo ai-logo"><Sparkles size={18}/></div><div><b>AI provider</b><p>{status?.aiConfigured?"API key configured":"API key not configured"} · server-side only</p></div><button className="secondary-button compact" onClick={()=>flash("Set OPENAI_API_KEY on the backend host. Never put it in frontend variables.")}>Configure</button></div><div className="integration-row"><div className="integration-logo db-logo"><BrainCircuit size={18}/></div><div><b>Supabase database</b><p>{status?.storageConfigured?"Persistence configured":"Optional persistence not configured"}</p></div><button className="secondary-button compact" onClick={()=>flash("Apply the migrations in supabase/migrations and set Supabase credentials on the API host.")}>Documentation</button></div></div>}
 </div></div></>;
}
