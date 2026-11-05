import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type InboxMessage = { id: string; from: "them" | "ai"; text: string; time: string };
export type InboxContact = { id: string; senderId?: string; name: string; handle: string; initials: string; color: string; last: string; time: string; allowed: boolean | null; messages: InboxMessage[] };
type Activity = { id?: number; kind: string; detail: string; createdAt?: string };
type State = {
  key: string; contacts: InboxContact[]; selectedId: string; drafts: Record<string,string>;
  live: boolean; loading: boolean; error: string; historyError: string;
  historyLoading: boolean; olderLoading: boolean; offset: number; hasMore: boolean;
  sending: boolean; cleaning: boolean; permissionPending: string[]; revision: number;
  events: Activity[]; metrics: { messages: number; replies: number; review: number }; multiUser: boolean;
};
const empty = (key:string):State => ({key,contacts:[],selectedId:"",drafts:{},live:false,loading:false,error:"",historyError:"",historyLoading:false,olderLoading:false,offset:0,hasMore:false,sending:false,cleaning:false,permissionPending:[],revision:0,events:[],metrics:{messages:0,replies:0,review:0},multiUser:false});
const errorText = (e:unknown) => e instanceof Error ? e.message : "Inbox request failed.";
function mapMessages(rows:Array<Record<string,any>>):InboxMessage[] {
  return rows.map(m=>({id:String(m.id ?? `${m.direction}:${m.createdAt}:${m.text}`),from:m.direction==="outgoing"?"ai":"them",text:String(m.text||""),time:m.createdAt?new Date(m.createdAt).toLocaleString():""}));
}
const mergeMessages = (older:InboxMessage[],newer:InboxMessage[]) => [...new Map([...older,...newer].map(m=>[m.id,m])).values()];

/** All asynchronous inbox operations are bound to one credential scope and conversation. */
export function useWorkspaceInbox(token:string, base:string, active:boolean, onNotice:(message:string)=>void) {
  const key=JSON.stringify([base,token]);
  const scope=useMemo(()=>({key,alive:true,list:0,history:0,sending:false,cleaning:false,older:false,permissions:new Set<string>(),controllers:new Set<AbortController>()}),[key]);
  const currentScope=useRef(scope);currentScope.current=scope;
  const notice=useRef(onNotice);notice.current=onNotice;
  const [stored,setStored]=useState(()=>empty(key));
  const state=stored.key===key?stored:empty(key);
  const latest=useRef(state);latest.current=state;
  const valid=useCallback(()=>scope.alive&&currentScope.current===scope,[scope]);
  const patch=useCallback((change:(s:State)=>State)=>{if(valid())setStored(s=>change(s.key===key?s:empty(key)));},[key,valid]);
  const request=useCallback(async(path:string,init:RequestInit={})=>{
    const controller=new AbortController();scope.controllers.add(controller);
    let timedOut=false;
    const timeout=window.setTimeout(()=>{timedOut=true;controller.abort();},15000);
    try {
      const response=await fetch(`${base}${path}`,{...init,signal:controller.signal,headers:{...init.headers,"x-dashboard-token":token}});
      let data:Record<string,any>;
      try {data=await response.json();} catch {throw new Error(`Inbox API returned an invalid response (${response.status}). Check the API deployment.`);}
      if(!response.ok) {
        if(response.status===401) patch(()=>({...empty(key),error:"Dashboard authorization expired. Check your token in Settings."}));
        throw new Error(data.error||`Request failed (${response.status}).`);
      }
      return data;
    } catch(error) {
      if(timedOut) throw new Error("Inbox request timed out. Please try again.");
      throw error;
    } finally {window.clearTimeout(timeout);scope.controllers.delete(controller);}
  },[base,token,scope,patch,key]);
  const refresh=useCallback(async()=>{
    if(!token||scope.cleaning)return false;
    const sequence=++scope.list;
    patch(s=>({...s,loading:true,error:""}));
    try {
      // Optional activity/permission errors must not erase a working inbox.
      const [inbox,permissions,activity]=await Promise.allSettled([
        request("/api/inbox"),request("/api/agent/contacts"),request("/api/activity?limit=100")
      ]);
      if(!valid()||sequence!==scope.list)return false;
      if(inbox.status==="rejected")throw inbox.reason;
      const permissionMap=permissions.status==="fulfilled"?new Map<string,boolean>((permissions.value.contacts||[]).map((p:{senderId:string;enabled:boolean})=>[p.senderId,p.enabled])):null;
      patch(s=>{
        const contacts:InboxContact[]=(inbox.value.conversations||[]).map((item:Record<string,any>,i:number)=>{
          const id=String(item.conversationId||item.chatId),old=s.contacts.find(c=>c.id===id);
          const name=String(item.senderName||item.username||item.chatId);
          return {id,senderId:item.senderId,name,handle:item.username?"@"+item.username:`id ${item.senderId||item.chatId}`,initials:name.split(/\s+/).slice(0,2).map(v=>v[0]).join("").toUpperCase(),color:["lilac","blue","mint","peach"][i%4],last:item.lastMessage||"",time:item.lastMessageAt?new Date(item.lastMessageAt).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}):"",allowed:permissionMap?(permissionMap.has(String(item.senderId))?permissionMap.get(String(item.senderId))!:false):old?.allowed??null,messages:old?.messages||[]};
        });
        const events:Activity[]=activity.status==="fulfilled"?(activity.value.events||[]):s.events;
        return {...s,contacts,selectedId:contacts.some(c=>c.id===s.selectedId)?s.selectedId:(contacts[0]?.id||""),live:true,loading:false,revision:s.revision+1,multiUser:inbox.value.multiUser===true,error:permissionMap?"":"Contact permissions are unavailable. Reload before changing auto-reply settings.",events,metrics:{messages:(inbox.value.conversations||[]).reduce((n:number,c:{messageCount?:number})=>n+Number(c.messageCount||0),0),replies:events.filter(e=>["reply_sent","manual_reply_sent"].includes(e.kind)).length,review:events.filter(e=>["owner_review_required","blocked","delivery_failed"].includes(e.kind)).length}};
      });
      return true;
    } catch(e) {if(valid()&&sequence===scope.list)patch(s=>({...s,error:errorText(e),loading:false}));return false;}
  },[token,scope,patch,request,valid]);
  useEffect(()=>{
    scope.alive=true;setStored(empty(key));void refresh();
    return()=>{scope.alive=false;for(const c of scope.controllers)c.abort();};
  },[scope,key,refresh]);
  useEffect(()=>{
    if(!active||!token||!state.selectedId||scope.cleaning)return;
    const id=state.selectedId,sequence=++scope.history;
    patch(s=>({...s,historyLoading:true,olderLoading:false,historyError:"",hasMore:false,offset:0}));scope.older=false;
    void request(`/api/inbox/${encodeURIComponent(id)}/messages?limit=100&offset=0`).then(data=>{
      if(!valid()||sequence!==scope.history)return;
      const messages=mapMessages(data.messages||[]);
      patch(s=>({...s,historyLoading:false,offset:Number(data.nextOffset??messages.length),hasMore:Boolean(data.hasMore),contacts:s.contacts.map(c=>c.id===id?{...c,messages}:c)}));
    }).catch(e=>{if(valid()&&sequence===scope.history)patch(s=>({...s,historyLoading:false,historyError:errorText(e)}));});
    return()=>{if(sequence===scope.history)scope.history++;};
  },[active,token,state.selectedId,state.revision,scope,patch,request,valid]);
  const previousActive=useRef(active);
  useEffect(()=>{
    if(active && !previousActive.current) void refresh();
    previousActive.current=active;
    if(!active || !token) return;
    const timer=window.setInterval(()=>{
      const snapshot=latest.current;
      const selected=snapshot.contacts.find(c=>c.id===snapshot.selectedId);
      // Never interrupt cleanup, a send, or somebody reading older history.
      if(document.visibilityState === "visible" && !scope.sending && !scope.cleaning && !snapshot.loading && !snapshot.historyLoading && !snapshot.olderLoading && (selected?.messages.length||0)<=100) void refresh();
    },15000);
    return()=>window.clearInterval(timer);
  },[active,token,scope,refresh]);
  const select=useCallback((id:string)=>{
    if (latest.current.selectedId === id) return;
    scope.history++;scope.older=false;
    patch(s=>({...s,selectedId:id,offset:0,hasMore:false,historyError:"",historyLoading:false,olderLoading:false}));
  },[scope,patch]);
  const loadOlder=async()=>{
    const snapshot=latest.current;
    if(!snapshot.selectedId||snapshot.historyLoading||!snapshot.hasMore||scope.older||scope.cleaning)return;
    const id=snapshot.selectedId,sequence=scope.history;scope.older=true;
    patch(s=>({...s,olderLoading:true,historyError:""}));
    try {
      const data=await request(`/api/inbox/${encodeURIComponent(id)}/messages?limit=100&offset=${snapshot.offset}`);
      if(!valid()||sequence!==scope.history||latest.current.selectedId!==id)return;
      const older=mapMessages(data.messages||[]);
      patch(s=>({...s,offset:Number(data.nextOffset??snapshot.offset+older.length),hasMore:Boolean(data.hasMore),contacts:s.contacts.map(c=>c.id===id?{...c,messages:mergeMessages(older,c.messages)}:c)}));
    } catch(e){if(valid()&&sequence===scope.history)patch(s=>({...s,historyError:errorText(e)}));}
    finally{if(valid()&&sequence===scope.history){scope.older=false;patch(s=>({...s,olderLoading:false}));}}
  };
  const setDraft=(text:string)=>{const id=latest.current.selectedId;if(id)patch(s=>({...s,drafts:{...s.drafts,[id]:text}}));};
  const send=async()=>{
    const snapshot=latest.current,id=snapshot.selectedId,draft=snapshot.drafts[id]||"",text=draft.trim();
    if(!id||!text||!token||scope.sending||scope.cleaning||snapshot.historyLoading)return;
    scope.sending=true;patch(s=>({...s,sending:true}));
    try {
      const data=await request(`/api/inbox/${encodeURIComponent(id)}/reply`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text})});
      if(!valid())return;
      if(data.sent!==true)throw new Error("The server did not confirm delivery. Check Telegram before retrying.");
      patch(s=>({...s,drafts:{...s.drafts,[id]:s.drafts[id]===draft?"":s.drafts[id]}}));
      notice.current("Reply sent.");await refresh();
    }catch(e){if(valid())notice.current(errorText(e));}
    finally{scope.sending=false;patch(s=>({...s,sending:false}));}
  };
  const toggle=async(id:string)=>{
    const contact=latest.current.contacts.find(c=>c.id===id),sender=contact?.senderId;
    if(!sender||contact?.allowed===null||scope.permissions.has(sender)||scope.cleaning)return;
    const enabled=!contact?.allowed;scope.permissions.add(sender);scope.list++;patch(s=>({...s,loading:false,permissionPending:[...scope.permissions]}));
    try{
      await request(`/api/agent/contacts/${encodeURIComponent(sender)}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled})});
      if(!valid())return;
      // The legacy permission is per sender, so every visible thread must agree.
      patch(s=>({...s,contacts:s.contacts.map(c=>c.senderId===sender?{...c,allowed:enabled}:c)}));
      notice.current(enabled?"Contact allowed.":"Contact set to manual-only.");
    }catch(e){if(valid())notice.current(errorText(e));}
    finally{scope.permissions.delete(sender);patch(s=>({...s,permissionPending:[...scope.permissions]}));}
  };
  const clear=async()=>{
    if(!token||scope.cleaning||scope.sending)return;
    if(!window.confirm("Delete stored inbox message copies and cancel queued replies? This cannot be undone. Original Telegram messages are not deleted."))return;
    scope.cleaning=true;scope.list++;scope.history++;scope.older=false;
    for(const c of scope.controllers)c.abort();
    patch(s=>({...s,cleaning:true,loading:false,historyLoading:false,olderLoading:false,historyError:""}));
    try{
      const data=await request("/api/inbox/history",{method:"DELETE",headers:{"x-confirm-inbox-cleanup":"DELETE_STORED_COPIES_ONLY"}});
      if(!valid())return;
      patch(s=>({...s,offset:0,hasMore:false,contacts:s.contacts.map(c=>({...c,name:c.senderId||c.id,handle:c.senderId||c.id,initials:"?",last:"",messages:[]})),revision:s.revision+1}));
      scope.cleaning=false;
      await refresh();
      if(valid())notice.current(`Cleared ${data.deletedCount||0} stored copies. Telegram messages are unchanged.`);
    }catch(e){if(valid())patch(s=>({...s,error:errorText(e),revision:s.revision+1}));}
    finally{scope.cleaning=false;patch(s=>({...s,cleaning:false}));}
  };
  const selected=state.contacts.find(c=>c.id===state.selectedId);
  return {state,selected,draft:state.drafts[state.selectedId]||"",setDraft,select,refresh,loadOlder,send,toggle,clear};
}
