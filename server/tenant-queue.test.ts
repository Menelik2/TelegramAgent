import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./tenant-agent.js",()=>({processTenantJob:vi.fn(async()=>undefined)}));
vi.mock("./tenant-store.js",()=>({tenantDb:vi.fn()}));
vi.mock("node:timers/promises",()=>({setTimeout:vi.fn(async()=>undefined)}));
vi.mock("@vercel/functions",()=>({waitUntil:vi.fn()}));
import { processTenantJob } from "./tenant-agent.js";
import { tenantDb, type TenantJob } from "./tenant-store.js";
import { setTimeout as delay } from "node:timers/promises";
import { waitUntil } from "@vercel/functions";
import { runTenantBatch, runTenantQueue, scheduleTenantQueue } from "./tenant-queue.js";
const job=(n:number)=>({update_id:String(n),owner_id:String(n),connection_id:"c"+n,chat_id:"42",message_id:n,status:"processing"}) as TenantJob;
let queue:TenantJob[];
beforeEach(()=>{
  vi.stubEnv("TENANT_WORKER_MODE","");vi.stubEnv("VERCEL","1");queue=[];
  vi.mocked(waitUntil).mockClear();vi.mocked(delay).mockClear();vi.mocked(processTenantJob).mockClear();
  vi.mocked(tenantDb).mockReset().mockImplementation(async(path:string)=>{
    if(path==="rpc/tenant_retention")return null;
    if(path==="rpc/tenant_claim_job"){const next=queue.shift();return next?[next]:[];}
    if(path.startsWith("tenant_jobs?"))return [];
    throw new Error("Unexpected storage query");
  });
});
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});
describe("bounded automatic queue processing",()=>{
  it("registers background work with Vercel before processing starts",async()=>{
    queue=[job(1)];expect(scheduleTenantQueue()).toBe(true);
    expect(waitUntil).toHaveBeenCalledTimes(1);expect(tenantDb).not.toHaveBeenCalled();
    await vi.mocked(waitUntil).mock.calls[0][0];expect(processTenantJob).toHaveBeenCalledWith(job(1));
    expect(delay).toHaveBeenCalledWith(11000,undefined,expect.objectContaining({signal:expect.any(AbortSignal)}));
  });
  it("drains more than one batch with at most four independent jobs per claim batch",async()=>{
    queue=Array.from({length:10},(_,n)=>job(n));await runTenantQueue();
    expect(processTenantJob).toHaveBeenCalledTimes(10);expect(queue).toHaveLength(0);
  });
  it("limits one invocation to eight batches rather than running indefinitely",async()=>{
    queue=Array.from({length:40},(_,n)=>job(n));await runTenantQueue();
    expect(processTenantJob).toHaveBeenCalledTimes(32);expect(queue).toHaveLength(8);
  });
  it("processes already claimed work when a later database claim fails",async()=>{
    vi.mocked(tenantDb).mockResolvedValueOnce([job(1)]).mockRejectedValueOnce(new Error("Storage failed"));
    await expect(runTenantBatch()).rejects.toThrow("could not be confirmed");
    expect(processTenantJob).toHaveBeenCalledWith(job(1));
  });
  it("waits once for delayed work but does not spin on a blocked chat",async()=>{
    vi.mocked(tenantDb).mockImplementation(async(path:string)=>path.startsWith("tenant_jobs?")?[{update_id:"blocked"}]:path==="rpc/tenant_retention"?null:[]);
    await runTenantQueue();expect(delay).toHaveBeenCalledTimes(2);expect(processTenantJob).not.toHaveBeenCalled();
  });
  it("logs a generic background failure without exposing storage errors",async()=>{
    const log=vi.spyOn(console,"error").mockImplementation(()=>undefined);
    vi.mocked(tenantDb).mockRejectedValue(new Error("private message and secret details"));
    scheduleTenantQueue();await vi.mocked(waitUntil).mock.calls[0][0];
    expect(log).toHaveBeenCalledWith("tenant_background_worker_failed");expect(JSON.stringify(log.mock.calls)).not.toContain("private message");
    expect(processTenantJob).not.toHaveBeenCalled();
  });
  it.each(["external","invalid"])("does not start automatic work in %s mode",mode=>{
    vi.stubEnv("TENANT_WORKER_MODE",mode);expect(scheduleTenantQueue()).toBe(false);
    expect(waitUntil).not.toHaveBeenCalled();expect(tenantDb).not.toHaveBeenCalled();
  });
  it("does not claim work after its invocation deadline",async()=>{
    await runTenantQueue(Date.now()-1);expect(tenantDb).not.toHaveBeenCalled();
  });
});
