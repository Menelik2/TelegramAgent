import { useEffect, useMemo, useState } from "react";
import { isValidTelegramSenderId } from "./telegram-id";
import { Activity, Bot, BrainCircuit, Check, ChevronDown, CircleHelp, Clock3, Command, ContactRound, Gauge, MessageCircle, Moon, MoreHorizontal, Pause, Play, Plus, Search, Send, Settings2, ShieldCheck, Sparkles, Square, Zap } from "lucide-react";

async function readJson(response: Response): Promise<Record<string, any>> {
  const raw = await response.text();
  if (!raw.trim()) {
    if (!response.ok) throw new Error(`API request failed (${response.status} ${response.statusText}). The server returned an empty response.`);
    throw new Error("The server returned an empty response instead of JSON. Check the API deployment and Vercel function logs.");
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, any>;
    throw new Error("The server returned an unexpected JSON format.");
  } catch (error) {
    if (error instanceof Error && (error.message.includes("empty response") || error.message.includes("unexpected JSON format"))) throw error;
    throw new Error(`API returned invalid JSON (HTTP ${response.status}). Check the Vercel function logs.`);
  }
}

type Status = { ok: boolean; automationEnabled: boolean; telegramConfigured: boolean; aiConfigured: boolean; storageConfigured?: boolean; mode: string; lastWebhookAt?: string | null; lastActivityAt?: string | null; appBaseUrl?: string | null; ownerIdsConfigured?: boolean };
type Contact = { id: string; senderId?: string; name: string; handle: string; initials: string; color: string; last: string; time: string; unread?: number; allowed: boolean; messages: { from: "them" | "ai"; text: string; time: string }[] };
const initialContacts: Contact[] = [
  { id: "1", name: "Mimi Bekele", handle: "@mimi_b", initials: "MB", color: "lilac", last: "Are we still meeting this afternoon?", time: "2m", unread: 2, allowed: true, messages: [{ from: "them", text: "Hey! Hope your morning is going well", time: "9:14" }, { from: "ai", text: "Hey Mimi! It is, thank you. Hope yours is too!", time: "9:15" }, { from: "them", text: "Are we still meeting this afternoon?", time: "9:18" }] },
  { id: "2", name: "Daniel T.", handle: "@daniel_t", initials: "DT", color: "blue", last: "Sent you the notes from yesterday", time: "18m", allowed: false, messages: [{ from: "them", text: "Sent you the notes from yesterday.", time: "8:52" }] },
  { id: "3", name: "Selam Work", handle: "@selam_work", initials: "SW", color: "mint", last: "Thanks, that helps a lot!", time: "1h", allowed: true, messages: [{ from: "them", text: "Do you have a minute to look at this?", time: "8:02" }, { from: "ai", text: "Sure, send it over and I will take a look.", time: "8:04" }, { from: "them", text: "Thanks, that helps a lot!", time: "8:08" }] },
  { id: "4", name: "Abel Girma", handle: "@abelg", initials: "AG", color: "peach", last: "Can you send me the link?", time: "3h", allowed: false, messages: [{ from: "them", text: "Can you send me the link?", time: "06:42" }] }
];
const nav = [{ label: "Overview", icon: Gauge }, { label: "Inbox", icon: MessageCircle }, { label: "AI personality", icon: Sparkles }, { label: "Contacts", icon: ContactRound }, { label: "Memory", icon: BrainCircuit }, { label: "Automation", icon: Zap }, { label: "Settings", icon: Settings2 }];

function MemoryPanel({ apiRequest, readJson, flash }: { apiRequest: (path: string, init?: RequestInit) => Promise<Response>; readJson: (r: Response) => Promise<Record<string, any>>; flash: (m: string) => void }) {
  const [items, setItems] = useState<Array<{ id: number; memory: string; category: string }>>([]);
  const [draft, setDraft] = useState("");
  const load = () => apiRequest("/api/agent/memories").then(async r => { const d = await readJson(r); if (!r.ok) throw new Error(d.error || "Failed"); setItems(d.memories || []); }).catch(e => flash(e instanceof Error ? e.message : "Could not load memories"));
  useEffect(() => { void load(); }, []);
  return <div>
    <div style={{display:"flex",gap:8,marginBottom:12}}>
      <input className="form-control" style={{flex:1}} value={draft} onChange={e => setDraft(e.target.value)} placeholder="e.g. Prefer short Amharic replies with friends"/>
      <button className="secondary-button compact" onClick={() => { if (draft.trim().length < 2) return; apiRequest("/api/agent/memories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ memory: draft.trim() }) }).then(async r => { const d = await readJson(r); if (!r.ok) throw new Error(d.error || "Failed"); setDraft(""); flash("Memory saved."); return load(); }).catch(e => flash(e instanceof Error ? e.message : "Save failed")); }}>Add</button>
    </div>
    <ul style={{listStyle:"none",padding:0}}>{items.map(m => <li key={m.id} style={{display:"flex",justifyContent:"space-between",gap:8,padding:"8px 0",borderBottom:"1px solid rgba(255,255,255,0.06)"}}><span>{m.memory}</span><button className="text-link" onClick={() => apiRequest("/api/agent/memories/" + m.id, { method: "DELETE" }).then(async r => { const d = await readJson(r); if (!r.ok) throw new Error(d.error || "Failed"); flash("Deleted."); return load(); }).catch(e => flash(e instanceof Error ? e.message : "Delete failed"))}>Delete</button></li>)}</ul>
    {items.length === 0 && <p className="helper-text">No memories yet.</p>}
  </div>;
}

function PersonalityPanel({ apiRequest, readJson, flash }: { apiRequest: (path: string, init?: RequestInit) => Promise<Response>; readJson: (r: Response) => Promise<Record<string, any>>; flash: (m: string) => void }) {
  const [tone, setTone] = useState("warm, friendly, natural");
  const [language, setLanguage] = useState("match the sender; Amharic or English");
  const [replyLength, setReplyLength] = useState("concise");
  const [memoryEnabled, setMemoryEnabled] = useState(true);
  useEffect(() => {
    apiRequest("/api/agent/preferences").then(async r => {
      const d = await readJson(r);
      if (!r.ok) throw new Error(d.error || "Failed");
      const p = d.preferences || {};
      if (p.tone) setTone(p.tone);
      if (p.language) setLanguage(p.language);
      if (p.replyLength) setReplyLength(p.replyLength);
      if (typeof p.memoryEnabled === "boolean") setMemoryEnabled(p.memoryEnabled);
    }).catch(e => flash(e instanceof Error ? e.message : "Could not load preferences"));
  }, []);
  return <div style={{display:"grid",gap:12,maxWidth:480}}>
    <label>Tone<input className="form-control" value={tone} onChange={e => setTone(e.target.value)}/></label>
    <label>Language<input className="form-control" value={language} onChange={e => setLanguage(e.target.value)}/></label>
    <label>Reply length<input className="form-control" value={replyLength} onChange={e => setReplyLength(e.target.value)}/></label>
    <label style={{display:"flex",gap:8,alignItems:"center"}}><input type="checkbox" checked={memoryEnabled} onChange={e => setMemoryEnabled(e.target.checked)}/> Use saved memories</label>
    <button className="primary-button" onClick={() => apiRequest("/api/agent/preferences", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tone, language, replyLength, memoryEnabled }) }).then(async r => { const d = await readJson(r); if (!r.ok) throw new Error(d.error || "Failed"); flash("Personality saved."); }).catch(e => flash(e instanceof Error ? e.message : "Save failed"))}>Save</button>
  </div>;
}

export default function App() {
  const [page, setPage] = useState("Overview");
  const [contacts, setContacts] = useState(initialContacts);
  const [selectedId, setSelectedId] = useState("1");
  const [query, setQuery] = useState("");
  const [automation, setAutomation] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [activityEvents, setActivityEvents] = useState<Array<{id?:number;kind:string;detail:string;createdAt?:string}>>([]);
  const [liveMetrics, setLiveMetrics] = useState({ messages: 0, replies: 0, review: 0 });
  const [inboxLive, setInboxLive] = useState(false);
  const [inboxLoading, setInboxLoading] = useState(false);
  const [inboxFilter, setInboxFilter] = useState<"all" | "allowed" | "manual">("all");
  const [inboxError, setInboxError] = useState("");
  const [webhookInfo, setWebhookInfo] = useState<{ expectedUrl?: string | null; matchesExpected?: boolean; webhook?: { url?: string; pending_update_count?: number; last_error_message?: string } } | null>(null);
  const [dashboardToken, setDashboardToken] = useState(() => window.sessionStorage.getItem("dashboardApiToken") || "");
  const apiBase = import.meta.env.VITE_API_BASE_URL || "";
  const apiRequest = (path: string, init: RequestInit = {}) => fetch(`${apiBase}${path}`, { ...init, headers: { ...(init.headers || {}), "x-dashboard-token": dashboardToken } });
  const [draft, setDraft] = useState("");
  const [toast, setToast] = useState("");
  const selected = contacts.find(c => c.id === selectedId) ?? contacts[0] ?? (inboxLive ? undefined : initialContacts[0]);
  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return contacts.filter(c => {
      if (q && !(c.name + " " + c.handle).toLowerCase().includes(q)) return false;
      if (inboxFilter === "allowed") return c.allowed;
      if (inboxFilter === "manual") return !c.allowed;
      return true;
    });
  }, [contacts, query, inboxFilter]);
  useEffect(() => { fetch(`${apiBase}/api/status`).then(r => readJson(r)).then((value: Status) => { setStatus(value); setAutomation(value.automationEnabled); }).catch(() => setStatus(null)); }, [apiBase]);
  useEffect(() => { if (dashboardToken) window.sessionStorage.setItem("dashboardApiToken", dashboardToken); else window.sessionStorage.removeItem("dashboardApiToken"); }, [dashboardToken]);
  useEffect(() => {
    if (!dashboardToken) { setActivityEvents([]); setLiveMetrics({ messages: 0, replies: 0, review: 0 }); return; }
    let active = true;
    Promise.all([apiRequest("/api/activity?limit=100"), apiRequest("/api/inbox")])
      .then(async ([activityResponse, inboxResponse]) => {
        const activityData = await readJson(activityResponse);
        const inboxData = await readJson(inboxResponse);
        if (!activityResponse.ok) throw new Error(activityData.error || "Activity unavailable.");
        if (!inboxResponse.ok) throw new Error(inboxData.error || "Inbox unavailable.");
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
      .catch(() => { if (active) { setActivityEvents([]); setLiveMetrics({ messages: 0, replies: 0, review: 0 }); } });
    return () => { active = false; };
  }, [dashboardToken, apiBase]);
  const flash = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 2600); };
  const refreshLiveInbox = async () => {
    if (!dashboardToken) { flash("Enter your dashboard API token in Settings first."); return; }
    setInboxLoading(true);
    setInboxError("");
    try {
      const [inboxResponse, contactsResponse, activityResponse] = await Promise.all([
        apiRequest("/api/inbox"), apiRequest("/api/agent/contacts"), apiRequest("/api/activity?limit=100")
      ]);
      const inboxData = await readJson(inboxResponse);
      if (!inboxResponse.ok) throw new Error(inboxData.error || "Live inbox could not be loaded.");
      const contactData = contactsResponse.ok ? await readJson(contactsResponse) : { contacts: [] };
      if (activityResponse.ok) {
        const activityData = await readJson(activityResponse);
        const events = (activityData.events || []) as Array<{id?:number;kind:string;detail:string;createdAt?:string}>;
        setActivityEvents(events);
        setLiveMetrics({
          messages: (inboxData.conversations || []).reduce((total: number, item: {messageCount?:number}) => total + Number(item.messageCount || 0), 0),
          replies: events.filter(event => event.kind === "reply_sent" || event.kind === "manual_reply_sent").length,
          review: events.filter(event => event.kind === "owner_review_required" || event.kind === "blocked" || event.kind === "delivery_failed").length
        });
      }
      const permissions = new Map<string, boolean>((contactData.contacts || []).map((x: {senderId:string;enabled:boolean}) => [x.senderId, x.enabled]));
      const colors = ["lilac", "blue", "mint", "peach"];
      const mapped: Contact[] = (inboxData.conversations || []).map((item: {chatId:string;senderId?:string;senderName:string;username:string;lastMessage:string;lastMessageAt:string;lastDirection:string}, i:number) => ({
        id: item.chatId, senderId: item.senderId, name: item.senderName || item.username || item.chatId,
        handle: item.username ? "@" + item.username : (item.senderId ? "id " + item.senderId : item.chatId),
        initials: (item.senderName || item.username || item.chatId).split(/\s+/).slice(0,2).map((s:string)=>s[0]).join("").toUpperCase() || "?",
        color: colors[i % colors.length], last: item.lastMessage,
        time: item.lastMessageAt ? new Date(item.lastMessageAt).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}) : "",
        unread: item.lastDirection === "incoming" ? 1 : undefined,
        allowed: item.senderId ? permissions.get(item.senderId) === true : false, messages: []
      }));
      setInboxLive(true);
      let nextSelected = "";
      if (mapped.length) {
        setContacts(previous => {
          const prevMessages = new Map(previous.map(c => [c.id, c.messages]));
          return mapped.map(c => ({ ...c, messages: prevMessages.get(c.id) || [] }));
        });
        setSelectedId(previous => { nextSelected = mapped.some(item => item.id === previous) ? previous : mapped[0].id; return nextSelected; });
      } else { setContacts([]); setSelectedId(""); }
      flash(mapped.length ? "Live Telegram inbox loaded." : "No conversations yet. When someone messages you, it will appear here.");
      if (nextSelected) {
        apiRequest("/api/inbox/" + encodeURIComponent(nextSelected) + "/messages").then(async response => {
          const data = await readJson(response);
          if (!response.ok) return;
          setContacts(previous => previous.map(contact => contact.id === nextSelected ? {
            ...contact,
            messages: (data.messages || []).map((m: {direction:string;text:string;createdAt?:string}) => ({
              from: m.direction === "outgoing" ? "ai" as const : "them" as const,
              text: m.text,
              time: m.createdAt ? new Date(m.createdAt).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}) : ""
            }))
          } : contact));
        }).catch(() => undefined);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Live inbox unavailable.";
      setInboxError(message);
      flash(message);
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
      const data = await readJson(response);
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
        .then(async response => { const data = await readJson(response); if (!response.ok) throw new Error(data.error || "Permission update failed."); setContacts(previous => previous.map(item => item.id === id ? {...item,allowed:enabled}:item)); flash(enabled ? "Contact allowed for automatic replies." : "Contact set to manual-only."); })
        .catch(error => flash(error instanceof Error ? error.message : "Permission update failed."));
    } else if (!inboxLive) setContacts(previous => previous.map(item => item.id === id ? { ...item, allowed: !item.allowed } : item));
    else flash("This conversation has no sender ID.");
  };
  const sendDemo = async () => {
    if (!draft.trim() || !selected) return;
    if (inboxLive) {
      try {
        const response = await apiRequest("/api/inbox/" + encodeURIComponent(selected.id) + "/reply", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:draft.trim()})});
        const data = await readJson(response);
        if (!response.ok) throw new Error(data.error || "Telegram reply failed.");
        setDraft(""); flash("Reply sent through Telegram."); await refreshLiveInbox();
      } catch (error) { flash(error instanceof Error ? error.message : "Telegram reply failed."); }
      return;
    }
    setContacts(previous => previous.map(item => item.id === selectedId ? { ...item, messages: [...item.messages, { from: "ai", text: draft.trim(), time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }], last: draft.trim() } : item));
    setDraft(""); flash("Preview added locally.");
  };
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Bot size={21}/></div><div><strong>telegram<span>agent</span></strong><small>PERSONAL AI</small></div></div>
      <div className="nav-label">WORKSPACE</div>
      <nav>{nav.map(item => <button key={item.label} onClick={() => setPage(item.label)} className={"nav-item " + (page === item.label ? "active" : "")}><item.icon size={18}/><span>{item.label}</span>{item.label === "Inbox" && <em>{inboxLive ? contacts.length : "—"}</em>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="user-row"><div className="user-avatar">M</div><div><b>Menelik</b><small>Personal account</small></div></div></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div className="crumb">Workspace / <b>{page}</b></div><div className="top-actions"><div className="connection-pill"><span className={"dot " + (status?.telegramConfigured ? "green" : "amber")}></span>{status?.telegramConfigured ? "Telegram connected" : "Telegram not connected"}</div></div></header>
      <div className="content">
        {page === "Inbox" ? <div className="inbox-page">
          <div className="page-heading"><div><div className="eyebrow">YOUR CONVERSATIONS</div><h1>Inbox<span className="heading-count">{inboxLive ? contacts.length : "04"}</span></h1><p>{!dashboardToken ? "Demo preview — enter dashboard token in Settings for real messages." : inboxLive ? "Live Telegram conversations." : "Connect token and refresh to load live messages."}</p></div><button className="secondary-button" onClick={() => void refreshLiveInbox()} disabled={inboxLoading}>{inboxLoading ? "Loading…" : "Refresh live inbox"}</button></div>
          <div className="inbox-layout"><section className="inbox-list"><div className="searchbox"><Search size={16}/><input placeholder="Search conversations..." value={query} onChange={e => setQuery(e.target.value)}/></div>
            <div className="filter-row">
              <button className={inboxFilter === "all" ? "filter-active" : ""} onClick={() => setInboxFilter("all")}>All <span>{contacts.length}</span></button>
              <button className={inboxFilter === "allowed" ? "filter-active" : ""} onClick={() => setInboxFilter("allowed")}>Auto-reply <span>{contacts.filter(c => c.allowed).length}</span></button>
              <button className={inboxFilter === "manual" ? "filter-active" : ""} onClick={() => setInboxFilter("manual")}>Manual <span>{contacts.filter(c => !c.allowed).length}</span></button>
            </div>
            {inboxError ? <p className="helper-text" style={{padding:"8px 16px",color:"#b91c1c"}}>{inboxError}</p> : null}
            {filtered.map(c => <button className={"conversation " + (selectedId === c.id ? "selected" : "")} key={c.id} onClick={() => setSelectedId(c.id)}><div className={"contact-avatar " + c.color}>{c.initials}</div><div className="conversation-copy"><div className="conversation-name"><b>{c.name}</b><time>{c.time}</time></div><p>{c.last}</p><div className="conversation-tags">{c.allowed ? <span className="tag enabled">Auto-reply</span> : <span className="tag paused">Manual</span>}{c.unread ? <span className="unread">{c.unread}</span> : null}</div></div></button>)}
            {filtered.length === 0 && <p className="helper-text" style={{padding:20}}>{inboxLive ? "No conversations yet." : "No matching conversations."}</p>}
          </section>
          {selected ? <section className="chat-panel"><div className="chat-header"><div className={"contact-avatar " + selected.color}>{selected.initials}</div><div className="chat-contact"><b>{selected.name}</b><span>{selected.handle} · {selected.allowed ? "Auto-reply enabled" : "Manual only"}</span></div><button className="secondary-button compact" onClick={() => toggleContact(selected.id)}>{selected.allowed ? "Pause AI" : "Allow AI"}</button></div><div className="message-stream">{selected.messages.map((m,i) => <div key={i} className={"message-row " + (m.from === "ai" ? "outgoing" : "")}><div className={"bubble " + (m.from === "ai" ? "bubble-ai" : "bubble-them")}>{m.text}<time>{m.time}</time></div></div>)}</div><div className="reply-box"><textarea value={draft} onChange={e => setDraft(e.target.value)} placeholder={inboxLive ? "Write a reply…" : "Preview reply…"} rows={2}/><button className="send-button" onClick={() => void sendDemo()} disabled={!draft.trim()}><Send size={16}/> Send</button></div></section> : <section className="chat-panel"><p className="helper-text" style={{padding:40}}>Select a conversation.</p></section>}
          </div>
        </div> : page === "Settings" ? <div className="panel settings-panel">
          <div className="panel-heading"><h3>Integrations & system</h3><p>Connect Telegram, verify the webhook, and unlock the live inbox.</p></div>
          <div className="security-note"><ShieldCheck size={18}/><div>
            <b>Dashboard authorization</b>
            <p>Enter the DASHBOARD_API_TOKEN from Vercel. It stays in this browser session only.</p>
            <input className="form-control" type="password" autoComplete="off" value={dashboardToken} onChange={e=>setDashboardToken(e.target.value)} placeholder="Paste dashboard API token"/>
            <div style={{display:"flex",gap:8,marginTop:10,flexWrap:"wrap"}}>
              <button className="secondary-button compact" onClick={()=>apiRequest("/api/agent/settings").then(async r=>{const d=await readJson(r); if(!r.ok) throw new Error(d.error||"Auth failed"); flash("Token verified.");}).catch(e=>flash(e instanceof Error?e.message:"Auth failed"))}>Verify token</button>
              <button className="text-link" onClick={()=>{setDashboardToken(""); flash("Token cleared.");}}>Clear</button>
            </div>
          </div></div>
          <div className="integration-row"><div><b>Telegram</b><p>{status?.telegramConfigured?"Token configured":"Not connected"} · {status?.appBaseUrl || "APP_BASE_URL not set"}</p></div>
            <button className="secondary-button compact" disabled={!dashboardToken} onClick={()=>apiRequest("/api/agent/telegram/configure-webhook",{method:"POST"}).then(async r=>{const d=await readJson(r); if(!r.ok) throw new Error(d.error||"Failed"); flash(d.message||"Webhook configured."); return apiRequest("/api/agent/telegram/webhook-info");}).then(async r=>{ if(!r||!r.ok) return; const d=await readJson(r); setWebhookInfo(d); }).catch(e=>flash(e instanceof Error?e.message:"Webhook failed"))}>Configure webhook</button>
          </div>
          <div className="integration-row"><div><b>Webhook health</b><p>{webhookInfo?.webhook?.url ? `Active: ${webhookInfo.webhook.url}` : "Click Configure webhook or Refresh info"}{webhookInfo?.webhook?.last_error_message ? ` · Error: ${webhookInfo.webhook.last_error_message}` : ""}{typeof webhookInfo?.webhook?.pending_update_count === "number" ? ` · Pending: ${webhookInfo.webhook.pending_update_count}` : ""}</p>
            <p style={{opacity:0.75,marginTop:4}}>{status?.lastWebhookAt ? `Last activity: ${new Date(status.lastWebhookAt).toLocaleString()}` : "No webhook activity recorded yet."}{status?.ownerIdsConfigured ? " · Owner IDs set" : " · Set TELEGRAM_OWNER_USER_IDS to avoid replying to yourself"}</p></div>
            <button className="secondary-button compact" disabled={!dashboardToken} onClick={()=>apiRequest("/api/agent/telegram/webhook-info").then(async r=>{const d=await readJson(r); if(!r.ok) throw new Error(d.error||"Failed"); setWebhookInfo(d); flash(d.matchesExpected ? "Webhook URL matches APP_BASE_URL." : "Webhook URL does not match APP_BASE_URL — reconfigure.");}).catch(e=>flash(e instanceof Error?e.message:"Could not load webhook info"))}>Refresh info</button>
          </div>
          <div className="integration-row"><div><b>AI provider</b><p>{status?.aiConfigured?"Gemini configured":"GEMINI_API_KEY missing"} · use gemini-3.5-flash-lite on free tier</p></div></div>
          <div className="integration-row"><div><b>Supabase</b><p>{status?.storageConfigured?"Persistence configured":"Required for Vercel live inbox"}</p></div></div>
          <div className="helper-text" style={{padding:"12px 0"}}>
            <b>Setup checklist</b>
            <ol style={{margin:"8px 0 0 18px",lineHeight:1.5}}>
              <li>Vercel: APP_BASE_URL=https://telegramagenets.vercel.app</li>
              <li>Paste dashboard token → Verify</li>
              <li>Configure webhook → Refresh info (URL must match)</li>
              <li>Inbox → Refresh live inbox → Allow a contact</li>
              <li>Keep Automation ON · message from another account</li>
            </ol>
          </div>
        </div>
         : page === "Overview" ? <div>
          <div className="page-heading"><div className="eyebrow">STATUS</div><h1>Overview</h1>
            <p>{status?.telegramConfigured ? "Telegram configured" : "Telegram not configured"} · {status?.aiConfigured ? "AI ready" : "AI missing"} · {status?.storageConfigured ? "Storage ready" : "Storage missing"} · Automation {automation ? "ON" : "OFF"}</p>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:12,marginBottom:20}}>
            <div className="panel" style={{padding:16}}><div className="eyebrow">MESSAGES</div><h2 style={{margin:0}}>{liveMetrics.messages}</h2></div>
            <div className="panel" style={{padding:16}}><div className="eyebrow">REPLIES</div><h2 style={{margin:0}}>{liveMetrics.replies}</h2></div>
            <div className="panel" style={{padding:16}}><div className="eyebrow">NEEDS REVIEW</div><h2 style={{margin:0}}>{liveMetrics.review}</h2></div>
          </div>
          <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:20}}>
            <button className={"primary-button " + (automation ? "running" : "")} onClick={() => { if(!dashboardToken){flash("Enter dashboard token in Settings first."); return;} const next = !automation; apiRequest(next ? "/api/agent/resume" : "/api/agent/pause", { method: "POST" }).then(async r => { const data = await readJson(r); if (!r.ok) throw new Error(data.error || "Request failed"); setAutomation(data.automationEnabled); flash(data.automationEnabled ? "Automatic replies enabled." : "Automation paused."); }).catch(error => flash(error instanceof Error ? error.message : "Could not update automation.")); }}>{automation ? "Pause automation" : "Start automation"}</button>
            <button className="secondary-button" onClick={() => setPage("Inbox")}>Open inbox</button>
            <button className="secondary-button" onClick={() => setPage("Settings")}>Settings</button>
          </div>
          <div className="panel" style={{padding:16}}>
            <div className="panel-heading" style={{marginBottom:8}}><h3 style={{margin:0}}>Recent activity</h3></div>
            {!dashboardToken && <p className="helper-text">Enter your dashboard token in Settings to load live activity.</p>}
            {dashboardToken && activityEvents.length === 0 && <p className="helper-text">No events yet. After the webhook is configured, activity appears here.</p>}
            <ul style={{listStyle:"none",padding:0,margin:0,maxHeight:280,overflow:"auto"}}>
              {activityEvents.slice(0,20).map((e,i) => (
                <li key={e.id ?? i} style={{padding:"8px 0",borderBottom:"1px solid rgba(255,255,255,0.06)"}}>
                  <b>{e.kind}</b> — {e.detail}
                  {e.createdAt ? <span style={{opacity:0.6,marginLeft:8}}>{new Date(e.createdAt).toLocaleString()}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        </div>
        : page === "Contacts" ? <div className="panel" style={{padding:20}}>
          <div className="page-heading"><h1>Contacts</h1><p>Allowlist is managed from the live Inbox. Open a conversation and use Allow AI / Pause AI.</p></div>
          {!dashboardToken && <p className="helper-text">Enter dashboard token in Settings first.</p>}
          {dashboardToken && <button className="secondary-button" onClick={() => setPage("Inbox")}>Go to Inbox</button>}
        </div>
        : page === "Memory" ? <div className="panel" style={{padding:20}}>
          <div className="page-heading"><h1>Memory</h1><p>Owner-approved notes the AI can use when replying as you.</p></div>
          {!dashboardToken && <p className="helper-text">Enter dashboard token in Settings first.</p>}
          {dashboardToken && <MemoryPanel apiRequest={apiRequest} readJson={readJson} flash={flash} />}
        </div>
        : page === "AI personality" ? <div className="panel" style={{padding:20}}>
          <div className="page-heading"><h1>AI personality</h1><p>Tone and language for replies written as you — contacts should never know it is automated.</p></div>
          {!dashboardToken && <p className="helper-text">Enter dashboard token in Settings first.</p>}
          {dashboardToken && <PersonalityPanel apiRequest={apiRequest} readJson={readJson} flash={flash} />}
        </div>
        : page === "Automation" ? <div className="panel" style={{padding:20}}>
          <div className="page-heading"><h1>Automation</h1><p>Global switch for automatic replies. Individual contacts still need Allow AI in Inbox.</p></div>
          <p>Status: <b>{automation ? "ON" : "OFF"}</b></p>
          <button className={"primary-button " + (automation ? "running" : "")} onClick={() => { if(!dashboardToken){flash("Enter dashboard token in Settings first."); return;} const next = !automation; apiRequest(next ? "/api/agent/resume" : "/api/agent/pause", { method: "POST" }).then(async r => { const data = await readJson(r); if (!r.ok) throw new Error(data.error || "Request failed"); setAutomation(data.automationEnabled); flash(data.automationEnabled ? "Automatic replies enabled." : "Automation paused."); }).catch(error => flash(error instanceof Error ? error.message : "Could not update automation.")); }}>{automation ? "Pause automation" : "Start automation"}</button>
        </div>
        : <div className="page-heading"><h1>{page}</h1><p>Use Settings to connect Telegram, then open Inbox for live conversations.</p></div>}
      </div>
    </main>
    {toast ? <div className="toast">{toast}</div> : null}
  </div>;
}
