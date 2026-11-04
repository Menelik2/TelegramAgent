import { setTimeout as delay } from "node:timers/promises";
import { waitUntil } from "@vercel/functions";
import { processTenantJob } from "./tenant-agent.js";
import { tenantDb, type TenantJob } from "./tenant-store.js";
import { checkOperationDeadline, operationSignal, withOperationDeadline } from "./operation-deadline.js";
import { tenantWorkerMode } from "./tenant-worker-config.js";

export async function runTenantBatch(): Promise<number> {
  const jobs: TenantJob[] = [];
  let claimFailed = false;
  try {
    for (let i = 0; i < 4; i++) {
      checkOperationDeadline();
      const batch = await tenantDb<TenantJob[]>("rpc/tenant_claim_job", "POST", {});
      if (!batch.length) break;
      jobs.push(batch[0]);
    }
  } catch { claimFailed = true; }
  // A later claim failure must not abandon jobs already claimed by this batch.
  const results = await Promise.allSettled(jobs.map(job => processTenantJob(job)));
  if (claimFailed || results.some(result => result.status === "rejected")) throw new Error("Queue processing could not be confirmed.");
  return jobs.length;
}

/** Bounded work per invocation; PostgreSQL coordinates all concurrent instances. */
export async function runTenantQueue(deadlineAt = Date.now() + 240_000): Promise<void> {
  if (deadlineAt <= Date.now()) return;
  await withOperationDeadline(deadlineAt - Date.now(), async () => {
    await tenantDb("rpc/tenant_retention", "POST", {});
    // Jobs become eligible 10 seconds after insertion. Never bypass that SQL guard.
    await delay(11_000, undefined, { signal: operationSignal(15_000) });
    for (let batch = 0; batch < 8; batch++) {
      checkOperationDeadline();
      if (await runTenantBatch()) continue;
      const pending = await tenantDb<Array<{ update_id: string }>>("tenant_jobs?select=update_id&status=eq.pending&limit=1");
      if (!pending.length) return;
      // A newer message may still be delayed or another worker may be finishing.
      // Do not spin forever on chats blocked by an uncertain send.
      await delay(11_000, undefined, { signal: operationSignal(15_000) });
      if (!(await runTenantBatch())) return;
    }
  });
}

export function scheduleTenantQueue(deadlineAt = Date.now() + 240_000): boolean {
  if (tenantWorkerMode() !== "webhook") return false;
  const task = Promise.resolve().then(() => runTenantQueue(deadlineAt)).catch(() => {
    // No message text, tokens, or provider response bodies in background logs.
    console.error("tenant_background_worker_failed");
  });
  // Vercel must retain the request lifetime after the webhook acknowledges ingestion.
  if (process.env.VERCEL === "1") waitUntil(task);
  return true;
}
