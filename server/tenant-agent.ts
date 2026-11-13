import { checkOperationDeadline, operationSignal, withoutOperationDeadline } from "./operation-deadline.js";
import { tenantCredential, tenantCredentialStatus } from "./tenant-credentials.js";
import { tenantWorkerMode } from "./tenant-worker-config.js";
import { generateReply, isAiConfigured } from "./ai.js";
import { decideReply, safeText } from "./policy.js";
import { tenantDashboardUrl } from "./tenant-dashboard.js";
import { tenantAccount, tenantDailyReplyLimit, tenantDb, tenantFinish, tenantAiHistory, eq, type TenantAccount, type TenantConnection, type TenantJob, type TenantMessage } from "./tenant-store.js";

export const multiUserEnabled = () => process.env.MULTI_USER_ENABLED === "true";
type BusinessConnection = { id: string; user: { id: number }; is_enabled: boolean; rights?: { can_reply?: boolean } };
class TelegramOperationError extends Error {}
export class TenantActivationError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
export async function telegramCall<T>(method: string, payload: unknown): Promise<T> {
  checkOperationDeadline();
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new TelegramOperationError("Telegram is not configured.");
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST", signal: operationSignal(15000), headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
    });
    const body = await response.json() as { ok?: boolean; result: T };
    if (!response.ok || !body.ok) throw new Error("Rejected");
    return body.result;
  } catch { throw new TelegramOperationError("Telegram rejected the operation or is unavailable."); }
}
async function syncConnection(id: string): Promise<BusinessConnection> {
  const connection = await telegramCall<BusinessConnection>("getBusinessConnection", { business_connection_id: id });
  if (connection?.id !== id || !Number.isSafeInteger(connection.user?.id) || connection.user.id < 1) throw new TelegramOperationError("Invalid Business connection.");
  await tenantDb("rpc/tenant_connect", "POST", { p_owner: String(connection.user.id), p_connection: id, p_enabled: connection.is_enabled === true, p_reply: connection.rights?.can_reply === true });
  return connection;
}
export async function verifyTenantConnection(owner: string, id: string): Promise<boolean> {
  const stored = await tenantDb<TenantConnection[]>(`tenant_connections?owner_id=${eq(owner)}&id=${eq(id)}`);
  if (!stored[0]) return false;
  const live = await syncConnection(id);
  return String(live.user.id) === owner && live.is_enabled === true && live.rights?.can_reply === true;
}

/** Both the Mini App and Telegram controls use the same consent and activation rules. */
export async function saveTenantSettings(owner: string, input: { enabled?: boolean; consent?: boolean; tone?: string; language?: string }) {
  const current = await tenantAccount(owner);
  const patch: Partial<TenantAccount> = {};
  if (input.tone !== undefined) patch.tone = input.tone;
  if (input.language !== undefined) patch.language = input.language;
  if (input.enabled === true) {
    if (!current.consent_at && input.consent !== true) throw new TenantActivationError(400, "consent_required", "Agree to AI processing before enabling automatic replies.");
    const connections = await tenantDb<TenantConnection[]>("tenant_connections?owner_id=" + eq(owner));
    if (!connections.length) throw new TenantActivationError(409, "connection_required", "Connect this bot in Telegram’s Business/Secretary settings, select your chats and allow replies. Then try enabling again.");
    if (!isAiConfigured() && !(await tenantCredentialStatus(owner)).configured) throw new TenantActivationError(503, "ai_not_configured", "Add your own Gemini API key in your dashboard, or ask the operator to configure the shared AI provider.");
    const workerMode = tenantWorkerMode();
    if (workerMode === "invalid") throw new TenantActivationError(503, "worker_mode_invalid", "The reply processing mode is invalid. Ask the operator to select webhook or external mode.");
    if (workerMode === "external" && (process.env.CRON_SECRET || "").length < 32) throw new TenantActivationError(503, "worker_not_configured", "External reply processing requires a configured worker and CRON_SECRET. Use webhook mode for automatic processing without a separate worker.");
    let authorized = false, unavailable = false;
    for (const connection of connections) {
      try {
        if (await verifyTenantConnection(owner, connection.id)) { authorized = true; break; }
      } catch (error) {
        // A removed/expired connection must not hide another valid connection.
        // Storage errors still fail closed, rather than being treated as revoked rights.
        if (!(error instanceof TelegramOperationError)) throw error;
        unavailable = true;
      }
    }
    if (!authorized) {
      if (unavailable) throw new TenantActivationError(503, "connection_check_failed", "Telegram could not verify an eligible connection. Check your bot connection and reply permission, then try again.");
      throw new TenantActivationError(403, "reply_permission_required", "Telegram reply permission is disabled or revoked. Reconnect this bot or allow replies in Telegram, then try again.");
    }
    // Do not revive replies left behind by an interrupted pause.
    if (!current.enabled) await tenantDb(`tenant_jobs?owner_id=${eq(owner)}&status=in.(pending,processing)`, "PATCH", { status: "cancelled" });
    if (!current.consent_at) patch.consent_at = new Date().toISOString();
  }
  if (input.enabled !== undefined) patch.enabled = input.enabled;
  const accounts = await tenantDb<TenantAccount[]>("tenant_accounts?owner_id=" + eq(owner), "PATCH", patch);
  if (!accounts[0]) throw new Error("Account settings could not be saved.");
  let warning: string | undefined;
  if (input.enabled === false) {
    try { await tenantDb(`tenant_jobs?owner_id=${eq(owner)}&status=in.(pending,processing)`, "PATCH", { status: "cancelled" }); }
    catch { warning = "Automatic replies are paused, but queued-job cancellation could not be confirmed. Retry Pause before enabling again. A send already in progress may finish."; }
  }
  return { account: accounts[0], warning };
}

export async function tenantControls(owner: string, text: string): Promise<void> {
  // Idempotent creation; the SQL connect function separately binds verified Business connections.
  const existing = await tenantDb<Array<{ owner_id: string }>>("tenant_accounts?owner_id=" + eq(owner));
  if (!existing.length) {
    // Concurrent /start and connection updates are safe through the upsert RPC.
    await tenantDb("rpc/tenant_register", "POST", { p_owner: owner });
  }
  const command = text.trim().split(/\s+/)[0].split("@")[0].toLowerCase();
  let response = "Your private AI agent\n\n1. Connect this bot to your account using Telegram’s connected Business/Secretary bot settings. Choose the chats it may access and allow replies. Open /dashboard to set up a manual inbox.\n2. Send /enable to consent to AI processing and enable automation, then choose Allow AI in each conversation. Approved incoming message text is sent to the configured AI provider and stored for up to 7 days while the worker runs, or until you clear it sooner.\n\n/pause — stop automatic replies\n/status — connection status\n/dashboard — private web dashboard\n/clearhistory — clear your stored copies\n\nStarting this bot alone does not give it access to your inbox.";
  if (command === "/enable") {
    try {
      await saveTenantSettings(owner, { enabled: true, consent: true });
      response = "Automatic replies enabled. Open /dashboard and choose Allow AI for each chat you want the agent to answer. /pause stops automatic replies. /dashboard shows your settings and reply jobs. Other chats use manual replies.";
    } catch (error) { response = error instanceof TenantActivationError ? error.message : "Could not confirm automatic reply settings were saved. Use /status to check, then retry /enable. If this continues, contact the operator."; }
  } else if (command === "/pause") {
    try {
      const result = await saveTenantSettings(owner, { enabled: false });
      response = result.warning || "Automatic replies paused. A Telegram send already in progress may still finish.";
    } catch { response = "Could not confirm automatic replies were paused. Retry /pause or disconnect the bot in Telegram to revoke its access."; }
  } else if (command === "/status") {
    const account = await tenantAccount(owner);
    const connections = await tenantDb<TenantConnection[]>("tenant_connections?owner_id=" + eq(owner));
    response = `Auto-reply: ${account.enabled ? "on" : "off"}. Saved connections: ${connections.length}. Permissions are checked again before every reply. Use /dashboard to review your inbox.`;
  } else if (command === "/clearhistory") {
    if (text.trim().toLowerCase() === "/clearhistory confirm") {
      const count = await tenantDb<number>("rpc/tenant_clear_history", "POST", { p_owner: owner });
      response = `Cleared ${count} stored message copies and cancelled queued replies. Conversation IDs remain. Original Telegram messages are unchanged.`;
    } else response = "Send /clearhistory confirm to erase only your stored message copies and cancel queued replies. Original Telegram messages stay unchanged. An in-progress send may still complete.";
  }
  const account = await tenantAccount(owner);
  const dashboardUrl = tenantDashboardUrl();
  if (command === "/dashboard") {
    response = `Your private dashboard\n\nAuto-reply: ${account.enabled ? "on" : "paused"}.\nUse the buttons below to control automatic replies for your selected Telegram chats.`;
    if (!account.consent_at) response += "\n\nEnable AI (consent) agrees to send selected incoming message text to the configured AI provider and store copies for up to 7 days while the worker runs, or until you clear them sooner. Connect the bot and allow replies in Telegram first.";
    response += dashboardUrl
      ? "\n\nOpen my dashboard shows your private inbox, preferences and reply jobs. Telegram signs you in automatically."
      : "\n\nThe web dashboard URL is not configured. You can still use these Telegram controls. Ask the operator to configure the HTTPS dashboard address.";
  }
  const controls: Array<Array<Record<string, unknown>>> = [
    [account.enabled ? { text: "Pause automatic replies", callback_data: "tenant:pause" } : { text: "Enable AI (consent)", callback_data: "tenant:enable" }],
    [{ text: "Status", callback_data: "tenant:status" }, { text: "Clear copies…", callback_data: "tenant:clearhistory" }]
  ];
  if (dashboardUrl) controls.unshift([{ text: "Open my dashboard", web_app: { url: dashboardUrl } }]);
  await telegramCall("sendMessage", {
    chat_id: owner, text: response,
    reply_markup: { inline_keyboard: controls }
  });
}

/** Called only after the shared webhook secret is verified, BEFORE legacy global storage. */
export async function tenantWebhook(update: Record<string, any>): Promise<boolean | void> {
  const callback = update.callback_query;
  if (callback && callback.message?.chat?.type === "private" && String(callback.message.chat.id) === String(callback.from?.id) && /^tenant:(enable|pause|status|clearhistory)$/.test(String(callback.data))) {
    await telegramCall("answerCallbackQuery", { callback_query_id: callback.id }).catch(() => undefined);
    const claimed = await tenantDb<boolean>("rpc/tenant_control_claim", "POST", { p_update: String(update.update_id), p_owner: String(callback.from.id) });
    if (claimed) await tenantControls(String(callback.from.id), "/" + String(callback.data).slice(7));
    return;
  }
  if (update.business_connection?.id) { await syncConnection(String(update.business_connection.id)); return; }
  const direct = update.message;
  if (direct?.chat?.type === "private" && !direct.from?.is_bot && String(direct.from?.id) === String(direct.chat.id)) {
    const command = typeof direct.text === "string" ? direct.text.trim().split(/\s+/)[0].split("@")[0].toLowerCase() : "";
    // Ordinary private messages are not control commands; avoid repeated /start replies.
    if (!["/start", "/dashboard", "/enable", "/pause", "/status", "/clearhistory"].includes(command)) return;
    const claimed = await tenantDb<boolean>("rpc/tenant_control_claim", "POST", { p_update: String(update.update_id), p_owner: String(direct.from.id) });
    if (claimed) await tenantControls(String(direct.from.id), String(direct.text || "/start"));
    return;
  }
  const deleted = update.deleted_business_messages;
  if (deleted?.business_connection_id && Array.isArray(deleted.message_ids)) {
    const conn = await syncConnection(String(deleted.business_connection_id));
    const ids = deleted.message_ids.filter((id: unknown) => Number.isSafeInteger(id)).join(",");
    if (ids) await tenantDb(`tenant_messages?owner_id=${eq(String(conn.user.id))}&connection_id=${eq(conn.id)}&chat_id=${eq(String(deleted.chat?.id))}&telegram_id=in.(${ids})`, "DELETE");
    return;
  }
  // Edits are not new messages: never generate a second reply from an edit.
  const message = update.business_message;
  if (!message?.business_connection_id || message.chat?.type !== "private" || message.from?.is_bot || message.sender_business_bot || message.outgoing) return;
  const connection = await syncConnection(String(message.business_connection_id));
  // Reading a Business inbox and sending replies have different permissions.
  // Keep opted-in incoming conversations visible even when reply access is off.
  if (!connection.is_enabled || String(message.from?.id) === String(connection.user.id)) return;
  // Save only a media-type marker for attachments; never download or store media.
  // The database marks these messages as ineligible for automatic AI replies.
  const mediaType = ["photo", "video", "voice", "video_note", "document", "sticker",
    "audio", "animation", "location", "contact"].find(type => message[type]);
  const text = safeText(message.text || message.caption ||
    (mediaType ? "[Media] " + mediaType : ""), 4096);
  if (!text || !Number.isSafeInteger(message.message_id) || !/^[1-9][0-9]*$/.test(String(message.chat.id))) return;
  await tenantDb("rpc/tenant_ingest", "POST", { p_update: String(update.update_id), p_connection: connection.id, p_chat: String(message.chat.id), p_text: text, p_telegram: message.message_id });
  const pending = await tenantDb<Array<{ update_id: string }>>(`tenant_jobs?select=update_id&update_id=${eq(String(update.update_id))}&status=eq.pending&limit=1`);
  return pending.length > 0;
}

export async function processTenantJob(job: TenantJob): Promise<void> {
  let sending = false;
  try {
    const account = await tenantAccount(job.owner_id);
    const messages = job.message_id ? await tenantDb<TenantMessage[]>(`tenant_messages?owner_id=${eq(job.owner_id)}&connection_id=${eq(job.connection_id)}&chat_id=${eq(job.chat_id)}&ai_context=eq.true&id=eq.${job.message_id}`) : [];
    const message = messages[0];
    if (!message || !account.consent_at || !decideReply({ enabled: account.enabled, allowedContact: true, text: message.body, duplicate: false }).allowed) { await tenantFinish(job, "cancelled"); return; }
    if (!(await verifyTenantConnection(job.owner_id, job.connection_id))) { await tenantFinish(job, "cancelled"); return; }
    // tenant_claim_job enforces available_at (the 10-second queue delay).
    // Do not wait twice. Recheck a pause after the live connection check.
    checkOperationDeadline();
    if (!(await tenantAccount(job.owner_id)).enabled) { await tenantFinish(job, "cancelled"); return; }
    const history = await tenantAiHistory(job);
    const credential = await tenantCredential(job.owner_id);
    const readiness = await tenantDb<"ready" | "failed" | "cancelled">("rpc/tenant_prepare_ai_reply", "POST", {
      p_owner: job.owner_id, p_connection: job.connection_id, p_chat: job.chat_id, p_update: job.update_id,
      p_limit: tenantDailyReplyLimit()
    });
    if (readiness !== "ready") {
      await tenantFinish(job, readiness === "failed" ? "failed" : "cancelled");
      return;
    }
    const reply = await generateReply({ incomingText: message.body, tone: account.tone, language: account.language, replyLength: "concise", recentContext: history.reverse().map(m => `${m.direction}: ${m.body}`).join("\n").slice(-12000) }, credential ? { provider: "gemini", model: credential.model, fallbackEnabled: false, apiKey: credential.apiKey } : undefined);
    if (reply === "[ESCALATE]") { await tenantFinish(job, "cancelled"); return; }
    // Recheck after AI latency: pause, cleanup or revoked rights must stop queued sends.
    if (!(await tenantAccount(job.owner_id)).enabled || !(await verifyTenantConnection(job.owner_id, job.connection_id))) { await tenantFinish(job, "cancelled"); return; }
    const claimed = await tenantDb<TenantJob[]>(`tenant_jobs?owner_id=${eq(job.owner_id)}&update_id=${eq(job.update_id)}&status=eq.processing&message_id=not.is.null`, "PATCH", { status: "sending" });
    if (!claimed.length) return;
    sending = true;
    const result = await telegramCall<{ message_id: number }>("sendMessage", { business_connection_id: job.connection_id, chat_id: job.chat_id, text: reply });
    await tenantFinish(job, "sent");
    // Copy failure must never cause the delivered Telegram message to be resent.
    try { await tenantDb("tenant_messages", "POST", { owner_id: job.owner_id, connection_id: job.connection_id, chat_id: job.chat_id, direction: "outgoing", ai_context: true, body: reply.slice(0,4096), telegram_id: result.message_id }); } catch { /* sent state is authoritative */ }
  } catch {
    await withoutOperationDeadline(() => tenantFinish(job, sending ? "uncertain" : "failed"));
  }
}
