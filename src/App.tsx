import { useEffect, useMemo, useState } from "react";
import { useWorkspaceInbox } from "./useWorkspaceInbox";
import WebhookPanel from "./WebhookPanel";
import TenantUsersPanel from "./TenantUsersPanel";
import {
  ArrowLeft, BrainCircuit, ContactRound, Gauge, MessageCircle, Pause, Play,
  Search, Send, Settings2, ShieldCheck, Sparkles, Users, Zap
} from "lucide-react";
import "./styles.css";

const nav = [
  { label: "Overview", icon: Gauge },
  { label: "Inbox", icon: MessageCircle },
  { label: "Users", icon: Users },
  { label: "AI personality", icon: Sparkles },
  { label: "Contacts", icon: ContactRound },
  { label: "Memory", icon: BrainCircuit },
  { label: "Automation", icon: Zap },
  { label: "Settings", icon: Settings2 }
];

async function readJson(r: Response) {
  try { return await r.json(); } catch { return {}; }
}

export default function App() {
  const [page, setPage] = useState("Inbox");
  const [dashboardToken, setDashboardToken] = useState(() => localStorage.getItem("dashboardToken") || "");
  const [apiBase] = useState(() => (import.meta as any).env?.VITE_API_BASE_URL || "");
  const [flashMsg, setFlashMsg] = useState("");
  const [query, setQuery] = useState("");
  const [inboxFilter, setInboxFilter] = useState<"all" | "allowed" | "manual">("all");
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [status, setStatus] = useState<any>(null);

  const flash = (m: string) => { setFlashMsg(m); window.setTimeout(() => setFlashMsg(""), 4000); };
  useEffect(() => { localStorage.setItem("dashboardToken", dashboardToken); }, [dashboardToken]);

  const apiRequest = (path: string, init: RequestInit = {}) =>
    fetch(`${apiBase}${path}`, {
      ...init,
      headers: { ...(init.headers || {}), "x-dashboard-token": dashboardToken }
    });

  const inbox = useWorkspaceInbox(dashboardToken, apiBase, page === "Inbox", flash);
  const { selected, draft, setDraft, select: setSelectedId, refresh: refreshLiveInbox, loadOlder: loadOlderMessages, send: sendReply, toggle: toggleContact } = inbox;
  const contacts = inbox.state.contacts;
  const selectedId = inbox.state.selectedId;
  const inboxLoading = inbox.state.loading;
  const inboxError = inbox.state.error;
  const inboxLive = inbox.state.live;
  const replySending = inbox.state.sending;
  const historyLoading = inbox.state.historyLoading || inbox.state.olderLoading;
  const historyHasMore = inbox.state.hasMore;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return contacts.filter(c => {
      if (inboxFilter === "allowed" && !c.allowed) return false;
      if (inboxFilter === "manual" && c.allowed !== false) return false;
      if (!q) return true;
      return [c.name, c.handle, c.last, c.senderId].join(" ").toLowerCase().includes(q);
    });
  }, [contacts, query, inboxFilter]);

  useEffect(() => {
    if (!dashboardToken) return;
    apiRequest("/api/status").then(async r => {
      const d = await readJson(r);
      if (r.ok) setStatus(d);
    }).catch(() => {});
  }, [dashboardToken]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">🤖</div><div><b>Telegram Agent</b><span>Workspace</span></div></div>
        <nav>
          {nav.map(item => {
            const Icon = item.icon;
            return (
              <button key={item.label} className={"nav-item" + (page === item.label ? " active" : "")} onClick={() => { setPage(item.label); setMobileChatOpen(false); }}>
                <Icon size={18} /><span className="nav-label">{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="token-box">
            <label>Dashboard token</label>
            <input type="password" value={dashboardToken} onChange={e => setDashboardToken(e.target.value)} placeholder="Paste token" />
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="breadcrumb">Workspace / {page}</div>
          <div className="topbar-status">{status?.telegramConnected ? "● Telegram connected" : "○ Telegram"}</div>
        </header>
        {flashMsg ? <div className="toast">{flashMsg}</div> : null}
        <div className="content">
          {page === "Inbox" ? (
            <div className="inbox-page">
              <div className="page-heading">
                <div><div className="eyebrow">YOUR CONVERSATIONS</div><h1>Inbox</h1></div>
                <button className="secondary-button" onClick={() => void refreshLiveInbox()} disabled={inboxLoading || !dashboardToken}>
                  {inboxLoading ? "Loading…" : "Refresh"}
                </button>
              </div>
              <div className="inbox-toolbar">
                <div className="inbox-count"><b>{filtered.length}</b> <span>conversations</span>{inboxLive ? <span className="live-label"><i /> Live</span> : null}</div>
                <div className="searchbox"><Search size={16} /><input aria-label="Search" placeholder="Search…" value={query} onChange={e => setQuery(e.target.value)} /></div>
              </div>
              <div className="inbox-layout">
                <section className={"inbox-list " + (mobileChatOpen ? "mobile-hidden" : "")}>
                  <div className="filter-row">
                    <button className={inboxFilter === "all" ? "filter-active" : ""} onClick={() => setInboxFilter("all")}>All</button>
                    <button className={inboxFilter === "allowed" ? "filter-active" : ""} onClick={() => setInboxFilter("allowed")}>Auto-reply</button>
                    <button className={inboxFilter === "manual" ? "filter-active" : ""} onClick={() => setInboxFilter("manual")}>Manual</button>
                  </div>
                  {inboxError ? <p className="helper-text" style={{ padding: "8px 16px", color: "#b91c1c" }}>{inboxError}</p> : null}
                  {!dashboardToken ? <p className="helper-text" style={{ padding: "12px 16px" }}>Enter dashboard token to load inbox.</p> : null}
                  {inboxLoading && contacts.length === 0 ? <div className="inbox-empty"><b>Loading conversations</b></div> : null}
                  {!inboxLoading && !inboxError && filtered.length === 0 ? <div className="inbox-empty"><b>{contacts.length ? "No matching conversations" : "Your inbox is empty"}</b></div> : null}
                  {filtered.map(c => (
                    <button type="button" className={"conversation " + (selectedId === c.id ? "selected" : "")} key={c.id} onClick={() => { setSelectedId(c.id); setMobileChatOpen(true); }}>
                      <div className={"contact-avatar " + c.color} aria-hidden="true">{c.initials}</div>
                      <div className="conversation-copy">
                        <div className="conversation-name"><b title={c.handle}>{c.name}</b><time>{c.time}</time></div>
                        <p>{c.last || "No message text"}</p>
                        <div className="conversation-meta">
                          <span className={"permission-chip " + (c.allowed ? "enabled" : "")}>{c.allowed === null ? "—" : c.allowed ? "Auto-reply" : "Manual"}</span>
                          <span className="conversation-handle">{c.handle}</span>
                        </div>
                      </div>
                    </button>
                  ))}
                </section>
                {selected ? (
                  <section className={"chat-panel " + (mobileChatOpen ? "mobile-chat-active" : "")}>
                    <div className="chat-header">
                      <button className="mobile-back-button" onClick={() => setMobileChatOpen(false)} aria-label="Back"><ArrowLeft size={18} /></button>
                      <div className={"contact-avatar " + selected.color}>{selected.initials}</div>
                      <div className="chat-contact"><b>{selected.name}</b><span>{selected.handle}</span></div>
                      <button className={"secondary-button compact " + (selected.allowed ? "pause-ai" : "allow-ai")} onClick={() => toggleContact(selected.id)} disabled={!selected.senderId || selected.allowed === null}>
                        {selected.allowed ? <><Pause size={14} /> Pause AI</> : <><Play size={14} /> Allow AI</>}
                      </button>
                    </div>
                    <div className="message-stream">
                      {inbox.state.historyError ? <div role="alert" className="helper-text">{inbox.state.historyError}</div> : null}
                      {historyHasMore ? <button className="secondary-button compact" disabled={historyLoading} onClick={() => void loadOlderMessages()}>{historyLoading ? "Loading…" : "Load older"}</button> : null}
                      {selected.messages.length ? selected.messages.map(m => (
                        <div key={m.id} className={"message-row " + (m.from === "ai" ? "outgoing" : "")}>
                          <div className={"bubble " + (m.from === "ai" ? "bubble-ai" : "bubble-them")}>{m.text}<time>{m.time}</time></div>
                        </div>
                      )) : <div className="message-empty"><MessageCircle size={22} /><b>{inbox.state.historyLoading ? "Loading messages" : "No stored messages"}</b></div>}
                    </div>
                    <div className="reply-box">
                      <textarea value={draft} onChange={e => setDraft(e.target.value)} placeholder={"Message " + selected.name + "…"} rows={2} disabled={replySending} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendReply(); } }} />
                      <button className="send-button" onClick={() => void sendReply()} disabled={!draft.trim() || replySending}><Send size={16} /> {replySending ? "Sending…" : "Send"}</button>
                    </div>
                  </section>
                ) : (
                  <section className={"chat-panel chat-placeholder " + (mobileChatOpen ? "mobile-chat-active" : "")}>
                    <MessageCircle size={28} /><b>Select a conversation</b>
                    <p>Choose someone from your inbox to read and reply.</p>
                  </section>
                )}
              </div>
            </div>
          ) : page === "Users" ? (
            <TenantUsersPanel apiRequest={apiRequest} />
          ) : page === "Settings" ? (
            <div>
              <div className="page-heading"><h1>Settings</h1></div>
              <div className="panel settings-panel">
                <div className="security-note">
                  <ShieldCheck size={18} />
                  <div>
                    <b>Dashboard authorization</b>
                    <input className="form-control" type="password" value={dashboardToken} onChange={e => setDashboardToken(e.target.value)} placeholder="Paste dashboard API token" />
                    <button className="secondary-button compact" style={{ marginTop: 10 }} onClick={() => apiRequest("/api/agent/settings").then(async r => { const d = await readJson(r); if (!r.ok) throw new Error(d.error || "Auth failed"); flash("Token verified."); void refreshLiveInbox(); }).catch(e => flash(e instanceof Error ? e.message : "Auth failed"))}>Verify token</button>
                  </div>
                </div>
                <WebhookPanel enabled={Boolean(dashboardToken)} apiRequest={apiRequest} flash={flash} />
              </div>
            </div>
          ) : page === "Automation" ? (
            <div>
              <div className="page-heading"><h1>Automation</h1></div>
              <div className="panel">
                <p className="helper-text">Pause or resume automatic replies for your workspace.</p>
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  <button className="primary-button" onClick={() => apiRequest("/api/agent/resume", { method: "POST" }).then(async r => { const d = await readJson(r); if (!r.ok) throw new Error(d.error || "Failed"); flash("Automation resumed."); }).catch(e => flash(e instanceof Error ? e.message : "Failed"))}><Play size={16} /> Resume</button>
                  <button className="secondary-button" onClick={() => apiRequest("/api/agent/pause", { method: "POST" }).then(async r => { const d = await readJson(r); if (!r.ok) throw new Error(d.error || "Failed"); flash("Automation paused."); }).catch(e => flash(e instanceof Error ? e.message : "Failed"))}><Pause size={16} /> Pause</button>
                </div>
              </div>
            </div>
          ) : (
            <div>
              <div className="page-heading"><h1>{page}</h1></div>
              <div className="panel"><p className="helper-text">Open Inbox for live conversations. Settings and Automation are available in the nav.</p></div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
