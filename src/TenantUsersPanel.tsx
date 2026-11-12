import { useEffect, useRef, useState } from "react";
import { Send, ShieldCheck, Users } from "lucide-react";

async function readJson(response: Response): Promise<Record<string, any>> {
  const raw = await response.text();
  if (!raw.trim()) {
    if (!response.ok) throw new Error(`API request failed (${response.status} ${response.statusText}). The server returned an empty response.`);
    throw new Error("The server returned an empty response instead of JSON.");
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, any>;
    throw new Error("Unexpected JSON format.");
  } catch (error) {
    if (error instanceof Error && (error.message.includes("empty response") || error.message.includes("Unexpected"))) throw error;
    throw new Error(`API returned invalid JSON (HTTP ${response.status}).`);
  }
}

type AdminTenant = { ownerId: string; automationEnabled: boolean; consentGiven: boolean; adminInboxAccess?: boolean; registeredAt: string; connections: number; readyConnections: number };

function TenantUsersPanel({ apiRequest }: { apiRequest: (path: string, init?: RequestInit) => Promise<Response> }) {
  const [users, setUsers] = useState<AdminTenant[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [viewOwner, setViewOwner] = useState("");
  const [threads, setThreads] = useState<Array<{ connection_id: string; chat_id: string; last_at: string }>>([]);
  const [viewChat, setViewChat] = useState("");
  const [viewConnection, setViewConnection] = useState("");
  const [supportMessages, setSupportMessages] = useState<Array<{ id: number; body: string; direction: string; created_at: string }>>([]);
  const [supportError, setSupportError] = useState("");
  const [supportLoading, setSupportLoading] = useState(false);
  const [supportDraft, setSupportDraft] = useState("");
  const [supportSending, setSupportSending] = useState(false);
  const supportRequest = useRef(0);

  const openSupport = async (ownerId: string) => {
    const requestId = ++supportRequest.current;
    setViewOwner(ownerId); setViewChat(""); setViewConnection(""); setThreads([]); setSupportMessages([]); setSupportError(""); setSupportDraft(""); setSupportLoading(true);
    try {
      const response = await apiRequest("/api/agent/tenant-inbox/" + encodeURIComponent(ownerId));
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.error || "Access denied.");
      if (requestId === supportRequest.current) setThreads(data.conversations || []);
    } catch (e) {
      if (requestId === supportRequest.current) setSupportError(e instanceof Error ? e.message : "Could not open support inbox.");
    } finally {
      if (requestId === supportRequest.current) setSupportLoading(false);
    }
  };

  const openThread = async (thread: { connection_id: string; chat_id: string }, ownerId = viewOwner) => {
    if (!ownerId) { setSupportError("Select an account first."); return; }
    const requestId = ++supportRequest.current;
    setViewChat(thread.chat_id); setViewConnection(thread.connection_id); setSupportMessages([]); setSupportError(""); setSupportDraft(""); setSupportLoading(true);
    try {
      const response = await apiRequest("/api/agent/tenant-inbox/" + encodeURIComponent(ownerId) + "/messages?connection=" + encodeURIComponent(thread.connection_id) + "&chat=" + encodeURIComponent(thread.chat_id));
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.error || "Access denied.");
      if (requestId === supportRequest.current) setSupportMessages(data.messages || []);
    } catch (e) {
      if (requestId === supportRequest.current) setSupportError(e instanceof Error ? e.message : "Could not open messages.");
    } finally {
      if (requestId === supportRequest.current) setSupportLoading(false);
    }
  };

  const sendSupportReply = async () => {
    const text = supportDraft.trim();
    if (!viewOwner || !viewConnection || !viewChat || !text || supportSending) return;
    setSupportSending(true); setSupportError("");
    try {
      const response = await apiRequest("/api/agent/tenant-inbox/" + encodeURIComponent(viewOwner) + "/reply", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connection: viewConnection, chat: viewChat, text })
      });
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.error || "Send failed.");
      setSupportDraft("");
      setSupportMessages(prev => [...prev, { id: Date.now(), body: text, direction: "outgoing", created_at: new Date().toISOString() }]);
    } catch (e) {
      setSupportError(e instanceof Error ? e.message : "Could not send reply.");
    } finally {
      setSupportSending(false);
    }
  };

  const load = async (nextOffset = 0) => {
    setLoading(true); setError("");
    try {
      const response = await apiRequest("/api/agent/tenant-users?offset=" + nextOffset);
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.error || "Unable to load users.");
      setEnabled(data.enabled !== false);
      setUsers(previous => nextOffset ? [...previous, ...(data.users || [])] : (data.users || []));
      setHasMore(data.hasMore === true);
      setOffset(Number(data.nextOffset || 0));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load users.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  return <div className="tenant-users-page">
    <div className="page-heading"><div><div className="eyebrow">ADMINISTRATOR</div><h1>Connected users</h1><p>Account status, private inbox view, and support replies when the owner grants access.</p></div>
      <button className="secondary-button" onClick={() => void load()} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button></div>
    {!enabled ? <div className="notice-card"><ShieldCheck size={18}/><div><b>Multi-user mode is disabled</b><p>Enable MULTI_USER_ENABLED=true on the server to list connected accounts.</p></div></div> : null}
    {error ? <div className="notice-card" role="alert"><ShieldCheck size={18}/><div><b>Unable to load users</b><p>{error}</p></div></div> : null}
    <div className="panel tenant-users-list">
      <div className="section-head"><h3>Registered accounts ({users.length}{hasMore ? "+" : ""})</h3><span className="helper-text">Private inbox requires owner support permission</span></div>
      {users.map(user => <div className="tenant-user-row" key={user.ownerId}>
        <div className="tenant-user-avatar"><Users size={18}/></div>
        <div className="tenant-user-details"><b>Telegram ID {user.ownerId}</b><span>Registered {user.registeredAt ? new Date(user.registeredAt).toLocaleDateString() : "—"}</span></div>
        <div className="tenant-user-status">
          <span className={user.automationEnabled ? "permission-chip enabled" : "permission-chip"}>{user.automationEnabled ? "Auto-reply on" : "Paused"}</span>
          <span>{user.readyConnections}/{user.connections} connections ready</span>
          <span>{user.consentGiven ? "Consent recorded" : "Consent pending"}</span>
          <span className={user.adminInboxAccess ? "permission-chip enabled" : "permission-chip"}>{user.adminInboxAccess ? "Inbox access on" : "Inbox access off"}</span>
          <button className="secondary-button compact" disabled={supportLoading || !user.adminInboxAccess} title={user.adminInboxAccess ? "Open private inbox" : "Owner must enable support inbox access"} onClick={() => void openSupport(user.ownerId)}>View & reply</button>
        </div>
      </div>)}
      {viewOwner ? <section className="panel" style={{ padding: 16, marginTop: 14 }}>
        <div className="section-head"><h3>Support inbox · {viewOwner}</h3><button className="secondary-button compact" onClick={() => { ++supportRequest.current; setSupportLoading(false); setViewOwner(""); setViewChat(""); setViewConnection(""); setThreads([]); setSupportMessages([]); setSupportError(""); setSupportDraft(""); }}>Close</button></div>
        <p className="helper-text">Requires the owner’s support-inbox permission. Access is audited. You can read messages and send private replies through their connected Telegram business connection.</p>
        {supportError ? <p role="alert" className="helper-text">{supportError}</p> : null}
        {supportLoading ? <p className="helper-text">Loading…</p> : null}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{threads.map(thread => <button className={"secondary-button compact" + (viewChat === thread.chat_id && viewConnection === thread.connection_id ? " running" : "")} key={thread.connection_id + "~" + thread.chat_id} onClick={() => void openThread(thread)}>{thread.chat_id} · {new Date(thread.last_at).toLocaleDateString()}</button>)}</div>
        {!supportLoading && !supportError && threads.length === 0 ? <p className="helper-text">No stored conversations available.</p> : null}
        {viewChat ? <>
          <div className="message-stream" style={{ maxHeight: 350, overflowY: "auto", marginTop: 12 }}>{supportMessages.map(message => <div className={"message-row " + (message.direction === "outgoing" ? "outgoing" : "")} key={message.id}><div className={"bubble " + (message.direction === "outgoing" ? "bubble-ai" : "bubble-them")}>{message.body}<time>{new Date(message.created_at).toLocaleString()}</time></div></div>)}</div>
          <div className="reply-box" style={{ marginTop: 12 }}>
            <textarea value={supportDraft} onChange={e => setSupportDraft(e.target.value)} placeholder={"Reply in chat " + viewChat + "…"} rows={2} maxLength={4096} disabled={supportSending || supportLoading}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void sendSupportReply(); } }} />
            <button className="send-button" onClick={() => void sendSupportReply()} disabled={!supportDraft.trim() || supportSending || supportLoading}><Send size={16}/> {supportSending ? "Sending…" : "Send"}</button>
          </div>
        </> : null}
      </section> : null}
      {!loading && !users.length && !error ? <p className="helper-text">No registered accounts found.</p> : null}
      {hasMore ? <button className="secondary-button" disabled={loading} onClick={() => void load(offset)}>{loading ? "Loading…" : "Load more users"}</button> : null}
    </div>
  </div>;
}

export default TenantUsersPanel;
