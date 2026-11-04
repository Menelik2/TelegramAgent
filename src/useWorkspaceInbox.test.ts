// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceInbox } from "./useWorkspaceInbox";

const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});
const deferred=<T,>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {resolve,promise};};
const message=(id:number,text:string)=>({id,direction:"incoming",text,createdAt:"2026-11-04T10:00:00Z"});
const convo=(id:string,senderId="42")=>({conversationId:id,chatId:id.split("~")[1],businessConnectionId:id.split("~")[0],senderId,senderName:id,username:"",lastMessage:"hello",lastMessageAt:"2026-11-04T10:00:00Z",messageCount:1});
let conversations:ReturnType<typeof convo>[];
let messages:Record<string,ReturnType<typeof message>[]>;
let permissionsFail=false,activityFail=false,cleanupFail=false;
let historyOverride:((id:string,offset:number)=>Promise<Response>|undefined)|undefined;
let listOverride:(()=>Promise<Response>|undefined)|undefined;
let sendOverride:((id:string)=>Promise<Response>|undefined)|undefined;
let sendCalls:string[],permissionCalls:number;
const notice=vi.fn();
beforeEach(()=>{
  conversations=[convo("direct~42"),convo("business-a~43","43")];
  messages={"direct~42":[message(1,"First message")],"business-a~43":[message(2,"Second conversation")]};
  permissionsFail=activityFail=cleanupFail=false;historyOverride=listOverride=sendOverride=undefined;sendCalls=[];permissionCalls=0;notice.mockReset();
  vi.stubGlobal("fetch",vi.fn(async(input:string,init:RequestInit={})=>{
    const url=new URL(input,"http://test");
    if(url.pathname==="/api/inbox")return listOverride?.()||response({conversations});
    if(url.pathname==="/api/agent/contacts")return response({contacts:[{senderId:"42",enabled:true},{senderId:"43",enabled:false}]},permissionsFail?503:200);
    if(url.pathname==="/api/activity")return response({events:[]},activityFail?503:200);
    if(url.pathname.startsWith("/api/agent/contacts/")){permissionCalls++;return response({ok:true});}
    if(url.pathname==="/api/inbox/history"){
      if(cleanupFail)return response({error:"Cleanup failed"},503);
      for(const id in messages)messages[id]=[];
      conversations=conversations.map(c=>({...c,lastMessage:"",messageCount:0}));
      return response({ok:true,deletedCount:2});
    }
    const match=url.pathname.match(/^\/api\/inbox\/(.+)\/(messages|reply)$/);
    if(match){const id=decodeURIComponent(match[1]);
      if(match[2]==="messages")return historyOverride?.(id,Number(url.searchParams.get("offset")||0))||response({messages:messages[id]||[],hasMore:false,nextOffset:messages[id]?.length||0});
      sendCalls.push(id);const override=sendOverride?.(id);if(override)return override;
      messages[id].push({...message(3,JSON.parse(String(init.body)).text),direction:"outgoing"});return response({ok:true,sent:true});
    }
    throw new Error("Unexpected path "+url.pathname);
  }));
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
function setup(token="token-a") {return renderHook(({token})=>useWorkspaceInbox(token,"",true,notice),{initialProps:{token}});}
const loaded=async(result:{current:ReturnType<typeof useWorkspaceInbox>})=>waitFor(()=>expect(result.current.selected?.messages.length).toBeGreaterThan(0));

describe("Workspace inbox behavior",()=>{
  it("keeps the selected chat populated and reloads messages after refresh",async()=>{
    const {result}=setup();await loaded(result);
    messages["direct~42"].push(message(5,"New message"));
    await act(async()=>{await result.current.refresh();});
    await waitFor(()=>expect(result.current.selected?.messages.map(m=>m.text)).toEqual(["First message","New message"]));
    expect(result.current.state.selectedId).toBe("direct~42");
  });
  it("keeps drafts separate and reloads the confirmed sent reply",async()=>{
    const {result}=setup();await loaded(result);
    act(()=>result.current.setDraft("Draft A"));act(()=>result.current.select("business-a~43"));await loaded(result);
    expect(result.current.draft).toBe("");act(()=>result.current.setDraft("Draft B"));act(()=>result.current.select("direct~42"));
    expect(result.current.draft).toBe("Draft A");
    await act(async()=>{await result.current.send();});
    await waitFor(()=>expect(result.current.selected?.messages.at(-1)?.text).toBe("Draft A"));
    expect(result.current.draft).toBe("");act(()=>result.current.select("business-a~43"));expect(result.current.draft).toBe("Draft B");
  });
  it("does not erase the new chat draft when an earlier send completes, and blocks double sends",async()=>{
    const gate=deferred<Response>();sendOverride=()=>gate.promise;
    const {result}=setup();await loaded(result);act(()=>result.current.setDraft("A"));
    let sending!:Promise<void>;act(()=>{sending=result.current.send();void result.current.send();});
    act(()=>result.current.select("business-a~43"));act(()=>result.current.setDraft("B"));
    await act(async()=>{gate.resolve(response({sent:true}));await sending;});
    expect(sendCalls).toEqual(["direct~42"]);expect(result.current.draft).toBe("B");
  });
  it("preserves a failed reply draft",async()=>{
    sendOverride=async()=>response({error:"Not authorized"},403);
    const {result}=setup();await loaded(result);act(()=>result.current.setDraft("Keep me"));
    await act(async()=>{await result.current.send();});expect(result.current.draft).toBe("Keep me");expect(notice).toHaveBeenCalledWith("Not authorized");
  });
  it("ignores old conversation history after switching chats",async()=>{
    const gate=deferred<Response>();historyOverride=id=>id==="direct~42"?gate.promise:undefined;
    const {result}=setup();await waitFor(()=>expect(result.current.state.contacts).toHaveLength(2));
    act(()=>result.current.select("business-a~43"));await loaded(result);
    await act(async()=>{gate.resolve(response({messages:[message(9,"Late A")],hasMore:true,nextOffset:100}));});
    expect(result.current.selected?.messages[0].text).toBe("Second conversation");expect(result.current.state.hasMore).toBe(false);expect(result.current.state.offset).toBe(1);
  });
  it("does not cancel a history load when reselecting the same conversation",async()=>{
    const gate=deferred<Response>();historyOverride=id=>id==="direct~42"?gate.promise:undefined;
    const {result}=setup();await waitFor(()=>expect(result.current.state.historyLoading).toBe(true));
    act(()=>result.current.select("direct~42"));await act(async()=>{gate.resolve(response({messages:[message(1,"Loaded")]}));});
    await waitFor(()=>expect(result.current.selected?.messages[0]?.text).toBe("Loaded"));
  });
  it("ignores old pagination responses after switching chats",async()=>{
    const gate=deferred<Response>();historyOverride=(id,offset)=>id==="direct~42"?(offset?gate.promise:Promise.resolve(response({messages:[message(5,"Latest A")],hasMore:true,nextOffset:100}))):undefined;
    const {result}=setup();await loaded(result);let loading!:Promise<void>;
    act(()=>{loading=result.current.loadOlder();});act(()=>result.current.select("business-a~43"));await loaded(result);
    await act(async()=>{gate.resolve(response({messages:[message(4,"Old A")],hasMore:true,nextOffset:200}));await loading;});
    expect(result.current.state.offset).toBe(1);expect(result.current.state.hasMore).toBe(false);expect(result.current.state.olderLoading).toBe(false);
  });
  it("deduplicates overlapping older pages using stored message IDs",async()=>{
    historyOverride=(_id,offset)=>Promise.resolve(offset?response({messages:[message(1,"Old"),message(2,"Overlap")],nextOffset:4,hasMore:false}):response({messages:[message(2,"Overlap"),message(3,"Latest")],nextOffset:2,hasMore:true}));
    const {result}=setup();await loaded(result);await act(async()=>{await result.current.loadOlder();});
    expect(result.current.selected?.messages.map(m=>m.id)).toEqual(["1","2","3"]);expect(result.current.state.offset).toBe(4);
  });
  it("clears stored copies without removing conversations or restoring a late history result",async()=>{
    const {result}=setup();await loaded(result);
    const gate=deferred<Response>();historyOverride=id=>id==="direct~42"?gate.promise:undefined;
    await act(async()=>{await result.current.refresh();});await waitFor(()=>expect(result.current.state.historyLoading).toBe(true));
    historyOverride=undefined;await act(async()=>{await result.current.clear();});
    await act(async()=>{gate.resolve(response({messages:[message(8,"Deleted copy")],hasMore:true}));});
    expect(result.current.state.contacts).toHaveLength(2);expect(result.current.selected?.messages).toEqual([]);expect(result.current.state.selectedId).toBe("direct~42");expect(result.current.state.hasMore).toBe(false);
  });
  it("preserves messages and reports a failed cleanup",async()=>{
    const {result}=setup();await loaded(result);cleanupFail=true;await act(async()=>{await result.current.clear();});
    expect(result.current.state.error).toBe("Cleanup failed");expect(result.current.selected?.messages[0].text).toBe("First message");
  });
  it("never treats unavailable contact permissions as Manual and tolerates activity errors",async()=>{
    permissionsFail=activityFail=true;const {result}=setup();await loaded(result);
    expect(result.current.selected?.allowed).toBeNull();await act(async()=>{await result.current.toggle("direct~42");});expect(permissionCalls).toBe(0);
    expect(result.current.state.error).toContain("permissions are unavailable");
  });
  it("updates every thread for the same sender's permission and prevents duplicate toggles",async()=>{
    conversations.push(convo("business-b~42"));const {result}=setup();await loaded(result);
    await act(async()=>{await Promise.all([result.current.toggle("direct~42"),result.current.toggle("direct~42")]);});
    expect(permissionCalls).toBe(1);expect(result.current.state.contacts.filter(c=>c.senderId==="42").every(c=>c.allowed===false)).toBe(true);
  });
  it("ignores a stale inbox refresh and clears drafts when dashboard credentials change",async()=>{
    const {result,rerender}=setup();await loaded(result);act(()=>result.current.setDraft("Private draft"));
    const gate=deferred<Response>();listOverride=()=>gate.promise;let first!:Promise<boolean>;
    act(()=>{first=result.current.refresh();});
    listOverride=undefined;conversations=[convo("direct~99","99")];messages["direct~99"]=[message(99,"New account")];
    rerender({token:"token-b"});await waitFor(()=>expect(result.current.state.selectedId).toBe("direct~99"));
    await act(async()=>{gate.resolve(response({conversations:[convo("direct~42")]}));await first;});
    expect(result.current.state.contacts.map(c=>c.id)).toEqual(["direct~99"]);expect(result.current.draft).toBe("");
  });
  it("clears cached messages and drafts when the server rejects an expired token",async()=>{
    const {result}=setup();await loaded(result);act(()=>result.current.setDraft("Private draft"));
    listOverride=async()=>response({error:"Dashboard authorization failed"},401);
    await act(async()=>{await result.current.refresh();});
    expect(result.current.state.contacts).toEqual([]);expect(result.current.draft).toBe("");expect(result.current.state.live).toBe(false);
  });
  it("shows a history error separately from an empty conversation and can retry",async()=>{
    historyOverride=async()=>response({error:"History offline"},503);const {result}=setup();
    await waitFor(()=>expect(result.current.state.historyError).toBe("History offline"));
    historyOverride=undefined;await act(async()=>{await result.current.refresh();});await loaded(result);expect(result.current.state.historyError).toBe("");
  });
});
