import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import type { Server } from "node:http";
import { PGlite } from "@electric-sql/pglite";

// Actual PostgreSQL engine, storage functions and HTTP routes. Only external services
// and owner configuration are simulated; no real Telegram/Supabase credentials used.
vi.mock("./profile-store.js", async importOriginal => ({
  ...await importOriginal<typeof import("./profile-store.js")>(),
  getOwnerUserIds: async () => ownerIds
}));
vi.mock("./rate-limit.js", async importOriginal => ({
  ...await importOriginal<typeof import("./rate-limit.js")>(),
  rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next()
}));
const nativeFetch = globalThis.fetch;
let db: PGlite;
let server: Server;
let base: string;
let store: typeof import("./store.js");
let ownerIds = ["1"];
let failStorage = false;
let failDelivery = false;
let failCopy = false;
let business = { id: "business-a", is_enabled: true, user: { id: 1 }, rights: { can_reply: true } };
let sent: Array<Record<string, unknown>> = [];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const message = (connection = "direct", chatId = "42") => ({ businessConnectionId: connection, chatId, senderId: "42", senderName: "Private name", username: "private_handle", direction: "incoming" as const, text: "Private message" });
async function request(path: string, method = "GET", token = "test-dashboard", confirm = true) {
  return nativeFetch(base + path, { method, headers: { "x-dashboard-token": token, "content-type": "application/json", ...(confirm ? { "x-confirm-inbox-cleanup": "DELETE_STORED_COPIES_ONLY" } : {}) }, ...(method === "POST" ? { body: JSON.stringify({ text: "Manual response" }) } : {}) });
}

beforeAll(async () => {
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("SUPABASE_URL", "https://storage.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "fake-service-key");
  vi.stubEnv("DASHBOARD_API_TOKEN", "test-dashboard");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "fake-token");
  vi.stubEnv("TELEGRAM_ALLOWED_GROUP_IDS", "-100");
  db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role;");
  await db.exec(await readFile("supabase/migrations/20261028000000_live_inbox.sql", "utf8"));
  await db.exec("insert into agent_messages (business_connection_id,chat_id,direction,message_text) values ('direct','99','incoming','legacy')");
  await db.exec(await readFile("supabase/migrations/20261104000000_inbox_conversations.sql", "utf8"));
  expect((await db.query("select * from agent_conversations")).rows).toHaveLength(1);
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    if (url.hostname === "api.telegram.org") {
      if (url.pathname.endsWith("getBusinessConnection")) return json({ ok: true, result: business });
      if (url.pathname.endsWith("sendMessage")) {
        sent.push(JSON.parse(String(init.body)));
        return failDelivery ? json({ ok: false, description: "permission revoked" }, 403) : json({ ok: true, result: { message_id: 12 } });
      }
      throw new Error("Unexpected Telegram method");
    }
    if (url.hostname !== "storage.test") throw new Error("Unexpected network call");
    if (failStorage) return json({}, 503);
    const resource = url.pathname.replace("/rest/v1/", "");
    if (resource === "agent_events") return json([]);
    if (resource === "rpc/clear_agent_message_history") {
      try { const result = await db.query<{ count: number }>("select clear_agent_message_history()::int as count"); return json(result.rows[0].count); }
      catch { return json({}, 500); }
    }
    if (resource === "agent_messages" && init.method === "POST") {
      if (failCopy) return json({}, 503);
      const row = JSON.parse(String(init.body));
      const keys = Object.keys(row);
      await db.query(`insert into agent_messages (${keys.join(",")}) values (${keys.map((_, i) => "$" + (i + 1)).join(",")})`, Object.values(row));
      return json([]);
    }
    if (resource === "agent_inbox" || resource === "agent_messages") {
      const values: string[] = [];
      const filters: string[] = [];
      for (const key of ["business_connection_id", "chat_id"]) {
        const value = url.searchParams.get(key);
        if (value) { values.push(value.slice(3)); filters.push(`${key} = $${values.length}`); }
      }
      const order = resource === "agent_inbox" ? "last_message_at desc, business_connection_id, chat_id" : "created_at desc";
      const limit = Number(url.searchParams.get("limit") || 500);
      const offset = Number(url.searchParams.get("offset") || 0);
      return json((await db.query(`select * from ${resource}${filters.length ? " where " + filters.join(" and ") : ""} order by ${order} limit ${limit} offset ${offset}`, values)).rows);
    }
    throw new Error("Unexpected storage operation: " + resource);
  }));
  store = await import("./store.js");
  const { default: app } = await import("./index.js");
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test port");
  base = `http://127.0.0.1:${address.port}`;
}, 30000);
beforeEach(async () => {
  await db.exec("truncate agent_messages, agent_conversations");
  failStorage = failDelivery = failCopy = false;
  sent = [];
  ownerIds = ["1"];
  business = { id: "business-a", is_enabled: true, user: { id: 1 }, rights: { can_reply: true } };
});
afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  if (db) await db.close();
  vi.unstubAllGlobals(); vi.unstubAllEnvs();
});

describe("history cleanup and retained destinations", () => {
  it("clears copies and names, keeps scoped destinations, and permits a manual reply", async () => {
    await store.recordMessage(message());
    await store.recordMessage(message("business-a"));
    expect((await request("/api/inbox/history", "DELETE")).status).toBe(200);
    const inbox = await store.listInbox();
    expect(inbox).toHaveLength(2);
    expect(inbox.every(c => c.messageCount === 0 && c.lastMessage === "" && c.senderName === "42" && c.username === "")).toBe(true);
    expect(await store.listConversationMessages("42", 0, 100, "direct")).toEqual([]);
    expect((await request("/api/inbox/direct~42/reply", "POST")).status).toBe(200);
    expect(sent).toEqual([{ chat_id: "42", text: "Manual response" }]);
    expect(await store.clearStoredInboxHistory()).toBe(1);
    expect(await store.clearStoredInboxHistory()).toBe(0);
    expect(await store.listInbox()).toHaveLength(2);
  });
  it("preserves more than 500 conversations and finds an exact older destination", async () => {
    await db.exec("insert into agent_messages(business_connection_id,chat_id,direction,message_text) select 'direct', n::text, 'incoming', 'body' from generate_series(1, 1100) n");
    expect(await store.clearStoredInboxHistory()).toBe(1100);
    expect(await store.listInbox()).toHaveLength(1100);
    expect(await store.getInboxConversation("direct", "1")).not.toBeNull();
  });
  it("retains metadata atomically, including later writes, without regressing activity on old updates", async () => {
    await store.recordMessage({ ...message(), createdAt: "2026-11-04T12:00:00Z" });
    await store.clearStoredInboxHistory();
    await store.recordMessage({ ...message(), createdAt: "2026-11-03T12:00:00Z" });
    expect((await store.listInbox())[0].lastMessageAt).toContain("2026-11-04");
    await db.exec("begin; insert into agent_messages(business_connection_id,chat_id,direction,message_text) values('direct','88','incoming','rollback'); rollback;");
    expect(await store.getInboxConversation("direct", "88")).toBeNull();
  });
  it("rejects unauthenticated cleanup and replies and requires explicit cleanup confirmation", async () => {
    await store.recordMessage(message());
    expect((await request("/api/inbox/history", "DELETE", "bad")).status).toBe(401);
    expect((await request("/api/inbox/direct~42/reply", "POST", "bad")).status).toBe(401);
    expect((await request("/api/inbox/history", "DELETE", "test-dashboard", false)).status).toBe(400);
    expect((await store.listInbox())[0].messageCount).toBe(1);
    expect(sent).toEqual([]);
  });
  it.each(["disabled", "reply-revoked", "owner-removed", "wrong-connection"])("blocks Business replies after cleanup: %s", async reason => {
    await store.recordMessage(message("business-a"));
    await store.clearStoredInboxHistory();
    if (reason === "disabled") business.is_enabled = false;
    if (reason === "reply-revoked") business.rights.can_reply = false;
    if (reason === "owner-removed") ownerIds = [];
    if (reason === "wrong-connection") business.id = "business-b";
    expect((await request("/api/inbox/business-a~42/reply", "POST")).status).toBe(403);
    expect(sent).toEqual([]);
  });
  it("routes Business replies only through the exact retained connection", async () => {
    await store.recordMessage(message("business-a"));
    await store.clearStoredInboxHistory();
    expect((await request("/api/inbox/business-b~42/reply", "POST")).status).toBe(404);
    expect((await request("/api/inbox/business-a~42/reply", "POST")).status).toBe(200);
    expect(sent[0].business_connection_id).toBe("business-a");
  });
  it("rechecks group authorization without sending storage-only group scopes to Telegram", async () => {
    await store.recordMessage(message("group:-100:42", "-100"));
    await store.recordMessage(message("group:-200:42", "-200"));
    await store.clearStoredInboxHistory();
    expect((await request("/api/inbox/group%3A-200%3A42~-200/reply", "POST")).status).toBe(403);
    expect((await request("/api/inbox/group%3A-100%3A42~-100/reply", "POST")).status).toBe(200);
    expect(sent).toEqual([{ chat_id: "-100", text: "Manual response" }]);
  });
  it("fails closed on storage errors without sending or reporting cleanup success", async () => {
    await store.recordMessage(message());
    failStorage = true;
    expect((await request("/api/inbox/history", "DELETE")).status).toBe(503);
    expect((await request("/api/inbox/direct~42/reply", "POST")).status).toBe(503);
    expect(sent).toEqual([]);
    failStorage = false;
    expect((await store.listInbox())[0].messageCount).toBe(1);
  });
  it("rolls back a database cleanup failure and denies anonymous SQL access", async () => {
    await store.recordMessage(message());
    await db.exec("create function reject_test_delete() returns trigger language plpgsql as $$ begin raise exception 'simulated failure'; end $$; create trigger reject_test_delete before delete on agent_messages for each row execute function reject_test_delete();");
    try {
      await expect(store.clearStoredInboxHistory()).rejects.toThrow("cleanup failed");
      expect((await store.listInbox())[0].messageCount).toBe(1);
    } finally { await db.exec("drop trigger reject_test_delete on agent_messages; drop function reject_test_delete();"); }
    await db.exec("set role anon");
    try {
      await expect(db.query("select clear_agent_message_history()" )).rejects.toThrow(/permission denied/);
      await expect(db.query("select * from agent_inbox")).rejects.toThrow(/permission denied/);
    } finally { await db.exec("reset role"); }
  });
  it("distinguishes Telegram delivery failure from a sent reply whose copy fails", async () => {
    await store.recordMessage(message());
    failDelivery = true;
    expect((await request("/api/inbox/direct~42/reply", "POST")).status).toBe(502);
    failDelivery = false; failCopy = true;
    const response = await request("/api/inbox/direct~42/reply", "POST");
    expect(await response.json()).toMatchObject({ ok: true, sent: true });
  });
});
