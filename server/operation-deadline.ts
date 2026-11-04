import { AsyncLocalStorage } from "node:async_hooks";

const deadline = new AsyncLocalStorage<AbortSignal>();
export function operationSignal(timeoutMs: number): AbortSignal {
  const shared = deadline.getStore();
  const timeout = AbortSignal.timeout(timeoutMs);
  return shared ? AbortSignal.any([shared, timeout]) : timeout;
}
export function checkOperationDeadline(): void { deadline.getStore()?.throwIfAborted(); }
export async function withOperationDeadline<T>(milliseconds: number, run: () => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Worker deadline reached.")), Math.max(0, milliseconds));
  try { return await deadline.run(controller.signal, run); }
  finally { clearTimeout(timer); }
}
/** Reserve a final independent storage request to record an interrupted delivery. */
export function withoutOperationDeadline<T>(run: () => Promise<T>): Promise<T> { return deadline.exit(run); }
