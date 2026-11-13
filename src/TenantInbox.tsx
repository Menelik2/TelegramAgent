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
  type TenantConversation,
  type useTenantInbox,
} from "./useTenantInbox";

type Props = {
  inbox: ReturnType<typeof useTenantInbox>;
  connections: InboxConnection[];
  enabled: boolean;
  consentGranted: boolean;
  activating: boolean;
  onEnableAi(chat: TenantConversation, consent: boolean): Promise<boolean>;
  onSettings(): void;
  statusUnavailable: boolean;
  onRefreshConnections(): Promise<void>;
  onAllowAllEligible(): Promise<void>;
  manualInboxEnabled: boolean;
  onEnableManualInbox(): Promise<void>;
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
  consentGranted,
  activating,
  onEnableAi,
  onSettings,
  statusUnavailable,
  onRefreshConnections,
  onAllowAllEligible,
  manualInboxEnabled,
  onEnableManualInbox,
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
  const [confirmActivation, setConfirmActivation] = useState(false);
  const [aiConsent, setAiConsent] = useState(false);
  const key = selected ? conversationKey(selected) : "";
  const canReply = (connection: string) =>
    connections.some((c) => c.id === connection && c.enabled && c.can_reply);
  const replyAllowed =
    selected && canReply(selected.connection_id);
  const visible = conversations.filter((c) => {
    switch (filter) {
      case "manual":
        return c.ai_allowed === false;
      case "ai":
        return c.ai_allowed === true;
      case "ready":
        return canReply(c.connection_id);
      case "readonly":
        return !canReply(c.connection_id);
      default:
        return true;
    }
  });
  useEffect(() => {
    setConfirmActivation(false);
    setAiConsent(false);
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
            disabled={!enabled || !consentGranted || clearing || sending || activating || inbox.changingMode !== null}
            onClick={() => void onAllowAllEligible()}
          >
            Allow AI for eligible chats
          </button>
          <button
            className="tenant-secondary"
            disabled={
              clearing || sending || activating || inbox.changingMode !== null
            }
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
                autoComplete="off"
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
                ["ai", "AI allowed"],
                ["manual", "Manual"],
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
                    <span>
                      {c.ai_allowed == null
                        ? "Mode unavailable"
                        : c.ai_allowed
                          ? "AI allowed"
                          : "Manual"}
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
                    : manualInboxEnabled ? "Your inbox is ready" : "Enable Inbox to see conversations"}
                </h3>
                <p>
                  {inbox.search
                    ? "Try another numeric chat ID."
                    : filter !== "all"
                      ? "No loaded conversations match this filter."
                      : manualInboxEnabled
                        ? "Send a new message to a chat shared with your Business bot. Past Telegram conversations cannot be imported."
                        : "Enable message storage to see future chats shared with your Business bot. This does not enable AI or import old messages."}
                </p>
                {!inbox.search && filter === "all" && (
                  manualInboxEnabled
                    ? <button onClick={onSettings}>Check inbox settings</button>
                    : <button disabled={activating} onClick={() => void onEnableManualInbox()}>
                        {activating ? "Enabling…" : "Enable Inbox for new messages"}
                      </button>
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
              <div className="tenant-chat-mode">
                <span>
                  {selected.ai_allowed == null
                    ? "Per-chat AI setup pending"
                    : selected.ai_allowed
                      ? enabled
                        ? "AI allowed"
                        : "AI allowed · account paused"
                      : "Manual replies"}
                </span>
                {selected.ai_allowed && !enabled && (
                  <button
                    className="tenant-secondary"
                    disabled={activating}
                    onClick={() => setConfirmActivation(true)}
                  >
                    Resume AI
                  </button>
                )}
                {selected.ai_allowed != null && (
                  <button
                    className="tenant-secondary"
                    disabled={
                      clearing ||
                      inbox.changingMode !== null ||
                      activating
                    }
                    onClick={() => {
                      if (!selected.ai_allowed && (!enabled || !consentGranted || !replyAllowed))
                        setConfirmActivation(true);
                      else void inbox.setChatAi(!selected.ai_allowed);
                    }}
                  >
                    {inbox.changingMode === key
                      ? "Saving…"
                      : selected.ai_allowed
                        ? "Pause AI"
                        : "Allow AI"}
                  </button>
                )}
              </div>
              {confirmActivation && (
                <section
                  className="tenant-activation"
                  aria-label="Enable chat AI"
                >
                  <h3>Enable AI for chat {selected.chat_id}?</h3>
                  <p>
                    This turns on account auto-reply and resumes your other
                    AI-allowed chats. Telegram reply access is verified before
                    permission is granted. Replies start with new incoming messages.
                  </p>
                  {!consentGranted && (
                    <label className="tenant-toggle">
                      <input
                        type="checkbox"
                        checked={aiConsent}
                        disabled={activating}
                        onChange={(e) => setAiConsent(e.target.checked)}
                      />{" "}
                      I agree to send approved message text to the configured AI
                      provider and store copies for up to 7 days while the
                      worker runs.
                    </label>
                  )}
                  <div className="tenant-actions">
                    <button
                      disabled={activating || (!consentGranted && !aiConsent)}
                      onClick={() => {
                        void onEnableAi(
                          selected,
                          consentGranted || aiConsent,
                        ).then((saved) => {
                          if (saved) setConfirmActivation(false);
                        });
                      }}
                    >
                      {activating ? "Enabling…" : "Enable and allow AI"}
                    </button>
                    <button
                      className="tenant-secondary"
                      disabled={activating}
                      onClick={() => setConfirmActivation(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </section>
              )}
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
                role="log"
                aria-label="Message history"
                aria-relevant="additions"
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
                  if (replyAllowed && !historyLoading && !sending && !clearing) void inbox.send();
                }}
              >
                {!replyAllowed && (
                  <button type="button" className="tenant-secondary" disabled={activating || clearing} onClick={() => void onRefreshConnections()}>Check Telegram reply permissions</button>
                )}
                {!replyAllowed && (
                  <p className="tenant-reply-warning">
                    {statusUnavailable
                      ? "Connection status could not be refreshed. Check Telegram permissions; sending still requires live authorization."
                      : "Reply permission is unavailable. Reconnect this bot or allow replies in Telegram’s Business settings."}
                  </p>
                )}
                <label htmlFor="tenant-reply">Manual reply</label>
                <textarea
                  id="tenant-reply"
                  value={draft}
                  maxLength={4096}
                  disabled={!replyAllowed || clearing || sending}
                  placeholder={
                    replyAllowed ? "Write a reply…" : "Reply access required"
                  }
                  onChange={(e) => inbox.setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      (typeof window.matchMedia !== "function" ||
                        window.matchMedia("(pointer: fine)").matches) &&
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
                    Desktop: Enter to send · Shift + Enter for a new line{" "}
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
