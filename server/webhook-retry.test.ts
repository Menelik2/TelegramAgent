import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let generateReply: typeof import("./ai.js")["generateReply"];
vi.mock("./ai.js", async original => ({ ...await original<typeof import("./ai.js")>(), generateReply: vi.fn() }));
const nativeFetch = globalThis.fetch;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
let server: Server, base: string;
let store: typeof import("./store.js");
let claimed = new Set<string>();
let messages: Array<Record<string, unknown>> = [];
let failPreferences = false, failContacts = false, claimStatus = 200, failMessage = false;
let sends = 0, enabled = false, allowed = false, uncertain = false, rejected = false;
const incoming = { update_id: 71001, message: { message_id: 88, chat: { type: "private", id: 42 }, from: { id: 42 }, text: "Hello" } };
const webhook = (secret = "test-secret") => nativeFetch(base + "/api/telegram/webhook", {
  method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret }, body: JSON.stringify(incoming)
});
beforeAll(async () => {
  vi.stubEnv("VERCEL", "1"); vi.stubEnv("MULTI_USER_ENABLED", "false");
  vi.stubEnv("SUPABASE_URL", "https://storage.test"); vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "test-secret"); vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
  vi.stubEnv("TELEGRAM_ALLOWED_USER_IDS", "42"); vi.stubEnv("REPLY_DELAY_MS_MIN", "0"); vi.stubEnv("REPLY_DELAY_MS_MAX", "0");
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    if (url.hostname === "api.telegram.org") {
      if (url.pathname.endsWith("sendChatAction")) return json({ ok: true });
      if (url.pathname.endsWith("sendMessage")) {
        sends++; if (uncertain) throw new Error("Connection lost after request");
        return rejected ? json({ ok: false, description: "Rate limited" }, 429) : json({ ok: true });
      }
      throw new Error("Unexpected Telegram method");
    }
    if (url.hostname !== "storage.test") throw new Error("Unexpected network");
    const table = url.pathname.split("/").at(-1);
    if (table === "telegram_updates") {
      if (claimStatus !== 200) return json({ code: "42P01" }, claimStatus);
      if (init.method === "DELETE") { claimed.delete(url.searchParams.get("update_id")!.slice(3)); return json([]); }
      const id = JSON.parse(String(init.body)).update_id;
      if (claimed.has(id)) return json({ code: "23505" }, 409);
      claimed.add(id); return json([]);
    }
    if (table === "agent_owner_settings") return json([{ owner_user_ids: ["1"] }]);
    if (table === "agent_contacts") return failContacts ? json({}, 503) : json([{ sender_id: "42", enabled: allowed }]);
    if (table === "agent_preferences") return failPreferences ? json({}, 503) : json([{ automation_enabled: enabled, memory_enabled: false }]);
    if (table === "agent_events") return json([]);
    if (table === "agent_messages") {
      if (failMessage) return json({}, 503);
      if (init.method === "POST") {
        const row = JSON.parse(String(init.body));
        if (messages.some(m => m.update_id === row.update_id && m.direction === row.direction)) return json({ code: "23505" }, 409);
        messages.push(row); return json([]);
      }
      return json(messages.filter(m => ["update_id", "direction", "business_connection_id", "chat_id"].every(k => !url.searchParams.has(k) || String(m[k]) === url.searchParams.get(k)!.slice(3))));
    }
    throw new Error("Unexpected table " + table);
  }));
  generateReply = (await import("./ai.js")).generateReply;
  store = await import("./store.js");
  server = createServer((await import("./index.js")).default);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
beforeEach(() => { claimed = new Set(); messages = []; failPreferences = failContacts = failMessage = false; claimStatus = 200; sends = 0; enabled = allowed = uncertain = rejected = false; vi.mocked(generateReply).mockReset().mockResolvedValue("Hello back"); });
afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  vi.unstubAllGlobals(); vi.unstubAllEnvs();
});
describe("legacy webhook retry recovery", () => {
  it("recovers from an outage after saving the incoming copy, without a duplicate-insert 503 loop", async () => {
    failPreferences = true;
    expect((await webhook()).status).toBe(503);
    expect(messages).toHaveLength(1); expect(claimed.size).toBe(0);
    failPreferences = false;
    expect((await webhook()).status).toBe(200);
    expect(messages).toHaveLength(1);
    expect(await (await webhook()).json()).toMatchObject({ duplicate: true });
    expect(sends).toBe(0);
  });
  it("keeps a failed message write retryable", async () => {
    failMessage = true; expect((await webhook()).status).toBe(503);
    expect(claimed.size).toBe(0); expect(messages).toHaveLength(0);
    failMessage = false; expect((await webhook()).status).toBe(200);
    expect(messages).toHaveLength(1);
  });
  it("does not accept a missing deduplication table or start processing", async () => {
    claimStatus = 404; expect((await webhook()).status).toBe(503);
    expect(messages).toHaveLength(0); expect(sends).toBe(0);
  });
  it("does not override saved revocation with the environment allowlist when permissions cannot be read", async () => {
    failContacts = true; expect((await webhook()).status).toBe(503);
    expect(claimed.size).toBe(0); expect(sends).toBe(0);
    failContacts = false; expect((await webhook()).status).toBe(200);
  });
  it("rejects untrusted requests without touching storage", async () => {
    expect((await webhook("wrong")).status).toBe(401);
    expect(claimed.size).toBe(0); expect(messages).toHaveLength(0);
  });
  it("recovers from an AI failure with one saved incoming copy and one delivered reply", async () => {
    enabled = allowed = true;
    vi.mocked(generateReply).mockRejectedValueOnce(new Error("Temporary provider outage"));
    expect((await webhook()).status).toBe(503); expect(claimed.size).toBe(0); expect(sends).toBe(0);
    expect(await (await webhook()).json()).toMatchObject({ sent: true });
    expect(sends).toBe(1); expect(messages.filter(m => m.direction === "incoming")).toHaveLength(1);
    expect(await (await webhook()).json()).toMatchObject({ duplicate: true }); expect(sends).toBe(1);
  });
  it("keeps ambiguous sends claimed so retries cannot deliver duplicate replies", async () => {
    enabled = allowed = uncertain = true;
    expect(await (await webhook()).json()).toMatchObject({ uncertain: true }); expect(sends).toBe(1);
    uncertain = false;
    expect(await (await webhook()).json()).toMatchObject({ duplicate: true }); expect(sends).toBe(1);
  });
  it("retries a confirmed Telegram rejection without a duplicate-copy failure", async () => {
    enabled = allowed = rejected = true;
    expect((await webhook()).status).toBe(502); expect(claimed.size).toBe(0);
    rejected = false;
    expect(await (await webhook()).json()).toMatchObject({ sent: true });
    expect(messages.filter(m => m.direction === "incoming")).toHaveLength(1);
  });
  it.each(["pause", "revocation", "permission outage"])("rechecks %s after AI generation", async reason => {
    enabled = allowed = true;
    vi.mocked(generateReply).mockImplementationOnce(async () => {
      if (reason === "pause") enabled = false;
      if (reason === "revocation") allowed = false;
      if (reason === "permission outage") failContacts = true;
      return "Hello back";
    });
    expect((await webhook()).status).toBe(reason === "permission outage" ? 503 : 200); expect(sends).toBe(0);
  });
  it.each(["businessConnectionId", "chatId", "senderId", "text"] as const)("does not swallow a duplicate constraint for different %s", async field => {
    const message = { updateId: "123", businessConnectionId: "a", chatId: "42", senderId: "42", senderName: "", username: "", text: "private", direction: "incoming" as const };
    await store.recordMessage(message);
    await expect(store.recordMessage({ ...message, [field]: "different" })).rejects.toThrow();
  });
});
