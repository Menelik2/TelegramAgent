import "dotenv/config";
import express from "express";
import cors from "cors";
import { createHash, timingSafeEqual } from "node:crypto";
import { decideReply, safeText } from "./policy.js";
import { generateReply, isAiConfigured } from "./ai.js";
import { claimUpdate, isPersistentStoreConfigured, listEvents, recordEvent } from "./store.js";

const app = express();
app.disable("x-powered-by");
app.use(cors({ origin: (process.env.FRONTEND_URL || "http://localhost:5173").split(",").map(s => s.trim()), credentials: false }));
app.use(express.json({ limit: "256kb" }));
const port = Number(process.env.PORT || 8787);
const allowlist = new Set((process.env.TELEGRAM_ALLOWED_USER_IDS || "").split(",").map(s => s.trim()).filter(Boolean));
let automationEnabled = false;
let lastWebhookAt: string | null = null;

function constantTimeEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a); const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
function requireDashboardAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const expected = process.env.DASHBOARD_API_TOKEN || "";
  const provided = req.header("x-dashboard-token") || "";
  if (!expected) return res.status(503).json({ ok: false, error: "Dashboard API is locked until DASHBOARD_API_TOKEN is configured." });
  if (!provided || !constantTimeEqual(provided, expected)) return res.status(401).json({ ok: false, error: "Dashboard authorization failed." });
  next();
}
async function logEvent(kind: string, detail: string, values: { updateId?: string; senderId?: string; chatId?: string } = {}) {
  try { await recordEvent({ kind, detail, ...values }); }
  catch (error) { console.error("activity_write_failed", error instanceof Error ? error.message : "unknown"); }
}

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "telegram-agent-api", time: new Date().toISOString() }));
app.get("/api/status", (_req, res) => res.json({
  ok: true, automationEnabled, telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_WEBHOOK_SECRET),
  aiConfigured: isAiConfigured(), storageConfigured: isPersistentStoreConfigured(), mode: "explicit-allowlist", lastWebhookAt
}));
app.use("/api/agent", requireDashboardAuth);
app.get("/api/agent/settings", (_req, res) => res.json({
  automationEnabled, mode: "explicit-allowlist", allowedContactCount: allowlist.size,
  persistentStorage: isPersistentStoreConfigured()
}));
app.get("/api/activity", requireDashboardAuth, async (req, res) => {
  try {
    const limit = Number(req.query.limit || 30);
    return res.json({ ok: true, persistent: isPersistentStoreConfigured(), events: await listEvents(limit) });
  } catch {
    return res.status(503).json({ ok: false, error: "Activity storage is unavailable." });
  }
});
app.post("/api/agent/pause", (_req, res) => { automationEnabled = false; res.json({ ok: true, automationEnabled }); });
app.post("/api/agent/resume", (_req, res) => {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_WEBHOOK_SECRET || !isAiConfigured()) {
    return res.status(409).json({ ok: false, error: "Configure Telegram and AI credentials before enabling automation." });
  }
  if (allowlist.size === 0) return res.status(409).json({ ok: false, error: "Add TELEGRAM_ALLOWED_USER_IDS explicitly before enabling replies." });
  automationEnabled = true; return res.json({ ok: true, automationEnabled });
});
app.post("/api/agent/emergency-stop", (_req, res) => { automationEnabled = false; res.json({ ok: true, automationEnabled: false, message: "New automatic replies are disabled." }); });
app.post("/api/agent/simulate", async (req, res) => {
  try {
    const incomingText = safeText(req.body?.text, 3000);
    if (!incomingText) return res.status(400).json({ ok: false, error: "Enter a message to simulate." });
    const decision = decideReply({ enabled: true, allowedContact: true, text: incomingText, duplicate: false });
    if (!decision.allowed) return res.json({ ok: true, escalated: true, reason: decision.reason });
    const reply = await generateReply({ incomingText, recentContext: safeText(req.body?.context, 2500), tone: safeText(req.body?.tone, 80), language: safeText(req.body?.language, 80) });
    return res.json({ ok: true, reply, sent: false, mode: "simulation" });
  } catch (error) {
    return res.status(503).json({ ok: false, error: error instanceof Error ? error.message : "AI provider unavailable." });
  }
});

app.post("/api/telegram/webhook", async (req, res) => {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET || "";
  const provided = req.header("x-telegram-bot-api-secret-token") || "";
  if (!expected || !provided || !constantTimeEqual(provided, expected)) return res.status(401).json({ ok: false, error: "Invalid webhook secret." });
  const update = req.body as Record<string, any>;
  const updateId = String(update?.update_id ?? "");
  if (!updateId) return res.status(400).json({ ok: false, error: "Missing update_id." });
  try {
    const claimed = await claimUpdate(updateId);
    if (!claimed) return res.json({ ok: true, duplicate: true });
  } catch (error) {
    console.error("update_claim_failed", error instanceof Error ? error.message : "unknown");
    return res.status(503).json({ ok: false, error: "Update storage is temporarily unavailable; Telegram may retry." });
  }
  lastWebhookAt = new Date().toISOString();
  const connection = update.business_connection;
  if (connection) {
    await logEvent("business_connection", connection.is_enabled ? "Business connection enabled." : "Business connection disabled.", { updateId });
    return res.json({ ok: true, connectionReceived: true, enabled: Boolean(connection.is_enabled) });
  }
  const message = update.business_message;
  if (!message || message.from?.is_bot || !message.business_connection_id) {
    await logEvent("ignored", "Unsupported update or non-business message ignored.", { updateId });
    return res.json({ ok: true, ignored: true });
  }
  const senderId = String(message.from?.id ?? "");
  const chatId = String(message.chat?.id ?? "");
  const text = safeText(message.text ?? message.caption ?? "");
  if (!text || !senderId || !chatId) {
    await logEvent("ignored", "Empty or unsupported message ignored.", { updateId, senderId, chatId });
    return res.json({ ok: true, ignored: true, reason: "Unsupported message type." });
  }
  const decision = decideReply({ enabled: automationEnabled, allowedContact: allowlist.has(senderId), text, duplicate: false });
  if (!decision.allowed) {
    await logEvent("blocked", decision.reason, { updateId, senderId, chatId });
    return res.json({ ok: true, ignored: true, reason: decision.reason });
  }
  if (!process.env.TELEGRAM_BOT_TOKEN) return res.status(503).json({ ok: false, error: "Telegram bot token is not configured." });
  try {
    const reply = await generateReply({ incomingText: text });
    const apiResponse = await fetch("https://api.telegram.org/bot" + process.env.TELEGRAM_BOT_TOKEN + "/sendMessage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ business_connection_id: message.business_connection_id, chat_id: chatId, text: reply })
    });
    const body = await apiResponse.json() as { ok?: boolean; description?: string };
    if (!apiResponse.ok || !body.ok) {
      await logEvent("delivery_failed", body.description || "Telegram delivery failed.", { updateId, senderId, chatId });
      return res.status(502).json({ ok: false, error: "Telegram delivery failed.", detail: body.description || "Unknown Telegram API error." });
    }
    await logEvent("reply_sent", "Automatic reply delivered.", { updateId, senderId, chatId });
    return res.json({ ok: true, sent: true });
  } catch (error) {
    await logEvent("reply_failed", error instanceof Error ? error.message : "Reply processing failed.", { updateId, senderId, chatId });
    return res.status(503).json({ ok: false, error: error instanceof Error ? error.message : "Reply processing failed." });
  }
});
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const id = createHash("sha256").update(String(Date.now())).digest("hex").slice(0, 10);
  console.error("request_error", { id, message: err instanceof Error ? err.message : "unknown" });
  res.status(500).json({ ok: false, error: "Internal server error.", requestId: id });
});
app.listen(port, () => console.log("TelegramAgent API listening on port " + port));
