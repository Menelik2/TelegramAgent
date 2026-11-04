import { Router, type Request, type Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { telegramAccount } from "./tenant-auth.js";
import { multiUserEnabled, processTenantJob, telegramCall, verifyTenantConnection } from "./tenant-agent.js";
import { tenantAccount, tenantBudget, tenantDb, tenantThread, eq, type TenantJob } from "./tenant-store.js";
import { safeText } from "./policy.js";

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
  void handler(req, res).catch(() => res.status(503).json({ error: "Operation unavailable. Check connection permissions and try again. If sending failed, check Telegram before retrying." }));
};
tenantRouter.get("/me", route(async (_req, res) => {
  const id = owner(res);
  const [account, connections, usage, recent, blocked] = await Promise.all([
    tenantAccount(id), tenantDb(`tenant_connections?owner_id=${eq(id)}`),
    tenantDb(`tenant_daily_usage?owner_id=${eq(id)}&order=day.desc&limit=1`),
    tenantDb<TenantJob[]>(`tenant_jobs?select=update_id,status,chat_id,created_at&owner_id=${eq(id)}&order=created_at.desc&limit=20`),
    tenantDb<TenantJob[]>(`tenant_jobs?select=update_id,status,chat_id,created_at&owner_id=${eq(id)}&status=eq.uncertain&order=created_at.asc&limit=1000`)
  ]);
  const jobs = [...new Map([...blocked, ...recent].map(job => [job.update_id, job])).values()];
  return res.json({ account, connections, usage, jobs });
}));
tenantRouter.put("/settings", route(async (req, res) => {
  const id = owner(res);
  const current = await tenantAccount(id);
  const { enabled, tone, language, consent } = req.body || {};
  if (typeof enabled !== "boolean" || typeof tone !== "string" || !tone.trim() || tone.length > 160 || typeof language !== "string" || !language.trim() || language.length > 80) return res.status(400).json({ error: "Invalid settings." });
  if (enabled && !current.consent_at && consent !== true) return res.status(400).json({ error: "Consent to AI processing is required." });
  await tenantDb(`tenant_accounts?owner_id=${eq(id)}`, "PATCH", { enabled, tone: safeText(tone,160), language: safeText(language,80), ...(enabled && !current.consent_at ? { consent_at: new Date().toISOString() } : {}) });
  if (!enabled) await tenantDb(`tenant_jobs?owner_id=${eq(id)}&status=in.(pending,processing)`, "PATCH", { status: "cancelled" });
  return res.json({ ok: true });
}));
tenantRouter.get("/inbox", route(async (req, res) => {
  const offset = Number(req.query.offset || 0);
  if (!Number.isSafeInteger(offset) || offset < 0) return res.status(400).json({ error: "Invalid page." });
  const conversations = await tenantDb(`tenant_conversations?owner_id=${eq(owner(res))}&order=last_at.desc,connection_id.asc,chat_id.asc&limit=100&offset=${offset}`);
  return res.json({ conversations });
}));
tenantRouter.get("/messages", route(async (req, res) => {
  const connection = String(req.query.connection || ""), chat = String(req.query.chat || "");
  return res.json({ messages: (await tenantThread(owner(res),connection,chat,100)).reverse() });
}));
tenantRouter.delete("/history", route(async (req, res) => {
  if (req.header("x-confirm-inbox-cleanup") !== "DELETE_STORED_COPIES_ONLY") return res.status(400).json({ error: "Confirmation required." });
  return res.json({ ok: true, deletedCount: await tenantDb("rpc/tenant_clear_history","POST",{ p_owner: owner(res) }) });
}));
tenantRouter.post("/jobs/:id/cancel", route(async (req, res) => {
  await tenantDb(`tenant_jobs?owner_id=${eq(owner(res))}&update_id=${eq(String(req.params.id))}&status=in.(pending,uncertain,failed)`, "PATCH", { status: "cancelled" });
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
  let stored=true;
  try { await tenantDb("tenant_messages","POST",{owner_id:id,connection_id:connection,chat_id:chat,direction:"outgoing",body:text,telegram_id:result.message_id}); } catch { stored=false; }
  return res.json({ok:true,sent:true,stored});
}));

export async function tenantWorker(req: Request, res: Response) {
  const expected = process.env.CRON_SECRET || "", provided = req.header("authorization") || "";
  const a = Buffer.from("Bearer " + expected), b = Buffer.from(provided);
  if (!multiUserEnabled() || expected.length < 32 || a.length !== b.length || !timingSafeEqual(a,b)) return res.status(401).json({error:"Unauthorized worker."});
  try {
    await tenantDb("rpc/tenant_retention", "POST", {});
    const jobs: TenantJob[] = [];
    for(let i=0;i<4;i++) {
      const batch=await tenantDb<TenantJob[]>("rpc/tenant_claim_job","POST",{});
      if(!batch.length) break;
      jobs.push(batch[0]);
    }
    await Promise.all(jobs.map(processTenantJob));
    return res.json({ok:true,processed:jobs.length});
  } catch { return res.status(503).json({error:"Worker storage unavailable."}); }
}
