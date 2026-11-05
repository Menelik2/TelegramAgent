import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";

export type InboxMessage = { id: string; from: "them" | "ai"; text: string; time: string };
export type InboxContact = { id: string; senderId?: string; name: string; handle: string; initials: string; color: string; last: string; time: string; allowed: boolean | null; messages: InboxMessage[] };
export type ActivityEvent = { id?: number; kind: string; detail: string; createdAt?: string };

type State = {
  key: string; contacts: InboxContact[]; selectedId: string; drafts: Record<string, string>; live: boolean; loading: boolean; error: string; historyError: string; historyLoading: boolean; olderLoading: boolean; offset: number; hasMore: boolean;
  sending: boolean; cleaning: boolean; permissionPending: string[]; revision: number;
  events: ActivityEvent[]; metrics: { messages: number; replies: number; review: number }; multiUser: boolean;
};
const empty = (key:string):State => ({key,contacts:[],selectedId:"",drafts:{},live:false,loading:false,error:"",historyError:"",historyLoading:false,olderLoading:false,offset:0,hasMore:false,sending:false,cleaning:false,permissionPending:[],revision:0,events:[],metrics:{messages:0,replies:0,review:0},multiUser:false});

type RequestFn = (path: string, init?: RequestInit) => Promise<Record<string, any>>;

export function useWorkspaceInbox(options: {
  key: string;
  enabled: boolean;
  request: RequestFn;
  onNotice?: (message: string) => void;
}) {
  const { key, enabled, request } = options;
  const [state, setState] = useState<State>(() => empty(key));
  const latest = useRef(state);
  latest.current = state;
  const notice = useRef(options.onNotice);
  notice.current = options.onNotice;
  const scope=useMemo(()=>({key,alive:true,list:0,history:0,sending:false,cleaning:false,older:false,permissions:new Set<string>(),controllers:new Set<AbortController>()}),[key]);
  useEffect(()=>{scope.alive=true;return()=>{scope.alive=false;scope.controllers.forEach(c=>c.abort());scope.controllers.clear();};},[scope]);

  const patch = useCallback((updater: SetStateAction<State>) => {
    setState(prev => {
      const next = typeof updater === "function" ? (updater as (s: State) => State)(prev) : updater;
      latest.current = next;
      return next;
    });
  }, []);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    const token = ++scope.list;
    patch(s => ({ ...s, loading: true, error: "" }));
    try {
      // Optional activity/permission errors must not erase a working inbox.
      const [inbox,permissions,activity]=await Promise.allSettled([
        request("/api/inbox"),request("/api/agent/contacts"),request("/api/activity?limit=100")
      ]);
      if (!scope.alive || token !== scope.list) return;
      if (inbox.status === "rejected") throw inbox.reason;
      const permissionMap=permissions.status==="fulfilled"?new Map<string,boolean>((permissions.value.contacts||[]).map((p:{senderId:string;enabled:boolean})=>[p.senderId,p.enabled])):null;
      const events: ActivityEvent[] = activity.status==="fulfilled"?(activity.value.events||[]):[];
      const contacts: InboxContact[] = (inbox.value.conversations||[]).map((item: any, i: number) => {
          const id = String(item.conversationId || item.chatId || i);
          const name = String(item.senderName || item.username || item.chatId || "Unknown");
          const old = latest.current.contacts.find(c => c.id === id);
          const senderId = String(item.senderId || "").trim() || (/^-?\d{5,22}$/.test(String(item.chatId||"")) ? String(item.chatId) : "");
          return {id,senderId:senderId||undefined,name,handle:item.username?"@"+item.username:`id ${senderId||item.chatId}`,initials:name.split(/\s+/).slice(0,2).map((v:string)=>v[0]).join("").toUpperCase(),color:["lilac","blue","mint","peach"][i%4],last:item.lastMessage||"",time:item.lastMessageAt?new Date(item.lastMessageAt).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}):"",allowed:permissionMap?(senderId&&permissionMap.has(senderId)?permissionMap.get(senderId)!:false):old?.allowed??null,messages:old?.messages||[]};
        });
      patch(s=>{
        return {...s,contacts,selectedId:contacts.some(c=>c.id===s.selectedId)?s.selectedId:(contacts[0]?.id||""),live:true,loading:false,revision:s.revision+1,multiUser:inbox.value.multiUser===true,error:permissionMap?"":"Contact permissions are unavailable. Reload before changing auto-reply settings.",events,metrics:{messages:(inbox.value.conversations||[]).reduce((n:number,c:{messageCount?:number})=>n+Number(c.messageCount||0),0),replies:events.filter(e=>["reply_sent","manual_reply_sent"].includes(e.kind)).length,review:events.filter(e=>["owner_review_required","blocked","delivery_failed"].includes(e.kind)).length}};
      });
    } catch (error) {
      if (!scope.alive || token !== scope.list) return;
      const message = error instanceof Error ? error.message : "Live inbox unavailable.";
      patch(s => ({ ...s, loading: false, error: message }));
      notice.current?.(message);
    }
  }, [enabled, patch, request, scope]);

  const select = useCallback((id: string) => {
    patch(s => ({ ...s, selectedId: id }));
  }, [patch]);

  const setDraft = useCallback((value: string) => {
    patch(s => ({ ...s, drafts: { ...s.drafts, [s.selectedId]: value } }));
  }, [patch]);

  const loadHistory = useCallback(async (chatId: string, offset = 0) => {
    if (!enabled || !chatId) return;
    const token = ++scope.history;
    patch(s => ({ ...s, historyLoading: offset === 0, olderLoading: offset > 0, historyError: "" }));
    try {
      const data = await request(`/api/inbox/${encodeURIComponent(chatId)}/messages?offset=${offset}&limit=50`);
      if (!scope.alive || token !== scope.history) return;
      const messages: InboxMessage[] = (data.messages || []).map((m: any, i: number) => ({
        id: String(m.id || `${chatId}-${offset}-${i}`),
        from: m.direction === "outgoing" ? "ai" as const : "them" as const,
        text: String(m.text || ""),
        time: m.createdAt ? new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""
      }));
      patch(s => ({
        ...s,
        historyLoading: false,
        olderLoading: false,
        offset,
        hasMore: Boolean(data.hasMore),
        contacts: s.contacts.map(c => c.id === chatId || c.id.endsWith(":" + chatId) || c.id === s.selectedId
          ? { ...c, messages: offset === 0 ? messages : [...messages, ...c.messages] }
          : c)
      }));
    } catch (error) {
      if (!scope.alive || token !== scope.history) return;
      const message = error instanceof Error ? error.message : "Could not load conversation.";
      patch(s => ({ ...s, historyLoading: false, olderLoading: false, historyError: message }));
    }
  }, [enabled, patch, request, scope]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
  }, [enabled, refresh]);

  useEffect(() => {
    if (!enabled || !state.selectedId) return;
    const contact = state.contacts.find(c => c.id === state.selectedId);
    const chatId = contact?.id?.includes(":") ? contact.id.split(":").pop()! : (contact?.id || state.selectedId);
    void loadHistory(chatId, 0);
  }, [enabled, state.selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadOlder = useCallback(async () => {
    if (!state.selectedId || state.olderLoading) return;
    const contact = state.contacts.find(c => c.id === state.selectedId);
    const chatId = contact?.id?.includes(":") ? contact.id.split(":").pop()! : (contact?.id || state.selectedId);
    await loadHistory(chatId, state.offset + 50);
  }, [loadHistory, state.contacts, state.offset, state.olderLoading, state.selectedId]);

  const send = useCallback(async () => {
    const selected = latest.current.contacts.find(c => c.id === latest.current.selectedId);
    const text = (latest.current.drafts[latest.current.selectedId] || "").trim();
    if (!selected || !text || scope.sending) return;
    scope.sending = true;
    patch(s => ({ ...s, sending: true }));
    try {
      const chatId = selected.id.includes(":") ? selected.id.split(":").pop()! : selected.id;
      await request(`/api/inbox/${encodeURIComponent(chatId)}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text })
      });
      patch(s => ({ ...s, drafts: { ...s.drafts, [s.selectedId]: "" }, sending: false }));
      notice.current?.("Reply sent.");
      await refresh();
    } catch (error) {
      patch(s => ({ ...s, sending: false }));
      notice.current?.(error instanceof Error ? error.message : "Telegram reply failed.");
    } finally {
      scope.sending = false;
    }
  }, [patch, refresh, request, scope]);

  const toggle=async(id:string)=>{
    const contact=latest.current.contacts.find(c=>c.id===id),sender=contact?.senderId;
    if(!sender||contact?.allowed===null||scope.permissions.has(sender)||scope.cleaning)return;
    const enabled=!contact?.allowed;scope.permissions.add(sender);scope.list++;patch(s=>({...s,loading:false,permissionPending:[...scope.permissions]}));
    try{
      await request(`/api/agent/contacts/${encodeURIComponent(sender)}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled})});
      // The legacy permission is per sender, so every visible thread must agree.
      patch(s=>({...s,contacts:s.contacts.map(c=>c.senderId===sender?{...c,allowed:enabled}:c)}));
      notice.current(enabled?"Contact allowed.":"Contact set to manual-only.");
    }catch(error){notice.current?.(error instanceof Error?error.message:"Permission update failed.");}
    finally{scope.permissions.delete(sender);patch(s=>({...s,permissionPending:[...scope.permissions]}));}
  };

  const clear = useCallback(async () => {
    if (scope.cleaning) return;
    scope.cleaning = true;
    patch(s => ({ ...s, cleaning: true }));
    try {
      await request("/api/inbox/clear", { method: "POST" });
      patch(s=>({...s,offset:0,hasMore:false,contacts:s.contacts.map(c=>({...c,name:c.senderId||c.id,handle:c.senderId||c.id,initials:"?",last:"",messages:[]})),revision:s.revision+1}));
      notice.current?.("Stored inbox history cleared.");
      await refresh();
    } catch (error) {
      notice.current?.(error instanceof Error ? error.message : "Cleanup failed.");
    } finally {
      scope.cleaning = false;
      patch(s => ({ ...s, cleaning: false }));
    }
  }, [patch, refresh, request, scope]);

  const selected = state.contacts.find(c => c.id === state.selectedId);
  return {state,selected,draft:state.drafts[state.selectedId]||"",setDraft,select,refresh,loadOlder,send,toggle,clear};
}
