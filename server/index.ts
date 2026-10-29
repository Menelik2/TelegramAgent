import "dotenv/config";
import express from "express";
import cors from "cors";
import { createHash, timingSafeEqual } from "node:crypto";
import { decideReply, safeText } from "./policy.js";
import { rateLimit } from "./rate-limit.js";
import { generateReply, isAiConfigured, AiQuotaError, getAiProviderLabel } from "./ai.js";
import { getFeatureConfig, isInQuietHours, pickReplyDelayMs, sleep, isSameLocalDay, featureStatusSummary } from "./features.js";
import { claimUpdate, getLastActivityAt, isPersistentStoreConfigured, listConversationMessages, listEvents, listInbox, recordEvent, recordMessage, releaseUpdate, getAiRuntimeSettings, saveAiRuntimeSettings } from "./store.js";
import { addMemory, deleteMemory, getAutomationEnabled, getEnabledMemories, getPreferences, isProfileStoreConfigured, listContacts, listMemories, savePreferences, setAutomationEnabled, setContact } from "./profile-store.js";

const app = express();
app.disable("x-powered-by");
if (process.env.VERCEL === "1") app.set("trust proxy", 1);
app.use(cors({ origin: (process.env.FRONTEND_URL || "http://localhost:5173").split(",").map(s => s.trim()), credentials: false }));
app.use(express.json({ limit: "256kb" }));
const port = Number(process.env.PORT || 8787);
const allowlist = new Set((process.env.TELEGRAM_ALLOWED_USER_IDS || "").split(",").map(s => s.trim()).filter(Boolean));
const ownerUserIds = new Set((process.env.TELEGRAM_OWNER_USER_IDS || "").split(",").map(s => s.trim()).filter(Boolean));
const businessOwnerByConnection = new Map<string, string>();
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
app.get("/api/status", async (_req, res) => {
  let enabled = false;
  let lastActivityAt: string | null = null;
  try { enabled = await getAutomationEnabled(); } catch { /* */ }
  try { lastActivityAt = await getLastActivityAt(); } catch { /* */ }
  const baseUrl = (process.env.APP_BASE_URL || (process.env.VERCEL_URL ? "https://" + process.env.VERCEL_URL : "")).replace(/\/$/, "");
  return res.json({
    ok: true,
    automationEnabled: enabled,
    telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_WEBHOOK_SECRET),
    aiConfigured: isAiConfigured(),
    aiProvider: isAiConfigured() ? (await getAiRuntimeSettings().then(v => v.model).catch(() => getAiProviderLabel())) : null,
    storageConfigured: isPersistentStoreConfigured(),
    features: featureStatusSummary(),
    mode: "explicit-allowlist",
    lastWebhookAt: lastWebhookAt || lastActivityAt,
    lastActivityAt,
    appBaseUrl: baseUrl || null,
    webhookPath: "/api/telegram/webhook",
    ownerIdsConfigured: ownerUserIds.size > 0
  });
});
app.use("/api/agent", requireDashboardAuth);
app.post("/api/agent/telegram/configure-webhook", async (_req, res) => {
  const token = process.env.TELEGRAM_BOT_TOKEN || "";
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET || "";
  const baseUrl = (process.env.APP_BASE_URL || (process.env.VERCEL_URL ? "https://" + process.env.VERCEL_URL : "")).replace(/\/$/, "");
  if (!token || !secret) return res.status(409).json({ ok: false, error: "Missing TELEGRAM_BOT_TOKEN or TELEGRAM_WEBHOOK_SECRET in Vercel Environment Variables. Add both to Production and redeploy." });
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(secret)) return res.status(409).json({ ok: false, error: "TELEGRAM_WEBHOOK_SECRET must be 1–256 characters and contain only letters, numbers, underscores, or hyphens." });
  if (!baseUrl || !baseUrl.startsWith("https://")) return res.status(409).json({ ok: false, error: "Set APP_BASE_URL to your public HTTPS origin (for example https://telegramagenets.vercel.app) in Vercel Environment Variables, then redeploy." });
  try {
    const webhookUrl = baseUrl + "/api/telegram/webhook";
    const telegramResponse = await fetch("https://api.telegram.org/bot" + token + "/setWebhook", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: webhookUrl, secret_token: secret, allowed_updates: ["business_connection", "business_message", "message", "edited_business_message", "edited_message"], drop_pending_updates: false })
    });
    const raw = await telegramResponse.text();
    let result: { ok?: boolean; description?: string; result?: boolean };
    try { result = JSON.parse(raw) as typeof result; }
    catch { return res.status(502).json({ ok: false, error: "Telegram returned a non-JSON response while configuring the webhook." }); }
    if (!telegramResponse.ok || !result.ok) return res.status(502).json({ ok: false, error: result.description || "Telegram rejected webhook configuration." });
    const infoResponse = await fetch("https://api.telegram.org/bot" + token + "/getWebhookInfo");
    const infoRaw = await infoResponse.text();
    let info: { ok?: boolean; result?: { url?: string; pending_update_count?: number; last_error_message?: string } } = {};
    try { info = JSON.parse(infoRaw) as typeof info; } catch { /* */ }
    await logEvent("webhook_configured", "Telegram webhook registered (business + private messages).", {});
    const warning = info.result?.last_error_message;
    return res.json({ ok: true, webhookUrl, pendingUpdates: info.result?.pending_update_count ?? 0, warning, message: warning ? "Webhook registered, but Telegram reports a delivery problem: " + warning : "Telegram webhook registered successfully. Next, allow a contact and enable automation." });
  } catch (error) {
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : "Could not reach Telegram." });
  }
});

app.get("/api/agent/telegram/webhook-info", async (_req, res) => {
  const token = process.env.TELEGRAM_BOT_TOKEN || "";
  if (!token) return res.status(409).json({ ok: false, error: "TELEGRAM_BOT_TOKEN is not configured." });
  try {
    const infoResponse = await fetch("https://api.telegram.org/bot" + token + "/getWebhookInfo");
    const info = await infoResponse.json() as { ok?: boolean; result?: Record<string, unknown>; description?: string };
    if (!infoResponse.ok || !info.ok) return res.status(502).json({ ok: false, error: info.description || "Could not read webhook info." });
    const baseUrl = (process.env.APP_BASE_URL || (process.env.VERCEL_URL ? "https://" + process.env.VERCEL_URL : "")).replace(/\/$/, "");
    return res.json({
      ok: true,
      expectedUrl: baseUrl ? baseUrl + "/api/telegram/webhook" : null,
      webhook: info.result || {},
      matchesExpected: Boolean(baseUrl && info.result && String(info.result.url || "") === baseUrl + "/api/telegram/webhook")
    });
  } catch (error) {
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : "Could not reach Telegram." });
  }
});

app.get("/api/agent/settings", async (_req, res) => {
  try {
    const enabled = await getAutomationEnabled();
    const savedContacts = isProfileStoreConfigured() ? await listContacts() : [];
    return res.json({
      automationEnabled: enabled, mode: "explicit-allowlist",
      allowedContactCount: savedContacts.length ? savedContacts.filter(contact => contact.enabled).length : allowlist.size,
      persistentStorage: isPersistentStoreConfigured()
    });
  } catch {
    return res.status(503).json({ ok: false, error: "Could not load persistent agent settings." });
  }
});
const AI_MODELS = {
  gemini: ["gemini-3.5-flash-lite"],
  openai: ["gpt-4o-mini", "gpt-4o"]
} as const;

type AiProvider = keyof typeof AI_MODELS;
function isAiProvider(value: unknown): value is AiProvider {
  return value === "gemini" || value === "openai";
}

app.get("/api/agent/ai-settings", async (_req, res) => {
  try {
    const settings = await getAiRuntimeSettings();
    return res.json({
      ok: true, settings,
      providers: [
        { id: "gemini", label: "Google Gemini", configured: Boolean(process.env.GEMINI_API_KEY?.trim()), models: AI_MODELS.gemini },
        { id: "openai", label: "OpenAI", configured: Boolean(process.env.OPENAI_API_KEY?.trim()), models: AI_MODELS.openai }
      ],
      persistent: isPersistentStoreConfigured()
    });
  } catch (error) {
    return res.status(503).json({ ok: false, error: error instanceof Error ? error.message : "Could not load AI settings." });
  }
});

app.put("/api/agent/ai-settings", async (req, res) => {
  const provider: unknown = req.body?.provider;
  const model: unknown = req.body?.model;
  const fallbackEnabled: unknown = req.body?.fallbackEnabled;
  if (!isAiProvider(provider)) return res.status(400).json({ ok: false, error: "Choose a supported provider." });
  if (typeof model !== "string" || !AI_MODELS[provider].includes(model as never)) return res.status(400).json({ ok: false, error: "Choose a supported model for the selected provider." });
  if (typeof fallbackEnabled !== "boolean") return res.status(400).json({ ok: false, error: "fallbackEnabled must be true or false." });
  if (provider === "gemini" && !process.env.GEMINI_API_KEY?.trim()) return res.status(409).json({ ok: false, error: "Add GEMINI_API_KEY to server environment variables first." });
  if (provider === "openai" && !process.env.OPENAI_API_KEY?.trim()) return res.status(409).json({ ok: false, error: "Add OPENAI_API_KEY to server environment variables first." });
  try {
    const settings = await saveAiRuntimeSettings({ provider, model, fallbackEnabled });
    await logEvent("ai_settings_updated", "AI provider/model settings updated from the dashboard.");
    return res.json({ ok: true, settings });
  } catch (error) {
    return res.status(503).json({ ok: false, error: error instanceof Error ? error.message : "Could not save AI settings." });
  }
});

app.post("/api/agent/ai-settings/test", rateLimit({ name: "ai-model-test", limit: 5, windowMs: 60_000 }), async (req, res) => {
  const provider: unknown = req.body?.provider;
  const model: unknown = req.body?.model;
  if (!isAiProvider(provider)) return res.status(400).json({ ok: false, error: "Choose a supported provider." });
  if (typeof model !== "string" || !AI_MODELS[provider].includes(model as never)) return res.status(400).json({ ok: false, error: "Choose a supported model." });
  if (provider === "gemini" && !process.env.GEMINI_API_KEY?.trim()) return res.status(409).json({ ok: false, error: "GEMINI_API_KEY is not configured on the server." });
  if (provider === "openai" && !process.env.OPENAI_API_KEY?.trim()) return res.status(409).json({ ok: false, error: "OPENAI_API_KEY is not configured on the server." });
  try {
    const { generateReply } = await import("./ai.js");
    const reply = await generateReply(
      { incomingText: "Reply with exactly: Connection successful." },
      { provider, model, fallbackEnabled: false }
    );
    return res.json({ ok: true, tested: true, provider, model, sample: reply.slice(0, 100) });
  } catch (error) {
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : "Model connection test failed." });
  }
});

app.get("/api/agent/contacts", async (_req, res) => {
  try {
    if (!isProfileStoreConfigured()) return res.status(503).json({ ok: false, error: "Configure Supabase first." });
    return res.json({ ok: true, contacts: await listContacts() });
  } catch { return res.status(503).json({ ok: false, error: "Could not load contact permissions." }); }
});
app.put("/api/agent/contacts/:senderId", async (req, res) => {
  const senderId = String(req.params.senderId || "");
  if (!/^\d{1,22}$/.test(senderId)) return res.status(400).json({ ok: false, error: "Use the numeric Telegram sender ID." });
  if (typeof req.body?.enabled !== "boolean") return res.status(400).json({ ok: false, error: "enabled must be true or false." });
  try {
    await setContact({ senderId, enabled: req.body.enabled, note: safeText(req.body?.note, 200) });
    if (req.body.enabled) allowlist.add(senderId); else allowlist.delete(senderId);
    await logEvent("contact_permission_changed", req.body.enabled ? "Contact explicitly allowed." : "Contact set to manual-only.", { senderId });
    return res.json({ ok: true, senderId, enabled: req.body.enabled });
  } catch (error) { return res.status(503).json({ ok: false, error: error instanceof Error ? error.message : "Could not save contact permission." }); }
});
app.get("/api/agent/memories", async (_req, res) => {
  try { return res.json({ ok: true, persistent: isProfileStoreConfigured(), memories: await listMemories() }); }
  catch { return res.status(503).json({ ok: false, error: "Could not load AI memories." }); }
});
app.post("/api/agent/memories", async (req, res) => {
  const memory = safeText(req.body?.memory, 1000);
  const category = safeText(req.body?.category || "preference", 64);
  if (memory.length < 2) return res.status(400).json({ ok: false, error: "Enter a memory of at least 2 characters." });
  try { await addMemory(memory, category); await logEvent("memory_added", "Owner added an AI memory."); return res.json({ ok: true }); }
  catch (error) { return res.status(503).json({ ok: false, error: error instanceof Error ? error.message : "Could not save memory." }); }
});
app.delete("/api/agent/memories/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ ok: false, error: "Invalid memory ID." });
  try { await deleteMemory(id); await logEvent("memory_deleted", "Owner deleted an AI memory."); return res.json({ ok: true }); }
  catch (error) { return res.status(503).json({ ok: false, error: error instanceof Error ? error.message : "Could not delete memory." }); }
});
app.get("/api/agent/preferences", async (_req, res) => {
  try { return res.json({ ok: true, preferences: await getPreferences(), persistent: isProfileStoreConfigured() }); }
  catch { return res.status(503).json({ ok: false, error: "Could not load preferences." }); }
});
app.put("/api/agent/preferences", async (req, res) => {
  const p = req.body || {};
  if (typeof p.tone !== "string" || typeof p.language !== "string" || typeof p.replyLength !== "string" || typeof p.memoryEnabled !== "boolean") return res.status(400).json({ ok: false, error: "Invalid preferences payload." });
  try { await savePreferences({ tone: safeText(p.tone, 100), language: safeText(p.language, 100), replyLength: safeText(p.replyLength, 40), memoryEnabled: p.memoryEnabled }); return res.json({ ok: true }); }
  catch (error) { return res.status(503).json({ ok: false, error: error instanceof Error ? error.message : "Could not save preferences." }); }
});
app.get("/api/inbox", requireDashboardAuth, async (_req, res) => {
  try { return res.json({ ok: true, persistent: isPersistentStoreConfigured(), conversations: await listInbox() }); }
  catch (error) { return res.status(503).json({ ok: false, error: error instanceof Error ? error.message : "Live inbox unavailable." }); }
});
app.get("/api/inbox/:chatId/messages", requireDashboardAuth, async (req, res) => {
  const chatId = String(req.params.chatId || "");
  if (!/^-?[0-9]{1,22}$/.test(chatId)) return res.status(400).json({ ok: false, error: "Invalid Telegram chat ID." });
  try { return res.json({ ok: true, messages: await listConversationMessages(chatId) }); }
  catch (error) { return res.status(503).json({ ok: false, error: error instanceof Error ? error.message : "Conversation history unavailable." }); }
});
app.post("/api/inbox/:chatId/reply", rateLimit({ name: "manual-reply", limit: 30, windowMs: 60_000 }), requireDashboardAuth, async (req, res) => {
  const chatId = String(req.params.chatId || "");
  const text = safeText(req.body?.text, 4096);
  if (!/^-?[0-9]{1,22}$/.test(chatId)) return res.status(400).json({ ok: false, error: "Invalid Telegram chat ID." });
  if (!text) return res.status(400).json({ ok: false, error: "Enter a reply." });
  if (!process.env.TELEGRAM_BOT_TOKEN) return res.status(503).json({ ok: false, error: "Telegram bot token is not configured." });
  try {
    const conversation = (await listInbox()).find(item => item.chatId === chatId);
    if (!conversation) return res.status(404).json({ ok: false, error: "Conversation not found in the live inbox." });
    const manualPayload: Record<string, unknown> = { chat_id: chatId, text };
    if (conversation.businessConnectionId && conversation.businessConnectionId !== "direct") {
      manualPayload.business_connection_id = conversation.businessConnectionId;
    }
    const apiResponse = await fetch("https://api.telegram.org/bot" + process.env.TELEGRAM_BOT_TOKEN + "/sendMessage", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(manualPayload) });
    const body = await apiResponse.json() as { ok?: boolean; description?: string; result?: { message_id?: number; date?: number } };
    if (!apiResponse.ok || !body.ok) return res.status(502).json({ ok: false, error: body.description || "Telegram delivery failed." });
    try {
      await recordMessage({ businessConnectionId: conversation.businessConnectionId, chatId, senderId: conversation.senderId, senderName: conversation.senderName, username: conversation.username, direction: "outgoing", text, telegramMessageId: body.result?.message_id, createdAt: body.result?.date ? new Date(body.result.date * 1000).toISOString() : undefined });
    } catch { await logEvent("inbox_write_failed", "Manual reply was sent, but its inbox copy could not be saved.", { chatId, senderId: conversation.senderId }); }
    await logEvent("manual_reply_sent", "Owner sent a manual Telegram reply.", { chatId, senderId: conversation.senderId });
    return res.json({ ok: true, sent: true });
  } catch (error) { return res.status(503).json({ ok: false, error: error instanceof Error ? error.message : "Could not send reply." }); }
});
app.get("/api/activity", requireDashboardAuth, async (req, res) => {
  try {
    const limit = Number(req.query.limit || 30);
    return res.json({ ok: true, persistent: isPersistentStoreConfigured(), events: await listEvents(limit) });
  } catch {
    return res.status(503).json({ ok: false, error: "Activity storage is unavailable." });
  }
});
app.post("/api/agent/pause", async (_req, res) => {
  try {
    await setAutomationEnabled(false);
    automationEnabled = false;
    return res.json({ ok: true, automationEnabled: false });
  } catch {
    return res.status(503).json({ ok: false, error: "Could not persist pause state." });
  }
});
app.post("/api/agent/resume", async (_req, res) => {
  if (process.env.VERCEL && (!isPersistentStoreConfigured() || !isProfileStoreConfigured())) {
    return res.status(409).json({ ok: false, error: "Vercel automation requires Supabase persistence." });
  }
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_WEBHOOK_SECRET || !isAiConfigured()) {
    return res.status(409).json({ ok: false, error: "Configure Telegram and AI credentials before enabling automation." });
  }
  let hasAllowedContacts = allowlist.size > 0;
  if (!hasAllowedContacts && isProfileStoreConfigured()) {
    try { hasAllowedContacts = (await listContacts()).some(contact => contact.enabled); }
    catch { return res.status(503).json({ ok: false, error: "Could not verify contact permissions." }); }
  }
  if (!hasAllowedContacts) return res.status(409).json({ ok: false, error: "Allow at least one contact in Inbox before enabling replies." });
  try {
    await setAutomationEnabled(true);
    automationEnabled = true;
    return res.json({ ok: true, automationEnabled: true });
  } catch {
    return res.status(503).json({ ok: false, error: "Could not persist automation state." });
  }
});
app.post("/api/agent/emergency-stop", async (_req, res) => {
  try {
    await setAutomationEnabled(false);
    automationEnabled = false;
    return res.json({ ok: true, automationEnabled: false, message: "New automatic replies are disabled." });
  } catch {
    return res.status(503).json({ ok: false, error: "Could not persist emergency-stop state." });
  }
});
app.post("/api/agent/simulate", rateLimit({ name: "simulate", limit: 20, windowMs: 60_000 }), async (req, res) => {
  try {
    const incomingText = safeText(req.body?.text, 3000);
    if (!incomingText) return res.status(400).json({ ok: false, error: "Enter a message to simulate." });
    const decision = decideReply({ enabled: true, allowedContact: true, text: incomingText, duplicate: false });
    if (!decision.allowed) return res.json({ ok: true, escalated: true, reason: decision.reason });
    const reply = await generateReply({ incomingText, recentContext: safeText(req.body?.context, 8000), tone: safeText(req.body?.tone, 80), language: safeText(req.body?.language, 80) });
    return res.json({ ok: true, reply, sent: false, mode: "simulation" });
  } catch (error) {
    return res.status(503).json({ ok: false, error: error instanceof Error ? error.message : "AI provider unavailable." });
  }
});

app.get("/api/telegram/webhook", (_req, res) => {
  const baseUrl = (process.env.APP_BASE_URL || (process.env.VERCEL_URL ? "https://" + process.env.VERCEL_URL : "")).replace(/\/$/, "");
  return res.status(200).json({
    ok: true,
    message: "Telegram webhook endpoint is online. Telegram must call this URL with POST (browsers use GET, which only shows this status).",
    method: "POST",
    path: "/api/telegram/webhook",
    expectedUrl: baseUrl ? baseUrl + "/api/telegram/webhook" : null,
    telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_WEBHOOK_SECRET),
    aiConfigured: isAiConfigured(),
    aiProvider: isAiConfigured() ? getAiProviderLabel() : null,
    storageConfigured: isPersistentStoreConfigured(),
    features: featureStatusSummary(),
    time: new Date().toISOString()
  });
});
app.post("/api/telegram/webhook", rateLimit({ name: "telegram-webhook", limit: 120, windowMs: 60_000 }), async (req, res) => {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET || "";
  const provided = req.header("x-telegram-bot-api-secret-token") || "";
  if (!expected || !provided || !constantTimeEqual(provided, expected)) return res.status(401).json({ ok: false, error: "Invalid webhook secret." });
  if (process.env.VERCEL && !isPersistentStoreConfigured()) return res.status(503).json({ ok: false, error: "Supabase persistence is required for reliable Vercel webhook processing." });
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
    const connId = String(connection.id || "");
    const ownerId = String(connection.user?.id || connection.user_id || "");
    if (connId && ownerId) {
      businessOwnerByConnection.set(connId, ownerId);
      ownerUserIds.add(ownerId);
    }
    await logEvent("business_connection", connection.is_enabled ? "Business connection enabled." : "Business connection disabled.", { updateId, senderId: ownerId || undefined });
    return res.json({ ok: true, connectionReceived: true, enabled: Boolean(connection.is_enabled) });
  }
  // Telegram may deliver normal bot chats and Telegram Business chats through different update fields.
  // Keep the update type in logs so unsupported payloads can be diagnosed instead of appearing as silent failures.
  const businessMessage = update.business_message;
  const directMessage = update.message;
  const editedBusinessMessage = update.edited_business_message;
  const editedDirectMessage = update.edited_message;
  let message: any = null;
  let businessConnectionId = "";
  let mode: "business" | "direct" = "business";
  if (businessMessage && !businessMessage.from?.is_bot && businessMessage.business_connection_id) {
    message = businessMessage;
    businessConnectionId = String(businessMessage.business_connection_id);
    mode = "business";
  } else if (editedBusinessMessage && !editedBusinessMessage.from?.is_bot && editedBusinessMessage.business_connection_id) {
    // Edited messages are eligible only when their update has not already been processed.
    message = editedBusinessMessage;
    businessConnectionId = String(editedBusinessMessage.business_connection_id);
    mode = "business";
  } else if (directMessage && !directMessage.from?.is_bot && directMessage.chat?.type === "private" && !directMessage.via_bot) {
    message = directMessage;
    businessConnectionId = "direct";
    mode = "direct";
  } else if (editedDirectMessage && !editedDirectMessage.from?.is_bot && editedDirectMessage.chat?.type === "private" && !editedDirectMessage.via_bot) {
    message = editedDirectMessage;
    businessConnectionId = "direct";
    mode = "direct";
  } else {
    const updateType = Object.keys(update).filter(key => key !== "update_id").join(", ") || "unknown";
    await logEvent("ignored", "Unsupported Telegram update ignored (type: " + updateType + ").", { updateId });
    return res.json({ ok: true, ignored: true, updateType });
  }
  const senderId = String(message.from?.id ?? "");
  const chatId = String(message.chat?.id ?? "");
  // Text and captions can be replied to directly. For common media-only messages, provide a short
  // contextual prompt instead of silently dropping the conversation; never send raw media metadata to the model.
  const messageText = typeof message.text === "string" ? message.text : typeof message.caption === "string" ? message.caption : "";
  const mediaFallback = message.photo ? "[The contact sent a photo without a caption. Acknowledge it and ask what they would like to know.]" : message.video ? "[The contact sent a video without a caption. Acknowledge it and ask what they would like to know.]" : message.voice || message.audio ? "[The contact sent a voice/audio message. Politely ask them to provide the message as text if you cannot understand it.]" : message.sticker ? "[The contact sent a sticker. Reply briefly and naturally to acknowledge it.]" : message.document ? "[The contact sent a document without a caption. Ask what they would like help with.]" : message.animation ? "[The contact sent a GIF. Acknowledge it naturally.]" : "";
  const text = safeText(messageText || mediaFallback);
  if (!senderId || !chatId || !text) {
    await logEvent("ignored", "Message has no supported text or common media payload.", { updateId, senderId, chatId });
    return res.json({ ok: true, ignored: true, reason: "Unsupported message type." });
  }
  const connectionOwnerId = mode === "business" ? businessOwnerByConnection.get(businessConnectionId) : undefined;
  const isOwnMessage =
    ownerUserIds.has(senderId) ||
    (connectionOwnerId !== undefined && connectionOwnerId === senderId) ||
    Boolean(message.outgoing) ||
    Boolean(message.sender_business_bot);
  if (isOwnMessage) {
    if (isPersistentStoreConfigured()) {
      try {
        await recordMessage({
          updateId, telegramMessageId: Number(message.message_id) || undefined,
          businessConnectionId, chatId, senderId,
          senderName: [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ") || String(message.from?.username || senderId),
          username: String(message.from?.username || ""), direction: "outgoing", text,
          createdAt: message.date ? new Date(Number(message.date) * 1000).toISOString() : undefined
        });
      } catch { /* best-effort */ }
    }
    await logEvent("ignored", "Own message ignored — no auto-reply to the owner's text.", { updateId, senderId, chatId });
    return res.json({ ok: true, ignored: true, reason: "Own message" });
  }
  let contactAllowed = allowlist.has(senderId);
  if (isProfileStoreConfigured()) {
    try {
      const contact = (await listContacts()).find(item => item.senderId === senderId);
      // A saved contact preference is authoritative. If storage cannot be read,
      // only the explicit environment allowlist remains eligible; never open access.
      contactAllowed = contact ? contact.enabled : allowlist.has(senderId);
    } catch (error) {
      console.error("contact_permissions_read_failed", error instanceof Error ? error.message : "unknown");
      contactAllowed = allowlist.has(senderId);
      await logEvent("contact_permissions_unavailable", "Could not read saved contact permissions; checked explicit environment allowlist only.", { updateId, senderId, chatId });
    }
  }
  if (isPersistentStoreConfigured()) {
    try {
      await recordMessage({
        updateId, telegramMessageId: Number(message.message_id) || undefined,
        businessConnectionId, chatId, senderId,
        senderName: [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ") || String(message.from?.username || senderId),
        username: String(message.from?.username || ""), direction: "incoming", text,
        createdAt: message.date ? new Date(Number(message.date) * 1000).toISOString() : undefined
      });
    } catch (error) {
      await releaseUpdate(updateId).catch(() => undefined);
      return res.status(503).json({ ok: false, error: "Could not persist incoming message." });
    }
  }
  let enabledForThisUpdate = false;
  try { enabledForThisUpdate = await getAutomationEnabled(); }
  catch {
    await releaseUpdate(updateId).catch(() => undefined);
    return res.status(503).json({ ok: false, error: "Could not load automation state." });
  }
  const decision = decideReply({ enabled: enabledForThisUpdate, allowedContact: contactAllowed, text, duplicate: false });
  if (!decision.allowed) {
    await logEvent("blocked", decision.reason, { updateId, senderId, chatId });
    return res.json({ ok: true, ignored: true, reason: decision.reason });
  }
  const features = getFeatureConfig();
  if (isInQuietHours(features)) {
    await logEvent("quiet_hours", "Skipped auto-reply during quiet hours.", { updateId, senderId, chatId });
    return res.json({ ok: true, ignored: true, reason: "Quiet hours" });
  }
  if (features.dailyReplyLimit > 0 && isPersistentStoreConfigured()) {
    try {
      const events = await listEvents(200);
      const sentToday = events.filter(e => e.kind === "reply_sent" && isSameLocalDay(e.createdAt, features.quietTimezone)).length;
      if (sentToday >= features.dailyReplyLimit) {
        await logEvent("daily_limit", "Daily auto-reply limit reached (" + features.dailyReplyLimit + ").", { updateId, senderId, chatId });
        return res.json({ ok: true, ignored: true, reason: "Daily reply limit reached" });
      }
    } catch { /* best-effort */ }
  }
  if (!process.env.TELEGRAM_BOT_TOKEN) { await releaseUpdate(updateId).catch(() => undefined); return res.status(503).json({ ok: false, error: "Telegram bot token is not configured." }); }
  try {
    // Personalization is optional: a missing preferences/memory table must not
    // prevent an otherwise eligible contact from receiving an auto-reply.
    const defaultPreferences = { tone: "warm, clear, human — professional when needed, friendly when the chat is friendly", language: "strictly match the sender's language", replyLength: "concise but complete", memoryEnabled: false };
    let preferences = defaultPreferences;
    try { preferences = await getPreferences(); }
    catch (error) { await logEvent("preferences_read_failed", error instanceof Error ? error.message : "Could not load preferences.", { updateId, senderId, chatId }); }
    let memories: string[] = [];
    if (preferences.memoryEnabled) {
      try { memories = await getEnabledMemories(); }
      catch (error) { await logEvent("memory_read_failed", error instanceof Error ? error.message : "Could not load memories; continuing without them.", { updateId, senderId, chatId }); }
    }
    let recentMessages: string[] = [];
    if (isPersistentStoreConfigured()) {
      try {
        const history = await listConversationMessages(chatId);
        const window = history.slice(-40);
        recentMessages = window.map(item => {
          const who = item.direction === "incoming" ? "Them" : "Me";
          return who + ": " + item.text.slice(0, 900);
        });
      } catch { /* */ }
    }
    const contextParts = [
      recentMessages.length
        ? "Full recent conversation (oldest → newest). Stay consistent with names, plans, and tone already used:\n" + recentMessages.join("\n")
        : "",
      memories.length ? "Owner notes to respect when relevant:\n" + memories.join("\n") : ""
    ].filter(Boolean);
    try {
      const typingPayload: Record<string, unknown> = { chat_id: chatId, action: "typing" };
      if (mode === "business" && businessConnectionId && businessConnectionId !== "direct") {
        typingPayload.business_connection_id = businessConnectionId;
      }
      await fetch("https://api.telegram.org/bot" + process.env.TELEGRAM_BOT_TOKEN + "/sendChatAction", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(typingPayload)
      });
    } catch { /* ignore */ }
    const delayMs = pickReplyDelayMs(features);
    if (delayMs > 0) await sleep(delayMs);
    const reply = await generateReply({
      incomingText: text,
      tone: preferences.tone,
      language: preferences.language,
      recentContext: contextParts.join("\n\n") || undefined,
      replyLength: preferences.replyLength
    });
    if (reply === "[ESCALATE]") {
      await logEvent("owner_review_required", "AI marked this message for owner review.", { updateId, senderId, chatId });
      return res.json({ ok: true, escalated: true, sent: false });
    }
    const sendPayload: Record<string, unknown> = { chat_id: chatId, text: reply };
    if (mode === "business" && businessConnectionId && businessConnectionId !== "direct") {
      sendPayload.business_connection_id = businessConnectionId;
    }
    const apiResponse = await fetch("https://api.telegram.org/bot" + process.env.TELEGRAM_BOT_TOKEN + "/sendMessage", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sendPayload)
    });
    const body = await apiResponse.json() as { ok?: boolean; description?: string };
    if (!apiResponse.ok || !body.ok) {
      await logEvent("delivery_failed", body.description || "Telegram delivery failed.", { updateId, senderId, chatId });
      await releaseUpdate(updateId).catch(() => undefined);
      return res.status(502).json({ ok: false, error: body.description || "Telegram delivery failed.", detail: body.description || "Unknown error." });
    }
    if (isPersistentStoreConfigured()) {
      try {
        await recordMessage({
          updateId, businessConnectionId, chatId, senderId,
          senderName: [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ") || String(message.from?.username || senderId),
          username: String(message.from?.username || ""), direction: "outgoing", text: reply
        });
      } catch { await logEvent("inbox_write_failed", "Reply was sent, but inbox copy could not be saved.", { updateId, senderId, chatId }); }
    }
    await logEvent("reply_sent", "Automatic reply delivered.", { updateId, senderId, chatId });
    return res.json({ ok: true, sent: true, mode });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "Reply processing failed.";
    await logEvent("reply_failed", messageText, { updateId, senderId, chatId });
    if (error instanceof AiQuotaError) {
      // Release the claimed update so Telegram can retry after quota/billing is fixed.
      // Otherwise a retry would be treated as a duplicate and the contact never replied.
      await releaseUpdate(updateId).catch(() => undefined);
      return res.status(429).json({ ok: false, error: messageText, quotaExceeded: true });
    }
    await releaseUpdate(updateId).catch(() => undefined);
    return res.status(503).json({ ok: false, error: messageText });
  }
});
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const id = createHash("sha256").update(String(Date.now())).digest("hex").slice(0, 10);
  console.error("request_error", { id, message: err instanceof Error ? err.message : "unknown" });
  res.status(500).json({ ok: false, error: "Internal server error.", requestId: id });
});
export default app;

if (process.env.VERCEL !== "1") {
  app.listen(port, () => console.log("TelegramAgent API listening on port " + port));
}
