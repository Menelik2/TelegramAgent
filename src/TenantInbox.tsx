import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowDown,
  Check,
  Inbox,
  Search,
  Send,
  RefreshCw,
  ShieldCheck,
  Trash2,
  MessageCircle,
} from "lucide-react";
import {
  conversationKey,
  type InboxConnection,
  type useTenantInbox,
} from "./useTenantInbox";

type Props = {
  inbox: ReturnType<typeof useTenantInbox>;
  connections: InboxConnection[];
  enabled: boolean;
  onSettings(): void;
  statusUnavailable: boolean;
};
const stamp = (date: string) =>
  new Date(date).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
export default function TenantInbox({
  inbox,
  connections,
  enabled,
  onSettings,
  statusUnavailable,
}: Props) {
  const {
    conversations,
    selected,
    messages,
    draft,
    loading,
    historyLoading,
    olderLoading,
    sending,
    clearing,
  } = inbox;
  const [filter, setFilter] = useState("all"),
    [atBottom, setAtBottom] = useState(true);
  const thread = useRef<HTMLDivElement>(null),
    oldHeight = useRef<number | null>(null),
    nearBottom = useRef(true);
  const key = selected ? conversationKey(selected) : "";
  const canReply = (connection: string) =>
    connections.some((c) => c.id === connection && c.enabled && c.can_reply);
  const replyAllowed =
    selected && canReply(selected.connection_id) && !statusUnavailable;
  const visible = conversations.filter(
    (c) =>
      filter === "all" ||
      (filter === "ready"
        ? canReply(c.connection_id)
        : !canReply(c.connection_id)),
  );
  useEffect(() => {
    nearBottom.current = true;
    setAtBottom(true);
    oldHeight.current = null;
  }, [key]);
  useEffect(() => {
    const el = thread.current;
    if (!el) return;
    if (oldHeight.current !== null && !olderLoading) {
      el.scrollTop += el.scrollHeight - oldHeight.current;
      oldHeight.current = null;
    } else if (nearBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, olderLoading]);
  const jump = () => {
    if (thread.current) thread.current.scrollTop = thread.current.scrollHeight;
    nearBottom.current = true;
    setAtBottom(true);
  };
  return (
    <section className="tenant-inbox-page" aria-label="My inbox">
      <div className="tenant-page-heading">
        <div>
          <h1>Inbox</h1>
          <p>Manage your selected Telegram conversations.</p>
        </div>
        <div className="tenant-actions">
          <button
            className="tenant-secondary"
            disabled={clearing || sending}
            onClick={() => void inbox.clearHistory()}
          >
            <Trash2 size={16} />
            <span>Clear database copies</span>
          </button>
          <button
            className="tenant-secondary"
            disabled={loading || historyLoading || sending || clearing}
            onClick={() => void inbox.refresh()}
          >
            <RefreshCw size={16} />
            <span>Refresh</span>
          </button>
        </div>
      </div>
      <div className="tenant-inbox-summary">
        <span>
          <ShieldCheck size={16} /> Only your connected conversations
        </span>
        <button className="tenant-link" onClick={onSettings}>
          {statusUnavailable
            ? "Check auto-reply status"
            : enabled
              ? "Auto-reply enabled · Settings"
              : "Auto-reply paused · Settings"}
        </button>
      </div>
      {inbox.notice && (
        <div className="tenant-notice" role="status">
          {inbox.notice}
        </div>
      )}
      <div className={`tenant-inbox-layout ${selected ? "has-selection" : ""}`}>
        <aside className="tenant-chat-list" aria-label="Conversations">
          <div className="tenant-list-tools">
            <div className="tenant-row">
              <h2>Conversations</h2>
              <span className="tenant-count">
                {conversations.length}
                {inbox.nextOffset !== null ? "+" : ""}
              </span>
            </div>
            <label className="tenant-search">
              <Search size={17} />
              <input
                type="search"
                inputMode="numeric"
                aria-label="Search conversations by chat ID"
                placeholder="Search chat ID…"
                value={inbox.search}
                maxLength={20}
                disabled={clearing}
                onChange={(e) => inbox.setSearch(e.target.value)}
              />
            </label>
            <div
              className="tenant-filters"
              aria-label="Filter loaded conversations"
            >
              {[
                ["all", "All"],
                ["ready", "Reply access"],
                ["readonly", "Read only"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {inbox.listError && (
            <div className="tenant-inline-error" role="alert">
              {inbox.listError}
              <button
                className="tenant-link"
                onClick={() => void inbox.refresh()}
              >
                Retry inbox
              </button>
            </div>
          )}
          <div className="tenant-chat-scroll" aria-busy={loading}>
            {visible.map((c) => (
              <button
                className={`tenant-chat-row ${selected && conversationKey(c) === key ? "selected" : ""}`}
                key={conversationKey(c)}
                disabled={clearing}
                aria-label={`Open chat ${c.chat_id}, connection ${c.connection_id}`}
                aria-pressed={selected !== null && conversationKey(c) === key}
                onClick={() => inbox.select(c)}
              >
                <span className="tenant-avatar">{c.chat_id.slice(-2)}</span>
                <span className="tenant-chat-text">
                  <span className="tenant-row">
                    <strong>Chat {c.chat_id}</strong>
                    <time dateTime={c.last_message_at || c.last_at}>
                      {new Date(
                        c.last_message_at || c.last_at,
                      ).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </time>
                  </span>
                  <span className="tenant-preview">
                    {c.last_message
                      ? `${c.last_direction === "outgoing" ? "You / agent: " : ""}${c.last_message}`
                      : "No stored message copies"}
                  </span>
                  <span className="tenant-chat-meta">
                    <span
                      className={
                        canReply(c.connection_id) ? "tenant-access" : ""
                      }
                    >
                      {canReply(c.connection_id) ? "Reply access" : "Read only"}
                    </span>
                    <span title={c.connection_id}>
                      Connection {c.connection_id}
                    </span>
                  </span>
                </span>
              </button>
            ))}
            {!visible.length && !loading && !inbox.listError && (
              <div className="tenant-empty">
                <Inbox size={28} />
                <h3>
                  {inbox.search || filter !== "all"
                    ? "No matching conversations"
                    : "Your inbox is ready"}
                </h3>
                <p>
                  {inbox.search
                    ? "Try another numeric chat ID."
                    : filter !== "all"
                      ? "No loaded conversations match this filter."
                      : "Connect your account in Telegram’s Business settings and enable automatic replies. New selected messages will appear here."}
                </p>
                {!inbox.search && filter === "all" && (
                  <button onClick={onSettings}>Set up automatic replies</button>
                )}
              </div>
            )}
            {loading && (
              <p className="tenant-loading" role="status">
                Loading conversations…
              </p>
            )}
            {inbox.nextOffset !== null && (
              <button
                className="tenant-load tenant-secondary"
                disabled={loading || clearing}
                onClick={() => void inbox.loadMore()}
              >
                Load more conversations
              </button>
            )}
          </div>
          <div className="tenant-list-footer">
            Private to your account · Updates every 15s
          </div>
        </aside>
        <section className="tenant-thread" aria-label="Conversation">
          {!selected ? (
            <div className="tenant-empty tenant-thread-empty">
              <div className="tenant-empty-icon">
                <MessageCircle size={32} />
              </div>
              <h2>Your conversations, together</h2>
              <p>
                Select a chat to view stored messages and reply from your
                connected Telegram account.
              </p>
              <small>Clearing copies keeps your conversations available.</small>
            </div>
          ) : (
            <>
              <header className="tenant-thread-header">
                <button
                  className="tenant-back tenant-secondary"
                  aria-label="Back to conversations"
                  onClick={() => inbox.select(null)}
                >
                  <ArrowLeft size={20} />
                </button>
                <span className="tenant-avatar">
                  {selected.chat_id.slice(-2)}
                </span>
                <div>
                  <h2>Chat {selected.chat_id}</h2>
                  <p>
                    Connection <span>{selected.connection_id}</span>
                  </p>
                </div>
                <span
                  className={`tenant-permission ${replyAllowed ? "ready" : ""}`}
                >
                  {replyAllowed ? "Reply access" : "Read only"}
                </span>
              </header>
              {inbox.historyError && (
                <div className="tenant-inline-error" role="alert">
                  {inbox.historyError}
                  <button
                    className="tenant-link"
                    onClick={() => void inbox.refresh()}
                  >
                    Retry messages
                  </button>
                </div>
              )}
              <div
                className="tenant-thread-messages"
                ref={thread}
                aria-busy={historyLoading || olderLoading}
                onScroll={() => {
                  const el = thread.current;
                  if (el) {
                    nearBottom.current =
                      el.scrollHeight - el.scrollTop - el.clientHeight < 70;
                    setAtBottom(nearBottom.current);
                  }
                }}
              >
                {inbox.nextBefore && (
                  <button
                    className="tenant-load tenant-secondary"
                    disabled={
                      olderLoading || historyLoading || sending || clearing
                    }
                    onClick={() => {
                      oldHeight.current = thread.current?.scrollHeight ?? null;
                      void inbox.loadOlder();
                    }}
                  >
                    {olderLoading ? "Loading…" : "Load older messages"}
                  </button>
                )}
                {historyLoading && (
                  <p className="tenant-loading" role="status">
                    Loading messages…
                  </p>
                )}
                {!historyLoading && !inbox.historyError && !messages.length && (
                  <div className="tenant-empty">
                    <ShieldCheck size={26} />
                    <h3>No stored history</h3>
                    <p>
                      This conversation remains available. Original Telegram
                      messages are unaffected.
                    </p>
                  </div>
                )}
                {messages.map((m, index) => {
                  const day = new Date(m.created_at).toLocaleDateString(
                    undefined,
                    { weekday: "short", month: "short", day: "numeric" },
                  );
                  const previous = index
                    ? new Date(messages[index - 1].created_at).toDateString()
                    : "";
                  return (
                    <div key={m.id}>
                      {new Date(m.created_at).toDateString() !== previous && (
                        <div className="tenant-date-divider">{day}</div>
                      )}
                      <article className={`tenant-bubble ${m.direction}`}>
                        <small>
                          {m.direction === "incoming"
                            ? "Contact"
                            : "You / agent"}
                        </small>
                        <p>{m.body}</p>
                        <footer>
                          <time
                            dateTime={m.created_at}
                            title={stamp(m.created_at)}
                          >
                            {new Date(m.created_at).toLocaleTimeString(
                              undefined,
                              { hour: "2-digit", minute: "2-digit" },
                            )}
                          </time>
                          {m.direction === "outgoing" && (
                            <Check size={13} aria-label="Sent" />
                          )}
                        </footer>
                      </article>
                    </div>
                  );
                })}
              </div>
              {!atBottom && (
                <button
                  className="tenant-latest tenant-secondary"
                  onClick={jump}
                >
                  <ArrowDown size={14} /> Latest messages
                </button>
              )}
              <form
                className="tenant-composer"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (replyAllowed && !historyLoading) void inbox.send();
                }}
              >
                {!replyAllowed && (
                  <p className="tenant-reply-warning">
                    {statusUnavailable
                      ? "Refresh your Telegram session to check access."
                      : "Reply permission is unavailable. Reconnect this bot or allow replies in Telegram’s Business settings."}
                  </p>
                )}
                <label htmlFor="tenant-reply">Manual reply</label>
                <textarea
                  id="tenant-reply"
                  value={draft}
                  maxLength={4096}
                  disabled={!replyAllowed || clearing}
                  placeholder={
                    replyAllowed ? "Write a reply…" : "Reply access required"
                  }
                  onChange={(e) => inbox.setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing &&
                      e.keyCode !== 229
                    ) {
                      e.preventDefault();
                      if (replyAllowed && !historyLoading) void inbox.send();
                    }
                  }}
                />
                <div className="tenant-composer-footer">
                  <small>
                    Enter to send · Shift + Enter for a new line{" "}
                    <span>{draft.length}/4096</span>
                  </small>
                  <button
                    type="submit"
                    disabled={
                      !replyAllowed ||
                      !draft.trim() ||
                      sending ||
                      clearing ||
                      historyLoading
                    }
                  >
                    <Send size={16} />
                    {sending ? "Sending…" : "Send reply"}
                  </button>
                </div>
              </form>
            </>
          )}
        </section>
      </div>
    </section>
  );
}
