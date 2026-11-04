import { afterEach, describe, expect, it, vi } from "vitest";
import { checkOperationDeadline, operationSignal, withOperationDeadline, withoutOperationDeadline } from "./operation-deadline.js";
afterEach(()=>vi.useRealTimers());
describe("worker request deadlines",()=>{
  it("aborts a slow operation but permits independent status cleanup",async()=>{
    vi.useFakeTimers();
    let signal!:AbortSignal;
    const pending=withOperationDeadline(100,async()=>{
      signal=operationSignal(5000);
      await new Promise<void>(resolve=>signal.addEventListener("abort",()=>resolve(),{once:true}));
      expect(()=>checkOperationDeadline()).toThrow("Worker deadline reached");
      await withoutOperationDeadline(async()=>{expect(operationSignal(1000).aborted).toBe(false);checkOperationDeadline();});
    });
    await vi.advanceTimersByTimeAsync(100);await pending;expect(signal.aborted).toBe(true);
    checkOperationDeadline();
  });
  it("does not share cancellation between concurrent accounts",async()=>{
    vi.useFakeTimers();let short!:AbortSignal,long!:AbortSignal;
    const a=withOperationDeadline(50,async()=>{short=operationSignal(1000);await new Promise(resolve=>setTimeout(resolve,60));});
    const b=withOperationDeadline(500,async()=>{long=operationSignal(1000);await new Promise(resolve=>setTimeout(resolve,60));expect(long.aborted).toBe(false);});
    await vi.advanceTimersByTimeAsync(60);await Promise.all([a,b]);
    expect(short.aborted).toBe(true);expect(long.aborted).toBe(false);
  });
});
