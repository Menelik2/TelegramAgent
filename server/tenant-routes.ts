import { runTenantBatch, scheduleTenantQueue } from "./tenant-queue.js";
import { withOperationDeadline } from "./operation-deadline.js";
import { Router, type Request, type Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { telegramAccount } from "./tenant-auth.js";
import { multiUserEnabled, saveTenantSettings, TenantActivationError, telegramCall, verifyTenantConnection } from "./tenant-agent.js";
import { tenantAccount, tenantBudget, tenantDb, eq, type TenantJob, type TenantMessage } from "./tenant-store.js";
import { safeText } from "./policy.js";
import { tenantCredentialStatus, saveTenantCredential, deleteTenantCredential } from "./tenant-credentials.js";

export const tenantRouter = Router();
tenantRouter.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  if (!multiUserEnabled()) return res.status(503).json({ error: "Multi-user accounts are not enabled yet." });
  const owner = telegramAccount(req.header("x-telegram-init-data") || "", process.env.TELEGRAM_BOT_TOKEN || "");
  if (!owner) return res.status(401).json({ error: "Open this dashboard from the bot in Telegram. Sessions expire after one hour; reopen to sign in again." });
  res.locals.tenantOwner = owner;
  next();
});
const owner = (res: Response): string => res.locals.tenantOwner;
const route = (handler: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response) => {
  void handler(req, res).catch(error => error instanceof TenantActivationError
    ? res.status(error.status).json({ error: error.message, code: error.code })
    : res.status(503).json({ error: "Operation could not be confirmed. Refresh to check saved settings. If sending failed, check Telegram before retrying. Contact the operator if this continues." }));
};
tenantRouter.get("/me", route(async (_req, res) => {
  const id = owner(res);
  // A verified Mini App launch may precede /start. Registration grants no consent or access.
  const [account, connections, usage, recent, blocked] = await Promise.all([
    tenantAccount(id, true), tenantDb(`tenant_connections?owner_id=${eq(id)}`),
    tenantDb(`tenant_daily_usage?owner_id=${eq(id)}&order=day.desc&limit=1`),
    tenantDb<TenantJob[]>(`tenant_jobs?select=update_id,status,chat_id,created_at&owner_id=${eq(id)}&order=created_at.desc&limit=20`),
    tenantDb<TenantJob[]>(`tenant_jobs?select=update_id,status,chat_id,created_at&owner_id=${eq(id)}&status=eq.uncertain&order=created_at.asc&limit=1000`)
  ]);
  const jobs = [...new Map([...blocked, ...recent].map(job => [job.update_id, job])).values()];
  return res.json({ account, connections, usage, jobs });
}));
// Explicit, independent permission for operator support access to stored inbox copies.
tenantRouter.put("/admin-inbox-access", route(async (req, res) => {
  if (typeof req.body?.enabled !== "boolean") return res.status(400).json({ error: "Choose whether to allow support inbox access." });
  const id = owner(res);
  const rows = await tenantDb<Array<{admin_inbox_access:boolean}>>(`tenant_accounts?owner_id=${eq(id)}`, "PATCH", { admin_inbox_access: req.body.enabled });
  if (!rows[0]) return res.status(404).json({ error: "Account not found." });
  return res.json({ ok: true, enabled: rows[0].admin_inbox_access === true });
}));
// Credentials are scoped to the verified Telegram Mini App owner and never returned.
tenantRouter.get("/ai-key", route(async (_req, res) => {
  return res.json({ ok: true, ...await tenantCredentialStatus(owner(res)) });
}));
tenantRouter.put("/ai-key", route(async (req, res) => {
  const key = req.body?.apiKey;
  if (typeof key !== "string" || key.length > 256) return res.status(400).json({ error: "Enter a Gemini API key." });
  await saveTenantCredential(owner(res), key.trim());
  return res.json({ ok: true, configured: true, model: "gemini-3.5-flash-lite" });
}));
tenantRouter.delete("/ai-key", route(async (_req, res) => {
  await deleteTenantCredential(owner(res));
  return res.json({ ok: true, configured: false });
}));
tenantRouter.put("/automation", route(async (req, res) => {
  const { enabled, consent } = req.body || {};
  if (typeof enabled !== "boolean") return res.status(400).json({ error: "Choose whether automatic replies should be enabled." });
  return res.json({ ok: true, ...await saveTenantSettings(owner(res), { enabled, consent: consent === true }) });
}));
tenantRouter.put("/settings", route(async (req, res) => {
  const { enabled, tone, language, consent } = req.body || {};
  if ((enabled !== undefined && typeof enabled !== "boolean") || typeof tone !== "string" || !tone.trim() || tone.length > 160 || typeof language !== "string" || !language.trim() || language.length > 80) return res.status(400).json({ error: "Invalid settings." });
  return res.json({ ok: true, ...await saveTenantSettings(owner(res), { enabled, tone: safeText(tone,160), language: safeText(language,80), consent: consent === true }) });
}));
tenantRouter.get("/inbox", route(async (req, res) => {
  const offset = Number(req.query.offset || 0);
  if (!Number.isSafeInteger(offset) || offset < 0) return res.status(400).json({ error: "Invalid page." });
  const search = String(req.query.q || "").trim();
  if (search && !/^\d{1,20}$/.test(search)) return res.status(400).json({ error: "Search using a numeric chat ID." });
  type InboxRow = { owner_id: string; connection_id: string; chat_id: string; last_at: string; tenant_messages: Pick<TenantMessage,"body"|"direction"|"created_at">[] };
  // The composite foreign key includes owner + connection + chat. Previews come from
  // removable copies, never from additional permanent personal-data storage.
  const rows = await tenantDb<InboxRow[]>(`tenant_conversations?select=owner_id,connection_id,chat_id,last_at,tenant_messages(body,direction,created_at)&owner_id=${eq(owner(res))}${search ? `&chat_id=like.*${search}*` : ""}&order=last_at.desc,connection_id.asc,chat_id.asc&limit=101&offset=${offset}&tenant_messages.order=id.desc&tenant_messages.limit=1`);
  const conversations = rows.slice(0,100).map(({ tenant_messages, ...conversation }) => ({
    ...conversation, last_message: tenant_messages[0]?.body.slice(0,160) ?? null,
    last_direction: tenant_messages[0]?.direction ?? null, last_message_at: tenant_messages[0]?.created_at ?? null
  }));
  return res.json({ conversations, hasMore: rows.length > 100, nextOffset: rows.length > 100 ? offset + 100 : null });
}));
tenantRouter.get("/messages", route(async (req, res) => {
  const connection = String(req.query.connection || ""), chat = String(req.query.chat || "");
  const before = String(req.query.before || ""), limit = Number(req.query.limit || 100);
  if (!connection || connection.length > 256 || !/^\d{1,20}$/.test(chat) || !Number.isInteger(limit) || limit < 1 || limit > 100 || (before && (!/^[1-9]\d{0,18}$/.test(before) || BigInt(before) > 9223372036854775807n))) return res.status(400).json({ error: "Invalid conversation or message page." });
  const rows = await tenantDb<TenantMessage[]>(`tenant_messages?owner_id=${eq(owner(res))}&connection_id=${eq(connection)}&chat_id=${eq(chat)}${before ? `&id=lt.${before}` : ""}&order=id.desc&limit=${limit+1}`);
  const messages = rows.slice(0,limit).reverse();
  return res.json({ messages, hasMore: rows.length > limit, nextBefore: rows.length > limit ? String(messages[0].id) : null });
}));
tenantRouter.delete("/history", route(async (req, res) => {
  if (req.header("x-confirm-inbox-cleanup") !== "DELETE_STORED_COPIES_ONLY") return res.status(400).json({ error: "Confirmation required." });
  return res.json({ ok: true, deletedCount: await tenantDb("rpc/tenant_clear_history","POST",{ p_owner: owner(res) }) });
}));
tenantRouter.post("/jobs/:id/cancel", route(async (req, res) => {
  const cancelled = await tenantDb<TenantJob[]>(`tenant_jobs?owner_id=${eq(owner(res))}&update_id=${eq(String(req.params.id))}&status=in.(pending,uncertain,failed)`, "PATCH", { status: "cancelled" });
  if (cancelled.length) scheduleTenantQueue();
  return res.json({ ok: true });
}));
tenantRouter.post("/reply", route(async (req, res) => {
  const id=owner(res), connection=String(req.body?.connection || ""), chat=String(req.body?.chat || "");
  const text=safeText(req.body?.text,4096);
  if (!text) return res.status(400).json({ error: "Enter a reply." });
  const conversations=await tenantDb<unknown[]>(`tenant_conversations?owner_id=${eq(id)}&connection_id=${eq(connection)}&chat_id=${eq(chat)}`);
  if (!conversations.length) return res.status(404).json({ error: "Conversation not found." });
  if (!(await verifyTenantConnection(id,connection))) return res.status(403).json({ error: "Connection disabled or reply permission revoked." });
  if (!(await tenantBudget(id))) return res.status(429).json({ error: "Daily reply budget reached." });
  const result=await telegramCall<{message_id:number}>("sendMessage",{ business_connection_id:connection,chat_id:chat,text });
  let message: TenantMessage | null = null;
  try { message = (await tenantDb<TenantMessage[]>("tenant_messages","POST",{owner_id:id,connection_id:connection,chat_id:chat,direction:"outgoing",body:text,telegram_id:result.message_id}))[0] ?? null; } catch { /* Telegram delivery already succeeded. Never encourage a duplicate send. */ }
  return res.json({ok:true,sent:true,stored:message!==null,message});
}));

export async function tenantWorker(req: Request, res: Response) {
  const expected = process.env.CRON_SECRET || "", provided = req.header("authorization") || "";
  const a = Buffer.from("Bearer " + expected), b = Buffer.from(provided);
  if (!multiUserEnabled() || expected.length < 32 || a.length !== b.length || !timingSafeEqual(a,b)) return res.status(401).json({error:"Unauthorized worker."});
  try {
    const processed = await withOperationDeadline(240_000, async () => {
      await tenantDb("rpc/tenant_retention", "POST", {});
      return runTenantBatch();
    });
    return res.json({ok:true,processed});
  } catch { return res.status(503).json({error:"Worker storage unavailable."}); }
}
