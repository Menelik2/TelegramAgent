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

type AdminTenant = {
  ownerId: string;
  automationEnabled: boolean;
  consentGiven: boolean;
  adminInboxAccess?: boolean;
  registeredAt: string;
  connections: number;
  readyConnections: number;
};

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
    setViewOwner(ownerId);
    setViewChat("");
    setViewConnection("");
    setThreads([]);
    setSupportMessages([]);
    setSupportError("");
    setSupportDraft("");
    setSupportLoading(true);
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
    if (!ownerId) {
      setSupportError("Select an account first.");
      return;
    }
    const requestId = ++supportRequest.current;
    setViewChat(thread.chat_id);
    setViewConnection(thread.connection_id);
    setSupportMessages([]);
    setSupportError("");
    setSupportDraft("");
    setSupportLoading(true);
    try {
      const response = await apiRequest(
        "/api/agent/tenant-inbox/" +
          encodeURIComponent(ownerId) +
          "/messages?connection=" +
          encodeURIComponent(thread.connection_id) +
          "&chat=" +
          encodeURIComponent(thread.chat_id)
      );
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
    setSupportSending(true);
    setSupportError("");
    try {
      const response = await apiRequest("/api/agent/tenant-inbox/" + encodeURIComponent(viewOwner) + "/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connection: viewConnection, chat: viewChat, text }),
      });
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.error || "Send failed.");
      setSupportDraft("");
      setSupportMessages((prev) => [
        ...prev,
        { id: Date.now(), body: text, direction: "outgoing", created_at: new Date().toISOString() },
      ]);
    } catch (e) {
      setSupportError(e instanceof Error ? e.message : "Could not send reply.");
    } finally {
      setSupportSending(false);
    }
  };

  const closeSupport = () => {
    ++supportRequest.current;
    setSupportLoading(false);
    setViewOwner("");
    setViewChat("");
    setViewConnection("");
    setThreads([]);
    setSupportMessages([]);
    setSupportError("");
    setSupportDraft("");
  };

  const load = async (nextOffset = 0) => {
    setLoading(true);
    setError("");
    try {
      const response = await apiRequest("/api/agent/tenant-users?offset=" + nextOffset);
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.error || "Unable to load users.");
      setEnabled(data.enabled !== false);
      setUsers((previous) => (nextOffset ? [...previous, ...(data.users || [])] : data.users || []));
      setHasMore(data.hasMore === true);
      setOffset(Number(data.nextOffset || 0));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load users.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="tenant-users-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">Administrator</div>
          <h1>Connected users</h1>
          <p>Account health, private inbox access, and support replies when an owner grants permission.</p>
        </div>
        <button className="secondary-button" onClick={() => void load(0)} disabled={loading} aria-label="Refresh connected users">
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {!enabled ? (
        <div className="notice-card" role="status">
          <ShieldCheck size={18} aria-hidden />
          <div>
            <b>Multi-user mode is disabled</b>
            <p>Enable MULTI_USER_ENABLED=true on the server to list connected accounts.</p>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="notice-card" role="alert">
          <ShieldCheck size={18} aria-hidden />
          <div>
            <b>Unable to load users</b>
            <p>{error}</p>
          </div>
        </div>
      ) : null}

      <div className="panel tenant-users-list">
        <div className="section-head" style={{ padding: "16px 16px 0" }}>
          <h3>
            Registered accounts ({users.length}
            {hasMore ? "+" : ""})
          </h3>
          <span className="helper-text" style={{ margin: 0 }}>
            Private inbox requires owner support permission
          </span>
        </div>

        {!loading && !users.length && !error ? (
          <div className="empty-state">
            <b>No accounts yet</b>
            <p>When multi-user accounts connect through the bot, they appear here.</p>
          </div>
        ) : null}

        {users.map((user) => (
          <div className="tenant-user-row" key={user.ownerId}>
            <div className="tenant-user-avatar" aria-hidden>
              <Users size={18} />
            </div>
            <div className="tenant-user-details">
              <b>Telegram ID {user.ownerId}</b>
              <span>Registered {user.registeredAt ? new Date(user.registeredAt).toLocaleDateString() : "—"}</span>
            </div>
            <div className="tenant-user-status">
              <span className={user.automationEnabled ? "permission-chip enabled" : "permission-chip"}>
                {user.automationEnabled ? "Auto-reply on" : "Paused"}
              </span>
              <span>
                {user.readyConnections}/{user.connections} ready
              </span>
              <span>{user.consentGiven ? "Consent recorded" : "Consent pending"}</span>
              <span className={user.adminInboxAccess ? "permission-chip enabled" : "permission-chip"}>
                {user.adminInboxAccess ? "Inbox access on" : "Inbox access off"}
              </span>
              <button
                className="secondary-button compact"
                disabled={supportLoading || !user.adminInboxAccess}
                title={user.adminInboxAccess ? "Open private inbox" : "Owner must enable support inbox access"}
                onClick={() => void openSupport(user.ownerId)}
              >
                View & reply
              </button>
            </div>
          </div>
        ))}

        {hasMore ? (
          <div style={{ padding: 16 }}>
            <button className="secondary-button" disabled={loading} onClick={() => void load(offset)}>
              {loading ? "Loading…" : "Load more users"}
            </button>
          </div>
        ) : null}
      </div>

      {viewOwner ? (
        <section className="panel support-inbox-panel" aria-label={`Support inbox for ${viewOwner}`}>
          <div className="section-head">
            <h3>Support inbox · {viewOwner}</h3>
            <button className="secondary-button compact" onClick={closeSupport}>
              Close
            </button>
          </div>
          <p className="helper-text" style={{ marginTop: 0 }}>
            Requires the owner’s support-inbox permission. Access is audited. You can read messages and send private replies through their connected Telegram business connection.
          </p>
          {supportError ? (
            <p role="alert" className="helper-text" style={{ color: "#ffb5c0" }}>
              {supportError}
            </p>
          ) : null}
          {supportLoading ? <p className="helper-text">Loading…</p> : null}

          <div className="thread-chips">
            {threads.map((thread) => (
              <button
                className={
                  "secondary-button compact" +
                  (viewChat === thread.chat_id && viewConnection === thread.connection_id ? " running" : "")
                }
                key={thread.connection_id + "~" + thread.chat_id}
                onClick={() => void openThread(thread)}
              >
                {thread.chat_id} · {new Date(thread.last_at).toLocaleDateString()}
              </button>
            ))}
          </div>

          {!supportLoading && !supportError && threads.length === 0 ? (
            <div className="empty-state">
              <b>No stored conversations</b>
              <p>When this account receives messages, threads will appear here.</p>
            </div>
          ) : null}

          {viewChat ? (
            <>
              <div className="support-messages message-stream">
                {supportMessages.length === 0 && !supportLoading ? (
                  <p className="helper-text">No messages in this thread yet.</p>
                ) : null}
                {supportMessages.map((message) => (
                  <div className={"message-row " + (message.direction === "outgoing" ? "outgoing" : "")} key={message.id}>
                    <div className={"bubble " + (message.direction === "outgoing" ? "bubble-ai" : "bubble-them")}>
                      {message.body}
                      <time>{new Date(message.created_at).toLocaleString()}</time>
                    </div>
                  </div>
                ))}
              </div>
              <div className="reply-box">
                <label className="field-label" htmlFor="support-reply-input">
                  Reply as support
                </label>
                <textarea
                  id="support-reply-input"
                  value={supportDraft}
                  onChange={(e) => setSupportDraft(e.target.value)}
                  placeholder={"Reply in chat " + viewChat + "…"}
                  rows={3}
                  maxLength={4096}
                  disabled={supportSending || supportLoading}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      void sendSupportReply();
                    }
                  }}
                />
                <div className="reply-tools">
                  <span className="helper-text" style={{ margin: 0 }}>
                    Enter to send · Shift+Enter for new line
                  </span>
                  <button
                    className="send-button"
                    onClick={() => void sendSupportReply()}
                    disabled={!supportDraft.trim() || supportSending || supportLoading}
                    aria-label="Send support reply"
                  >
                    <Send size={16} aria-hidden />
                    {supportSending ? "Sending…" : "Send"}
                  </button>
                </div>
              </div>
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

export default TenantUsersPanel;
