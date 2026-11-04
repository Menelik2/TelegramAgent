// Run on an always-on worker host. Do not put CRON_SECRET in the frontend.
const url = process.env.APP_BASE_URL?.replace(/\/$/, "");
const secret = process.env.CRON_SECRET;
if (!url?.startsWith("https://") || !secret || secret.length < 32) throw new Error("Set APP_BASE_URL (https) and CRON_SECRET (32+ characters).");
let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });
while (!stopping) {
  try {
    const result = await fetch(url + "/api/tenant-worker", { headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(90000) });
    console.log("tenant_worker", result.status);
  } catch { console.error("tenant_worker_request_failed"); }
  if (!stopping) await new Promise(resolve => setTimeout(resolve, 2000));
}
