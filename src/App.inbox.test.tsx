// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

let history:Record<string,Array<{id:number;direction:string;text:string}>>;
let replies:Array<{id:string;text:string}>;
const json=(data:unknown)=>new Response(JSON.stringify(data),{headers:{"content-type":"application/json"}});
beforeEach(()=>{
  window.sessionStorage.setItem("dashboardApiToken","test-token");
  history={"direct~42":[{id:1,direction:"incoming",text:"Hello Alex"}],"direct~43":[{id:2,direction:"incoming",text:"Hello Blair"}]};replies=[];
  vi.stubGlobal("fetch",vi.fn(async(input:string,init:RequestInit={})=>{
    const url=new URL(input,"http://test");
    if(url.pathname==="/api/status")return json({ok:true,telegramConfigured:true,automationEnabled:false});
    if(url.pathname==="/api/inbox")return json({conversations:[{conversationId:"direct~42",chatId:"42",senderId:"42",senderName:"Alex"},{conversationId:"direct~43",chatId:"43",senderId:"43",senderName:"Blair"}]});
    if(url.pathname==="/api/inbox/history"){history={"direct~42":[],"direct~43":[]};return json({deletedCount:2});}
    const match=url.pathname.match(/^\/api\/inbox\/(.+)\/(messages|reply)$/);
    if(match){const id=decodeURIComponent(match[1]);if(match[2]==="messages")return json({messages:history[id],hasMore:false,nextOffset:history[id].length});
      const {text}=JSON.parse(String(init.body));replies.push({id,text});history[id].push({id:3,direction:"outgoing",text});return json({ok:true,sent:true});}
    if(url.pathname==="/api/agent/contacts")return json({contacts:[{senderId:"42",enabled:true},{senderId:"43",enabled:false}]});
    if(url.pathname==="/api/activity")return json({events:[]});
    return json({ok:true,ownerIds:[]});
  }));
});
afterEach(()=>{cleanup();window.sessionStorage.clear();vi.unstubAllGlobals();vi.restoreAllMocks();});
async function openInbox(){render(<App/>);fireEvent.click(screen.getByRole("button",{name:"Inbox"}));await screen.findByText("Hello Alex");}
describe("Workspace / Inbox controls",()=>{
  it("navigates, refreshes the open conversation and sends a reply without blanking the thread",async()=>{
    await openInbox();fireEvent.click(screen.getByRole("button",{name:"Refresh"}));
    await waitFor(()=>expect(screen.queryByText("Loading conversation…")).toBeNull());expect(screen.getByText("Hello Alex")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox",{name:"Reply message"}),{target:{value:"My manual reply"}});
    fireEvent.click(screen.getByRole("button",{name:"Send"}));
    await screen.findByText("My manual reply");expect(replies).toEqual([{id:"direct~42",text:"My manual reply"}]);
  });
  it("preserves each draft when navigating between conversations and returning to the mobile list",async()=>{
    await openInbox();fireEvent.change(screen.getByRole("textbox",{name:"Reply message"}),{target:{value:"For Alex"}});
    fireEvent.click(screen.getByRole("button",{name:/Blair/}));await screen.findByText("Hello Blair");
    expect((screen.getByRole("textbox",{name:"Reply message"}) as HTMLTextAreaElement).value).toBe("");
    fireEvent.click(screen.getByRole("button",{name:"Back to conversations"}));
    expect(document.querySelector(".inbox-list")?.classList.contains("mobile-hidden")).toBe(false);
    fireEvent.click(screen.getByRole("button",{name:/Alex.*AI enabled/}));
    expect((screen.getByRole("textbox",{name:"Reply message"}) as HTMLTextAreaElement).value).toBe("For Alex");
  });
  it("retains conversation selection and manual reply access after confirmed cleanup",async()=>{
    await openInbox();vi.spyOn(window,"prompt").mockReturnValue("CLEAR HISTORY");
    fireEvent.click(screen.getByRole("button",{name:"Clear database copies"}));
    await screen.findByText("No stored messages");
    expect(screen.getByRole("textbox",{name:"Reply message"})).toBeTruthy();
    expect(document.querySelectorAll(".conversation")).toHaveLength(2);
  });
  it("does not send on IME composition or Shift+Enter",async()=>{
    await openInbox();const input=screen.getByRole("textbox",{name:"Reply message"});
    fireEvent.change(input,{target:{value:"ሰላም"}});fireEvent.keyDown(input,{key:"Enter",isComposing:true});fireEvent.keyDown(input,{key:"Enter",shiftKey:true});
    expect(replies).toEqual([]);
  });
});
