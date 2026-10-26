const base = (process.env.API_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
const token = process.env.DASHBOARD_API_TOKEN || "";
const checks = [];
async function check(name, path, options, accept) {
  try {
    const response = await fetch(base + path, options);
    const body = await response.json().catch(() => ({}));
    const passed = accept(response, body);
    checks.push({ name, passed, status: response.status, detail: passed ? "ok" : String(body.error || "unexpected response") });
  } catch (error) {
    checks.push({ name, passed: false, status: 0, detail: error instanceof Error ? error.message : "request failed" });
  }
}
await check("API health", "/api/health", {}, (r, b) => r.ok && b.ok === true);
await check("Public status", "/api/status", {}, (r, b) => r.ok && b.ok === true && typeof b.automationEnabled === "boolean");
await check("Webhook rejects missing secret", "/api/telegram/webhook", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ update_id: 1 })
}, r => r.status === 401);
if (token) {
  const headers = { "x-dashboard-token": token };
  await check("Dashboard auth", "/api/agent/settings", { headers }, (r, b) => r.ok && b.mode === "explicit-allowlist");
  await check("Live inbox endpoint", "/api/inbox", { headers }, (r, b) => r.ok && Array.isArray(b.conversations));
  await check("Activity endpoint", "/api/activity?limit=5", { headers }, (r, b) => r.ok && Array.isArray(b.events));
} else {
  console.log("DASHBOARD_API_TOKEN not set; authenticated inbox/activity checks skipped.");
}
for (const item of checks) console.log(`${item.passed ? "PASS" : "FAIL"} ${item.name} [${item.status}]: ${item.detail}`);
if (checks.some(item => !item.passed)) process.exitCode = 1;
