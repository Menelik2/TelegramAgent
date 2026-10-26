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
  const [inboxFilter, setInboxFilter] = useState<"all" | "allowed" | "manual">("all");
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [inboxError, setInboxError] = useState("");
  const [dashboardToken, setDashboardToken] = useState(() => window.sessionStorage.getItem("dashboardApiToken") || "");
  const apiBase = import.meta.env.VITE_API_BASE_URL || "";
  const apiRequest = (path: string, init: RequestInit = {}) => fetch(`${apiBase}${path}`, { ...init, headers: { ...(init.headers || {}), "x-dashboard-token": dashboardToken } });
  const [draft, setDraft] = useState("");
  const [toast, setToast] = useState("");
  const selected = contacts.find(c => c.id === selectedId) ?? contacts[0] ?? (inboxLive ? undefined : initialContacts[0]);
  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return contacts.filter(c => {
      const matchesQuery = !q || (c.name + " " + c.handle).toLowerCase().includes(q);
      if (!matchesQuery) return false;
      if (inboxFilter === "allowed") return c.allowed;
      if (inboxFilter === "manual") return !c.allowed;
      return true;
    });
  }, [contacts, query, inboxFilter]);
  useEffect(() => { fetch(`${apiBase}/api/status`).then(r => readJson(r)).then((value: Status) => { setStatus(value); setAutomation(value.automationEnabled); }).catch(() => setStatus(null)); }, [apiBase]);
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
        const activityData = await readJson(activityResponse);
        const inboxData = await readJson(inboxResponse);
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

  const loadConversationMessages = async (chatId: string) => {
    if (!dashboardToken || !chatId) return;
    setMessagesLoading(true);
    try {
      const response = await apiRequest("/api/inbox/" + encodeURIComponent(chatId) + "/messages");
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.error || "Could not load conversation.");
      setContacts(previous => previous.map(contact => contact.id === chatId ? {
        ...contact,
        messages: (data.messages || []).map((m: {direction:string;text:string;createdAt?:string}) => ({
          from: m.direction === "outgoing" ? "ai" as const : "them" as const,
          text: m.text,
          time: m.createdAt ? new Date(m.createdAt).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}) : ""
        }))
      } : contact));
    } catch (error) {
      flash(error instanceof Error ? error.message : "Could not load conversation.");
    } finally {
      setMessagesLoading(false);
    }
  };

  const refreshLiveInbox = async (options?: { quiet?: boolean }) => {
    if (!dashboardToken) {
      if (!options?.quiet) flash("Enter your dashboard API token in Settings first.");
      return;
    }
    if (!options?.quiet) setInboxLoading(true);
    setInboxError("");
    try {
      const [inboxResponse, contactsResponse, activityResponse] = await Promise.all([
        apiRequest("/api/inbox"),
        apiRequest("/api/agent/contacts"),
        apiRequest("/api/activity?limit=100")
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
      const mapped: Contact[] = (inboxData.conversations || []).map((item: {
        chatId:string;senderId?:string;senderName:string;username:string;lastMessage:string;lastMessageAt:string;lastDirection:string;messageCount?:number
      }, i:number) => {
        const displayName = item.senderName || item.username || item.chatId;
        const initials = displayName.split(/\s+/).filter(Boolean).slice(0,2).map((s:string)=>s[0] || "").join("").toUpperCase() || "?";
        return {
          id: item.chatId,
          senderId: item.senderId,
          name: displayName,
          handle: item.username ? "@" + item.username : (item.senderId ? "id " + item.senderId : item.chatId),
          initials,
          color: colors[i % colors.length],
          last: item.lastMessage,
          time: item.lastMessageAt ? new Date(item.lastMessageAt).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}) : "",
          unread: item.lastDirection === "incoming" ? 1 : undefined,
          allowed: item.senderId ? permissions.get(item.senderId) === true : false,
          messages: []
        };
      });
      setInboxLive(true);
      let nextSelected = "";
      if (mapped.length) {
        setContacts(previous => {
          const prevMessages = new Map(previous.map(c => [c.id, c.messages]));
          return mapped.map(c => ({ ...c, messages: prevMessages.get(c.id) || [] }));
        });
        setSelectedId(previous => {
          nextSelected = mapped.some(item => item.id === previous) ? previous : mapped[0].id;
          return nextSelected;
        });
      } else {
        setContacts([]);
        setSelectedId("");
      }
      if (!options?.quiet) {
        flash(mapped.length ? "Live Telegram inbox loaded." : "No conversations yet. When someone messages you, it will appear here.");
      }
      if (nextSelected) {
        window.setTimeout(() => { void loadConversationMessages(nextSelected); }, 0);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Live inbox unavailable.";
      setInboxError(message);
      if (!options?.quiet) flash(message);
    } finally {
      if (!options?.quiet) setInboxLoading(false);
    }
  };
  useEffect(() => {
    if (!dashboardToken) { setInboxLive(false); setContacts(initialContacts); setSelectedId("1"); return; }
    const timer = window.setTimeout(() => { void refreshLiveInbox(); }, 700);
    return () => window.clearTimeout(timer);
  }, [dashboardToken, apiBase]);
  useEffect(() => {
    if (page !== "Inbox" || !inboxLive || !selectedId || !dashboardToken) return;
    void loadConversationMessages(selectedId);
  }, [page, inboxLive, selectedId, dashboardToken]);

  // Quiet auto-refresh while the Inbox page is open.
  useEffect(() => {
    if (page !== "Inbox" || !dashboardToken || !inboxLive) return;
    const timer = window.setInterval(() => { void refreshLiveInbox({ quiet: true }); }, 15000);
    return () => window.clearInterval(timer);
  }, [page, dashboardToken, inboxLive, apiBase]);
  const toggleContact = (id: string) => {
    const contact = contacts.find(item => item.id === id);
    if (!contact) return;
    if (inboxLive && contact.senderId) {
      const enabled = !contact.allowed;
      apiRequest("/api/agent/contacts/" + encodeURIComponent(contact.senderId), {method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled,note:"Owner-managed allowlist"})})
        .then(async response => { const data = await readJson(response); if (!response.ok) throw new Error(data.error || "Permission update failed."); setContacts(previous => previous.map(item => item.id === id ? {...item,allowed:enabled}:item)); flash(enabled ? "Contact allowed for automatic replies." : "Contact set to manual-only."); })
        .catch(error => flash(error instanceof Error ? error.message : "Permission update failed."));
    } else if (!inboxLive) setContacts(previous => previous.map(item => item.id === id ? { ...item, allowed: !item.allowed } : item));
    else flash("This conversation has no sender ID, so automatic replies cannot be enabled.");
  };
  const sendDemo = async () => {
    if (!draft.trim() || !selected) return;
    if (inboxLive) {
      try {
        const response = await apiRequest("/api/inbox/" + encodeURIComponent(selected.id) + "/reply", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:draft.trim()})});
        const data = await readJson(response);
        if (!response.ok) throw new Error(data.error || "Telegram reply failed.");
        setDraft(""); flash("Reply sent through Telegram."); await refreshLiveInbox({ quiet: true }); if (selected?.id) await loadConversationMessages(selected.id);
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
          <div className="page-heading"><div><div className="eyebrow">YOUR CONVERSATIONS</div><h1>Inbox<span className="heading-count">{inboxLive ? contacts.length : "04"}</span></h1><p>{inboxLive ? "Live Telegram conversations — private and Business." : "Preview conversations — enter your dashboard token in Settings to load real messages."}</p></div><button className="secondary-button" onClick={() => void refreshLiveInbox()} disabled={inboxLoading}><Command size={16}/> {inboxLoading ? "Loading…" : "Refresh live inbox"}</button></div>
          <div className="inbox-layout"><section className="inbox-list"><div className="searchbox"><Search size={16}/><input placeholder="Search conversations..." value={query} onChange={e => setQuery(e.target.value)}/><kbd>⌘ K</kbd></div>
            <div className="filter-row">
              <button className={inboxFilter === "all" ? "filter-active" : ""} onClick={() => setInboxFilter("all")}>All <span>{contacts.length}</span></button>
              <button className={inboxFilter === "allowed" ? "filter-active" : ""} onClick={() => setInboxFilter("allowed")}>Auto-reply <span>{contacts.filter(c => c.allowed).length}</span></button>
              <button className={inboxFilter === "manual" ? "filter-active" : ""} onClick={() => setInboxFilter("manual")}>Manual <span>{contacts.filter(c => !c.allowed).length}</span></button>
            </div>
            {inboxError && <p className="helper-text" style={{padding:"8px 16px",color:"#b91c1c"}}>{inboxError}</p>}
            {filtered.map(c => <button className={"conversation " + (selectedId === c.id ? "selected" : "")} key={c.id} onClick={() => setSelectedId(c.id)}><div className={"contact-avatar " + c.color}>{c.initials}</div><div className="conversation-copy"><div className="conversation-name"><b>{c.name}</b><time>{c.time}</time></div><p>{c.last}</p><div className="conversation-tags">{c.allowed ? <span className="tag enabled"><Zap size={11}/> Auto-reply</span> : <span className="tag paused"><Pause size={10}/> Manual</span>}{c.unread && <span className="unread">{c.unread}</span>}</div></div></button>)}{filtered.length === 0 && <p className="helper-text" style={{padding:20}}>{inboxLive ? "No live conversations yet. Once Telegram delivers a message, it will appear here." : "No matching preview conversations."}</p>}</section>
          {selected ? <section className="chat-panel"><div className="chat-header"><div className={"contact-avatar " + selected.color}>{selected.initials}</div><div className="chat-contact"><b>{selected.name}</b><span>{selected.handle} · {selected.allowed ? "Auto-reply enabled" : "Manual replies only"}</span></div><button className="secondary-button compact" onClick={() => toggleContact(selected.id)}>{selected.allowed ? <Pause size={14}/> : <Play size={14}/>} {selected.allowed ? "Pause AI" : "Allow AI"}</button><button className="icon-button" aria-label="More options"><MoreHorizontal size={18}/></button></div><div className="chat-notice"><ShieldCheck size={15}/><span>Private conversation · replies follow your contact permissions</span></div><div className="message-stream"><div className="date-divider"><span>TODAY</span></div>
                {messagesLoading && selected.messages.length === 0 && <p className="helper-text" style={{padding:16}}>Loading messages…</p>}
                {!messagesLoading && selected.messages.length === 0 && inboxLive && <p className="helper-text" style={{padding:16}}>No messages stored for this chat yet.</p>}
                {selected.messages.map((m,i) => <div key={i} className={"message-row " + (m.from === "ai" ? "outgoing" : "")}>{m.from === "ai" && <div className="ai-mini"><Sparkles size={12}/></div>}<div className={"bubble " + (m.from === "ai" ? "bubble-ai" : "bubble-them")}>{m.from === "ai" && <div className="bubble-label"><Sparkles size={11}/> AI ASSISTANT</div>}{m.text}<time>{m.time}</time></div></div>)}</div><div className="reply-box"><div className="reply-mode"><Sparkles size={13}/> {inboxLive ? "Manual reply" : "Preview reply"}</div><textarea value={draft} onChange={e => setDraft(e.target.value)} placeholder={inboxLive ? "Write a reply to send on Telegram…" : "Type a preview reply…"} rows={2}/><button className="send-button" onClick={() => void sendDemo()} disabled={!draft.trim()}><Send size={16}/> Send</button></div></section> : <section className="chat-panel"><div className="helper-text" style={{padding:40}}>Select a conversation to view messages.</div></section>}</div>
        </div> : null}
        {/* Remaining pages preserved via truncated restore - see note */}
        {page !== "Inbox" && <div className="page-heading"><div><div className="eyebrow">WORKSPACE</div><h1>{page}</h1><p>Open Inbox after entering your dashboard token in Settings to manage live Telegram conversations.</p></div><div className="helper-text" style={{padding:20}}>Use the sidebar to open Settings, then paste DASHBOARD_API_TOKEN and refresh the live inbox.</div>}
      </div>
    </main>
    {toast && <div className="toast">{toast}</div>}
  </div>;
}
