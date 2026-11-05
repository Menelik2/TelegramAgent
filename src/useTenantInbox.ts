import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type TenantConversation = {
  connection_id: string;
  chat_id: string;
  last_at: string;
  ai_allowed?: boolean | null;
  last_message?: string | null;
  last_direction?: string | null;
  last_message_at?: string | null;
};
export type InboxMessage = {
  id: number;
  body: string;
  direction: string;
  created_at: string;
};
export type InboxConnection = {
  id: string;
  enabled: boolean;
  can_reply: boolean;
};
export const conversationKey = (c: TenantConversation) =>
  JSON.stringify([c.connection_id, c.chat_id]);
const threadQuery = (c: TenantConversation) =>
  `connection=${encodeURIComponent(c.connection_id)}&chat=${encodeURIComponent(c.chat_id)}`;
const errorText = (e: unknown) =>
  e instanceof Error ? e.message : "Request failed. Try refreshing.";
class InboxRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
type InboxPage = {
  conversations: TenantConversation[];
  hasMore?: boolean;
  nextOffset?: number | null;
};
type ThreadPage = {
  messages: InboxMessage[];
  hasMore?: boolean;
  nextBefore?: string | null;
};

export function useTenantInbox(auth: string, active: boolean) {
  const [conversations, setConversations] = useState<TenantConversation[]>([]);
  const [selected, setSelected] = useState<TenantConversation | null>(null);
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [search, setSearch] = useState(""),
    [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false),
    [historyLoading, setHistoryLoading] = useState(false),
    [olderLoading, setOlderLoading] = useState(false);
  const [sending, setSending] = useState(false),
    [clearing, setClearing] = useState(false);
  const [listError, setListError] = useState(""),
    [historyError, setHistoryError] = useState(""),
    [notice, setNotice] = useState("");
  const [nextOffset, setNextOffset] = useState<number | null>(null),
    [nextBefore, setNextBefore] = useState<string | null>(null);
  const [changingMode, setChangingMode] = useState<string | null>(null);
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const scope = useMemo(
    () => ({
      alive: true,
      expired: false,
      selected: null as TenantConversation | null,
      listSeq: 0,
      historySeq: 0,
      listQuery: "",
      changingMode: false,
      revision: 0,
      confirmedModes: new Map<string, { revision: number; allowed: boolean }>(),
      sending: false,
      clearing: false,
      listPending: false,
      historyPending: false,
      olderLoaded: false,
      paged: false,
      controllers: new Set<AbortController>(),
    }),
    [auth],
  );
  useEffect(() => {
    scope.alive = true;
    return () => {
      scope.alive = false;
      for (const c of scope.controllers) c.abort();
    };
  }, [scope]);
  useEffect(() => {
    setConversations([]);
    setSelected(null);
    setMessages([]);
    setDrafts({});
    setChangingMode(null);
    setNotice("");
    setListError("");
    setHistoryError("");
    setNextBefore(null);
    setNextOffset(null);
  }, [auth]);
  const request = useCallback(
    async <T>(path: string, method = "GET", body?: unknown): Promise<T> => {
      if (scope.expired)
        throw new Error("Session expired. Reopen the dashboard from Telegram.");
      const controller = new AbortController();
      scope.controllers.add(controller);
      const timer = window.setTimeout(
        () => controller.abort(),
        method === "GET" ? 20000 : 60000,
      );
      try {
        const response = await fetch(`/api/user${path}`, {
          method,
          signal: controller.signal,
          headers: {
            "x-telegram-init-data": auth,
            "Content-Type": "application/json",
            ...(method === "DELETE"
              ? { "x-confirm-inbox-cleanup": "DELETE_STORED_COPIES_ONLY" }
              : {}),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const data = await response.json();
        if (response.status === 401 && scope.alive) {
          scope.expired = true;
          ++scope.listSeq;
          ++scope.historySeq;
          scope.selected = null;
          setSelected(null);
          setConversations([]);
          setMessages([]);
          setDrafts({});
          setNextOffset(null);
          setNextBefore(null);
          scope.listPending = false;
          scope.historyPending = false;
          setLoading(false);
          setHistoryLoading(false);
          setOlderLoading(false);
          setListError(
            data.error ||
              "Session expired. Reopen the dashboard from Telegram.",
          );
        }
        if (!response.ok)
          throw new InboxRequestError(
            response.status,
            data.error || "Request failed. Try refreshing.",
          );
        return data as T;
      } catch (error) {
        if (controller.signal.aborted)
          throw new Error("Request timed out. Refresh to check the result.");
        throw error;
      } finally {
        window.clearTimeout(timer);
        scope.controllers.delete(controller);
      }
    },
    [auth, scope],
  );
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);
  const loadList = useCallback(
    async (offset = 0, background = false) => {
      if (!auth || scope.clearing || scope.expired || scope.listQuery !== query)
        return;
      const seq = ++scope.listSeq;
      const revision = scope.revision;
      scope.listPending = true;
      if (!background) setLoading(true);
      setListError("");
      try {
        const page = await request<InboxPage>(
          `/inbox?offset=${offset}&q=${encodeURIComponent(query)}`,
        );
        if (!scope.alive || seq !== scope.listSeq) return;
        // A poll started before a confirmed change may still contain the old mode.
        const rows = page.conversations.map((c) => {
          const change = scope.confirmedModes.get(conversationKey(c));
          return change && change.revision > revision
            ? { ...c, ai_allowed: change.allowed }
            : c;
        });
        if (scope.selected) {
          const key = conversationKey(scope.selected);
          const current = rows.find((c) => conversationKey(c) === key);
          if (current) {
            scope.selected = {
              ...scope.selected,
              ai_allowed: current.ai_allowed,
            };
            setSelected(scope.selected);
          }
        }
        setConversations((old) =>
          offset
            ? [
                ...new Map(
                  [...old, ...rows].map((c) => [conversationKey(c), c]),
                ).values(),
              ]
            : rows,
        );
        setNextOffset(page.hasMore ? (page.nextOffset ?? offset + 100) : null);
        scope.paged = offset > 0;
      } catch (error) {
        if (scope.alive && seq === scope.listSeq)
          setListError(errorText(error));
      } finally {
        if (scope.alive && seq === scope.listSeq) {
          setLoading(false);
          scope.listPending = false;
        }
      }
    },
    [auth, scope, query, request],
  );
  useEffect(() => {
    scope.listQuery = query;
    setConversations([]);
    setNextOffset(null);
    scope.paged = false;
    void loadList();
  }, [loadList, scope, query]);
  const loadThread = useCallback(
    async (
      conversation: TenantConversation,
      before?: string,
      background = false,
    ) => {
      if (scope.clearing || scope.expired) return;
      const seq = ++scope.historySeq;
      scope.historyPending = true;
      if (before) setOlderLoading(true);
      else if (!background) setHistoryLoading(true);
      setHistoryError("");
      try {
        const page = await request<ThreadPage>(
          `/messages?${threadQuery(conversation)}${before ? `&before=${encodeURIComponent(before)}` : ""}`,
        );
        if (!scope.alive || seq !== scope.historySeq) return;
        setMessages((old) =>
          before
            ? [
                ...new Map(
                  [...page.messages, ...old].map((m) => [m.id, m]),
                ).values(),
              ]
            : page.messages,
        );
        setNextBefore(
          page.hasMore
            ? (page.nextBefore ?? String(page.messages[0]?.id))
            : null,
        );
        scope.olderLoaded = Boolean(before);
      } catch (error) {
        if (scope.alive && seq === scope.historySeq)
          setHistoryError(errorText(error));
      } finally {
        if (scope.alive && seq === scope.historySeq) {
          setHistoryLoading(false);
          setOlderLoading(false);
          scope.historyPending = false;
        }
      }
    },
    [request, scope],
  );
  const select = (c: TenantConversation | null) => {
    ++scope.historySeq;
    // Keep only the destination here; cleanup can erase preview text in one place.
    scope.selected = c && {
      connection_id: c.connection_id,
      chat_id: c.chat_id,
      last_at: c.last_at,
      ai_allowed: c.ai_allowed,
    };
    scope.olderLoaded = false;
    scope.historyPending = false;
    setSelected(scope.selected);
    setMessages([]);
    setNextBefore(null);
    setHistoryError("");
    setHistoryLoading(false);
    setOlderLoading(false);
    if (c) void loadThread(c);
  };
  const refresh = useCallback(async () => {
    if (scope.sending || scope.clearing) return;
    await Promise.all([
      loadList(),
      scope.selected ? loadThread(scope.selected) : Promise.resolve(),
    ]);
  }, [loadList, loadThread, scope]);
  useEffect(() => {
    if (!auth || !active) return;
    const sync = () => {
      if (
        document.visibilityState === "hidden" ||
        scope.sending ||
        scope.clearing ||
        scope.expired
      )
        return;
      if (!scope.paged && !scope.listPending) void loadList(0, true);
      if (scope.selected && !scope.olderLoaded && !scope.historyPending)
        void loadThread(scope.selected, undefined, true);
    };
    const timer = window.setInterval(sync, 15000);
    return () => window.clearInterval(timer);
  }, [auth, active, scope, loadList, loadThread]);
  const setDraft = (text: string) => {
    if (selected)
      setDrafts((old) => ({ ...old, [conversationKey(selected)]: text }));
  };
  const send = async () => {
    const destination = scope.selected;
    if (!destination || scope.sending || scope.clearing || scope.expired)
      return;
    const key = conversationKey(destination),
      text = draftsRef.current[key] || "";
    if (!text.trim()) return;
    scope.sending = true;
    setSending(true);
    setNotice("");
    // Prevent a pre-send poll from replacing the confirmed outgoing message.
    ++scope.historySeq;
    scope.historyPending = false;
    setHistoryLoading(false);
    setOlderLoading(false);
    try {
      const result = await request<{
        sent: boolean;
        stored: boolean;
        message?: InboxMessage | null;
      }>("/reply", "POST", {
        connection: destination.connection_id,
        chat: destination.chat_id,
        text,
      });
      if (!scope.alive) return;
      if (!result.sent) throw new Error("Delivery was not confirmed.");
      setDrafts((old) => (old[key] === text ? { ...old, [key]: "" } : old));
      setNotice(
        result.stored
          ? `Reply sent to chat ${destination.chat_id}.`
          : `Reply sent to chat ${destination.chat_id}; the database copy could not be saved. Do not resend.`,
      );
      if (
        result.message &&
        scope.selected &&
        conversationKey(scope.selected) === key
      ) {
        const message = result.message;
        setMessages((old) => [
          ...old.filter((m) => m.id !== message.id),
          message,
        ]);
      }
      // A slow preview refresh must not keep the composer locked after delivery.
      void loadList();
    } catch (error) {
      if (scope.alive)
        setNotice(
          error instanceof InboxRequestError &&
            [400, 401, 403, 404, 429].includes(error.status)
            ? error.message
            : `${errorText(error)} Check Telegram before retrying; delivery could not be confirmed.`,
        );
    } finally {
      if (scope.alive) {
        scope.sending = false;
        setSending(false);
      }
    }
  };
  const setChatAi = async (allowed: boolean) => {
    const chat = scope.selected;
    if (!chat || scope.expired || scope.clearing || scope.changingMode) return;
    const key = conversationKey(chat);
    scope.changingMode = true;
    setChangingMode(key);
    setNotice("");
    try {
      const result = await request<{
        connection: string;
        chat: string;
        allowed: boolean;
      }>("/inbox/ai", "PUT", {
        connection: chat.connection_id,
        chat: chat.chat_id,
        allowed,
      });
      if (!scope.alive || scope.expired) return;
      if (
        result.connection !== chat.connection_id ||
        result.chat !== chat.chat_id ||
        result.allowed !== allowed
      )
        throw new Error("Could not confirm the reply mode. Refresh the inbox.");
      scope.confirmedModes.set(key, { revision: ++scope.revision, allowed });
      setConversations((rows) =>
        rows.map((c) =>
          conversationKey(c) === key ? { ...c, ai_allowed: allowed } : c,
        ),
      );
      if (scope.selected && conversationKey(scope.selected) === key) {
        scope.selected = { ...scope.selected, ai_allowed: allowed };
        setSelected(scope.selected);
      }
      setNotice(
        allowed
          ? `AI allowed for new messages in chat ${chat.chat_id} when account auto-reply is on.`
          : `Chat ${chat.chat_id} is manual. A reply already sending may finish.`,
      );
    } catch (error) {
      if (scope.alive && !scope.expired) setNotice(errorText(error));
    } finally {
      scope.changingMode = false;
      if (scope.alive) setChangingMode(null);
    }
  };
  const clearHistory = async () => {
    if (scope.clearing || scope.sending || scope.changingMode || scope.expired)
      return;
    if (
      !window.confirm(
        "Delete your stored message copies and cancel queued replies? This cannot be undone. Conversation IDs and original Telegram messages stay. An in-progress send may complete.",
      )
    )
      return;
    scope.clearing = true;
    setClearing(true);
    setNotice("");
    ++scope.listSeq;
    ++scope.historySeq;
    scope.listPending = false;
    scope.historyPending = false;
    for (const c of scope.controllers) c.abort();
    setLoading(false);
    setHistoryLoading(false);
    setOlderLoading(false);
    try {
      const result = await request<{ deletedCount: number }>(
        "/history",
        "DELETE",
      );
      if (!scope.alive) return;
      setMessages([]);
      setNextBefore(null);
      scope.olderLoaded = false;
      setHistoryError("");
      setConversations((old) =>
        old.map((c) => ({
          ...c,
          last_message: null,
          last_direction: null,
          last_message_at: null,
        })),
      );
      setNotice(
        `Cleared ${result.deletedCount} database copies. Your conversations are still available.`,
      );
    } catch (error) {
      if (scope.alive) setNotice(errorText(error));
    } finally {
      if (scope.alive) {
        scope.clearing = false;
        setClearing(false);
      }
    }
  };
  return {
    conversations,
    selected,
    messages,
    draft: selected ? drafts[conversationKey(selected)] || "" : "",
    search,
    setSearch,
    select,
    setDraft,
    send,
    clearHistory,
    changingMode,
    setChatAi,
    refresh,
    loading,
    historyLoading,
    olderLoading,
    sending,
    clearing,
    listError,
    historyError,
    notice,
    nextOffset,
    nextBefore,
    loadMore: () => nextOffset !== null && loadList(nextOffset),
    loadOlder: () => selected && nextBefore && loadThread(selected, nextBefore),
  };
}
