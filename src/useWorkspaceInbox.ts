import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type InboxMessage = { id: string; from: "them" | "ai"; text: string; time: string };
export type InboxContact = { id: string; senderId?: string; name: string; handle: string; initials: string; color: string; last: string; time: string; allowed: boolean | null; messages: InboxMessage[] };
export type ActivityEvent = { id?: number; kind: string; detail: string; createdAt?: string };

type State = {
  key: string; contacts: InboxContact[]; selectedId: string; drafts: Record<string, string>; live: boolean; loading: boolean; error: string; historyError: string; historyLoading: boolean; olderLoading: boolean; offset: number; hasMore: boolean;
  sending: boolean; cleaning: boolean; permissionPending: string[]; revision: number;
  events: ActivityEvent[]; metrics: { messages: number; replies: number; review: number }; multiUser: boolean;
};
const empty = (key: string): State => ({ key, contacts: [], selectedId: "", drafts: {}, live: false, loading: false, error: "", historyError: "", historyLoading: false, olderLoading: false, offset: 0, hasMore: false, sending: false, cleaning: false, permissionPending: [], revision: 0, events: [], metrics: { messages: 0, replies: 0, review: 0 }, multiUser: false });

function mapMessages(rows: Array<Record<string, any>>): InboxMessage[] {
  return rows.map(m => ({ id: String(m.id ?? `${m.direction}:${m.createdAt}:${m.text}`), from: m.direction === "outgoing" ? "ai" : "them", text: String(m.text || ""), time: m.createdAt ? new Date(m.createdAt).toLocaleString() : "" }));
}
const mergeMessages = (older: InboxMessage[], newer: InboxMessage[]) => [...new Map([...older, ...newer].map(m => [m.id, m])).values()];
function errorText(e: unknown) { return e instanceof Error ? e.message : "Request failed."; }

/** All asynchronous inbox operations are bound to one credential scope and conversation. */
export function useWorkspaceInbox(token: string, base: string, active: boolean, onNotice: (message: string) => void) {
  const key = JSON.stringify([base, token]);
  const scope = useMemo(() => ({ key, alive: true, list: 0, history: 0, sending: false, cleaning: false, older: false, permissions: new Set<string>(), controllers: new Set<AbortController>() }), [key]);
  const currentScope = useRef(scope); currentScope.current = scope;
  const notice = useRef(onNotice); notice.current = onNotice;
  const [stored, setStored] = useState(() => empty(key));
  const state = stored.key === key ? stored : empty(key);
  const latest = useRef(state); latest.current = state;
  const valid = useCallback(() => scope.alive && currentScope.current === scope, [scope]);
  const patch = useCallback((change: (s: State) => State) => { if (valid()) setStored(s => change(s.key === key ? s : empty(key))); }, [key, valid]);
  const request = useCallback(async (path: string, init: RequestInit = {}) => {
    const controller = new AbortController(); scope.controllers.add(controller);
    let timedOut = false;
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 15000);
    try {
      const response = await fetch(`${base}${path}`, { ...init, signal: controller.signal, headers: { ...init.headers, "x-dashboard-token": token } });
      let data: Record<string, any>;
      try { data = await response.json(); } catch { throw new Error(`Inbox API returned an invalid response (${response.status}). Check the API deployment.`); }
      if (!response.ok) {
        if (response.status === 401) patch(() => ({ ...empty(key), error: "Dashboard authorization expired. Check your token in Settings." }));
        throw new Error(data.error || `Request failed (${response.status}).`);
      }
      return data;
    } catch (error) {
      if (timedOut) throw new Error("Inbox request timed out. Please try again.");
      throw error;
    } finally { window.clearTimeout(timeout); scope.controllers.delete(controller); }
  }, [base, token, scope, patch, key]);

  const refresh = useCallback(async () => {
    if (!token || scope.cleaning) return false;
    const tokenN = ++scope.list;
    patch(s => ({ ...s, loading: true, error: s.error && s.contacts.length ? s.error : "" }));
    try {
      const [inbox, permissions, activity] = await Promise.allSettled([
        request("/api/inbox"),
        request("/api/agent/contacts"),
        request("/api/activity?limit=100")
      ]);
      if (!valid() || tokenN !== scope.list) return false;
      if (inbox.status === "rejected") throw inbox.reason;
      const permissionMap = permissions.status === "fulfilled"
        ? new Map<string, boolean>((permissions.value.contacts || []).map((p: { senderId: string; enabled: boolean }) => [String(p.senderId), p.enabled]))
        : null;
      patch(s => {
        const contacts = (inbox.value.conversations || []).map((item: Record<string, any>, i: number) => {
          const id = String(item.conversationId || item.chatId);
          const old = s.contacts.find(c => c.id === id);
          const name = String(item.senderName || item.username || item.chatId || "Unknown");
          const senderId = String(item.senderId || "").trim() || (/^-?\d{5,22}$/.test(String(item.chatId || "")) ? String(item.chatId) : "");
          return {
            id,
            senderId: senderId || undefined,
            name,
            handle: item.username ? "@" + item.username : `id ${senderId || item.chatId}`,
            initials: name.split(/\s+/).slice(0, 2).map(v => v[0]).join("").toUpperCase() || "?",
            color: ["lilac", "blue", "mint", "peach"][i % 4],
            last: item.lastMessage || "",
            time: item.lastMessageAt ? new Date(item.lastMessageAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "",
            allowed: permissionMap ? (senderId && permissionMap.has(senderId) ? permissionMap.get(senderId)! : false) : (old?.allowed ?? null),
            messages: old?.messages || []
          };
        });
        const events = (activity.status === "fulfilled" ? activity.value.events : s.events) || [];
        return {
          ...s,
          contacts,
          selectedId: contacts.some(c => c.id === s.selectedId) ? s.selectedId : (contacts[0]?.id || ""),
          live: true,
          loading: false,
          revision: s.revision + 1,
          multiUser: inbox.value.multiUser === true,
          error: permissionMap ? "" : "Contact permissions are unavailable. Reload before changing auto-reply settings.",
          events,
          metrics: {
            messages: (inbox.value.conversations || []).reduce((n: number, c: { messageCount?: number }) => n + Number(c.messageCount || 0), 0),
            replies: events.filter((e: ActivityEvent) => ["reply_sent", "manual_reply_sent"].includes(e.kind)).length,
            review: events.filter((e: ActivityEvent) => ["owner_review_required", "blocked", "delivery_failed"].includes(e.kind)).length
          }
        };
      });
      return true;
    } catch (error) {
      if (!valid() || tokenN !== scope.list) return false;
      const message = errorText(error);
      patch(s => ({ ...s, loading: false, error: message }));
      notice.current(message);
      return false;
    }
  }, [token, scope, patch, request, valid]);

  const select = useCallback((id: string) => { patch(s => ({ ...s, selectedId: id })); }, [patch]);
  const setDraft = useCallback((value: string) => { patch(s => ({ ...s, drafts: { ...s.drafts, [s.selectedId]: value } })); }, [patch]);

  const loadHistory = useCallback(async (conversationId: string, offset = 0) => {
    if (!token || !conversationId || scope.cleaning) return;
    const tokenN = ++scope.history;
    patch(s => ({ ...s, historyLoading: offset === 0, olderLoading: offset > 0, historyError: "" }));
    try {
      const data = await request(`/api/inbox/${encodeURIComponent(conversationId)}/messages?offset=${offset}&limit=50`);
      if (!valid() || tokenN !== scope.history) return;
      const mapped = mapMessages(data.messages || []);
      patch(s => ({
        ...s,
        historyLoading: false,
        olderLoading: false,
        offset: typeof data.nextOffset === "number" ? data.nextOffset : offset + mapped.length,
        hasMore: Boolean(data.hasMore),
        contacts: s.contacts.map(c => c.id === conversationId
          ? { ...c, messages: offset === 0 ? mapped : mergeMessages(mapped, c.messages) }
          : c)
      }));
    } catch (error) {
      if (!valid() || tokenN !== scope.history) return;
      patch(s => ({ ...s, historyLoading: false, olderLoading: false, historyError: errorText(error) }));
    }
  }, [token, scope, patch, request, valid]);

  useEffect(() => {
    if (!token || !active) return;
    void refresh();
    const timer = window.setInterval(() => {
      if (!scope.sending && !scope.cleaning && !scope.older && latest.current.offset <= 100) void refresh();
    }, 15000);
    return () => window.clearInterval(timer);
  }, [token, active, refresh, scope]);

  useEffect(() => {
    if (!token || !active || !state.selectedId) return;
    void loadHistory(state.selectedId, 0);
  }, [token, active, state.selectedId]);

  const loadOlder = useCallback(async () => {
    if (!state.selectedId || state.olderLoading || !state.hasMore || scope.cleaning) return;
    scope.older = true;
    try { await loadHistory(state.selectedId, state.offset); }
    finally { scope.older = false; }
  }, [loadHistory, state.hasMore, state.offset, state.olderLoading, state.selectedId, scope]);

  const send = useCallback(async () => {
    const selected = latest.current.contacts.find(c => c.id === latest.current.selectedId);
    const text = (latest.current.drafts[latest.current.selectedId] || "").trim();
    if (!selected || !text || scope.sending || scope.cleaning) return;
    scope.sending = true;
    patch(s => ({ ...s, sending: true }));
    try {
      await request(`/api/inbox/${encodeURIComponent(selected.id)}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text })
      });
      if (!valid()) return;
      patch(s => ({ ...s, drafts: { ...s.drafts, [selected.id]: "" }, sending: false }));
      notice.current("Reply sent.");
      await loadHistory(selected.id, 0);
      await refresh();
    } catch (error) {
      if (valid()) {
        patch(s => ({ ...s, sending: false }));
        notice.current(errorText(error));
      }
    } finally { scope.sending = false; }
  }, [patch, request, valid, loadHistory, refresh, scope]);

  const toggle = useCallback(async (id: string) => {
    const contact = latest.current.contacts.find(c => c.id === id);
    const sender = contact?.senderId;
    if (!sender || contact?.allowed === null || scope.permissions.has(sender) || scope.cleaning) return;
    const enabled = !contact?.allowed;
    scope.permissions.add(sender);
    patch(s => ({ ...s, permissionPending: [...scope.permissions] }));
    try {
      await request(`/api/agent/contacts/${encodeURIComponent(sender)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled })
      });
      if (!valid()) return;
      patch(s => ({ ...s, contacts: s.contacts.map(c => c.senderId === sender ? { ...c, allowed: enabled } : c) }));
      notice.current(enabled ? "Contact allowed." : "Contact set to manual-only.");
    } catch (error) {
      if (valid()) notice.current(errorText(error));
    } finally {
      scope.permissions.delete(sender);
      patch(s => ({ ...s, permissionPending: [...scope.permissions] }));
    }
  }, [patch, request, scope, valid]);

  const clear = useCallback(async () => {
    if (!token || scope.cleaning || scope.sending) return;
    scope.cleaning = true;
    scope.list++;
    scope.history++;
    scope.older = false;
    for (const c of scope.controllers) c.abort();
    patch(s => ({ ...s, cleaning: true, loading: false, historyLoading: false, olderLoading: false, historyError: "" }));
    try {
      const data = await request("/api/inbox/history", {
        method: "DELETE",
        headers: { "x-confirm-inbox-cleanup": "DELETE_STORED_COPIES_ONLY" }
      });
      if (!valid()) return;
      patch(s => ({
        ...s,
        offset: 0,
        hasMore: false,
        contacts: s.contacts.map(c => ({ ...c, last: "", messages: [] })),
        revision: s.revision + 1
      }));
      scope.cleaning = false;
      await refresh();
      if (valid()) notice.current(`Cleared ${data.deletedCount || 0} stored copies. Telegram messages are unchanged.`);
    } catch (error) {
      if (valid()) patch(s => ({ ...s, error: errorText(error), revision: s.revision + 1 }));
    } finally {
      scope.cleaning = false;
      patch(s => ({ ...s, cleaning: false }));
    }
  }, [token, scope, patch, request, valid, refresh]);

  const selected = state.contacts.find(c => c.id === state.selectedId);
  return { state, selected, draft: state.drafts[state.selectedId] || "", setDraft, select, refresh, loadOlder, send, toggle, clear };
}
