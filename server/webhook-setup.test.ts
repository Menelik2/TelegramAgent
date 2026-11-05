import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { inspectWebhookSetup, webhookOrigin } from "./webhook-setup.js";

const nativeFetch = globalThis.fetch;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
let server: Server, base: string;
let failure: { table: string; status: number; code?: string } | null = null;
let requests: Array<{ url: URL; init: RequestInit }> = [];
let infoFails = false;
const lastError = { url: "https://app.test/api/telegram/webhook", pending_update_count: 3, last_error_date: 1793750400, last_error_message: "Wrong response from the webhook: 503 Service Unavailable" };
const request = (register = false, token = "admin-token") => nativeFetch(base + "/api/agent/telegram/" + (register ? "configure-webhook" : "webhook-info"), {
  method: register ? "POST" : "GET", headers: { "x-dashboard-token": token }
});
beforeAll(async () => {
  vi.stubEnv("VERCEL", "1"); vi.stubEnv("DASHBOARD_API_TOKEN", "admin-token");
  vi.stubEnv("SUPABASE_URL", "https://storage.test"); vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "private-key");
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input)); requests.push({ url, init });
    if (url.hostname === "storage.test") {
      if (url.pathname.endsWith("/" + failure?.table)) return json({ code: failure!.code, details: "PRIVATE DATABASE CONTENT", message: "private-key" }, failure!.status);
      return json([]);
    }
    if (url.hostname !== "api.telegram.org") throw new Error("Unexpected external request");
    if (url.pathname.endsWith("/getWebhookInfo")) return infoFails ? json({ ok: false }, 401) : json({ ok: true, result: lastError });
    if (url.pathname.endsWith("/setWebhook")) return json({ ok: true, result: true });
    throw new Error("No real message sends allowed in setup checks");
  }));
  server = createServer((await import("./index.js")).default);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
beforeEach(() => {
  requests = []; failure = null; infoFails = false;
  vi.stubEnv("MULTI_USER_ENABLED", "false"); vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-bot"); vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "test-secret");
  vi.stubEnv("APP_BASE_URL", "https://app.test"); vi.stubEnv("SUPABASE_URL", "https://storage.test"); vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "private-key");
});
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("admin webhook setup", () => {
  it("rejects unauthenticated checks and configuration before accessing services", async () => {
    expect((await request(false, "bad")).status).toBe(401);
    expect((await request(true, "bad")).status).toBe(401); expect(requests).toHaveLength(0);
  });
  it("checks schema without reading private rows or writing anything", async () => {
    const response = await request(); expect(response.status).toBe(200);
    expect((await response.json()).setup.ready).toBe(true);
    for (const call of requests.filter(r => r.url.hostname === "storage.test")) {
      expect(call.init.method || "GET").toBe("GET"); expect(call.url.searchParams.get("limit")).toBe("0");
    }
    expect(requests.filter(r => r.url.hostname === "api.telegram.org").map(r => r.url.pathname)).toEqual(["/bottest-bot/getWebhookInfo"]);
  });
  it("identifies the missing admin migration and prevents registering an unusable backend", async () => {
    failure = { table: "agent_preferences", status: 400, code: "42703" };
    const response = await request(true); expect(response.status).toBe(503);
    const body = await response.json(); expect(body.setup.ready).toBe(false);
    expect(body.error).toContain("20261029000000_serverless_runtime_state.sql");
    expect(JSON.stringify(body)).not.toMatch(/PRIVATE DATABASE CONTENT|private-key/);
    expect(requests.some(r => r.url.hostname === "api.telegram.org")).toBe(false);
  });
  it("checks the enabled tenant mode and identifies missing per-chat setup", async () => {
    vi.stubEnv("MULTI_USER_ENABLED", "true"); failure = { table: "tenant_conversations", status: 404, code: "PGRST205" };
    const result = await inspectWebhookSetup(); expect(result.mode).toBe("private accounts"); expect(result.ready).toBe(false);
    expect(result.checks.find(c => !c.ok)?.migration).toBe("20261105010000_tenant_chat_ai.sql");
    expect(requests.every(r => !r.url.pathname.includes("agent_"))).toBe(true);
  });
  it("reports missing credentials and access-denied errors without exposing keys", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect((await inspectWebhookSetup()).checks.find(c => !c.ok)?.detail).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(requests).toHaveLength(0);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "private-key"); failure = { table: "telegram_updates", status: 403, code: "42501" };
    const result = await inspectWebhookSetup(); expect(result.ready).toBe(false);
    expect(result.checks.find(c => !c.ok)?.detail).toContain("Database access denied");
    expect(JSON.stringify(result)).not.toContain("private-key");
  });
  it("does not mistake an outage for a missing migration", async () => {
    failure = { table: "agent_messages", status: 503 };
    const check = (await inspectWebhookSetup()).checks.find(c => !c.ok)!;
    expect(check.detail).toContain("HTTP 503"); expect(check.migration).toBeUndefined();
  });
  it("preserves pending updates and labels Telegram's timestamped error as last reported", async () => {
    const response = await request(true); expect(response.status).toBe(200);
    const body = await response.json(); expect(body.webhook).toEqual(lastError);
    expect(body.message).toContain("2026-11-04T00:00:00.000Z"); expect(body.message).toContain("may predate registration");
    const payload = JSON.parse(String(requests.find(r => r.url.pathname.endsWith("/setWebhook"))!.init.body));
    expect(payload.drop_pending_updates).toBe(false); expect(payload.secret_token).toBe("test-secret");
  });
  it("reports successful registration separately from failed status retrieval", async () => {
    infoFails = true; const response = await request(true);
    expect(response.status).toBe(200); expect((await response.json()).message).toContain("delivery status could not be checked");
    const check = await request(); expect(check.status).toBe(502); expect((await check.json()).setup.ready).toBe(true);
  });
  it("normalizes an APP_BASE_URL with a dashboard path before registration", async () => {
    vi.stubEnv("APP_BASE_URL", " https://app.test/dashboard?old=true#settings ");
    expect(webhookOrigin()).toBe("https://app.test"); await request(true);
    expect(JSON.parse(String(requests.find(r => r.url.pathname.endsWith("/setWebhook"))!.init.body)).url).toBe("https://app.test/api/telegram/webhook");
  });
  it.each(["http://app.test", "https://user:password@app.test", "broken"])("rejects invalid address %s", async value => {
    vi.stubEnv("APP_BASE_URL", value); expect(webhookOrigin()).toBeNull();
    expect((await request(true)).status).toBe(409); expect(requests).toHaveLength(0);
  });
});
