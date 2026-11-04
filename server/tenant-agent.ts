import { generateReply } from "./ai.js";
import { decideReply, safeText } from "./policy.js";
import { tenantAccount, tenantBudget, tenantDb, tenantFinish, tenantThread, eq, type TenantConnection, type TenantJob, type TenantMessage } from "./tenant-store.js";

export const multiUserEnabled = () => process.env.MULTI_USER_ENABLED === "true";
type BusinessConnection = { id: string; user: { id: number }; is_enabled: boolean; rights?: { can_reply?: boolean } };
export async function telegramCall<T>(method: string, payload: unknown): Promise<T> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("Telegram is not configured.");
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST", signal: AbortSignal.timeout(15000), headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
  });
  const body = await response.json() as { ok?: boolean; result: T };
  if (!response.ok || !body.ok) throw new Error("Telegram rejected the operation or is unavailable.");
  return body.result;
}
async function syncConnection(id: string): Promise<BusinessConnection> {
  const connection = await telegramCall<BusinessConnection>("getBusinessConnection", { business_connection_id: id });
  if (connection.id !== id || !Number.isSafeInteger(connection.user?.id) || connection.user.id < 1) throw new Error("Invalid Business connection.");
  await tenantDb("rpc/tenant_connect", "POST", { p_owner: String(connection.user.id), p_connection: id, p_enabled: connection.is_enabled === true, p_reply: connection.rights?.can_reply === true });
  return connection;
}
export async function verifyTenantConnection(owner: string, id: string): Promise<boolean> {
  const stored = await tenantDb<TenantConnection[]>(`tenant_connections?owner_id=${eq(owner)}&id=${eq(id)}`);
  if (!stored[0]) return false;
  const live = await syncConnection(id);
  return String(live.user.id) === owner && live.is_enabled === true && live.rights?.can_reply === true;
}
export async function tenantControls(owner: string, text: string): Promise<void> {
  // Idempotent creation; the SQL connect function separately binds verified Business connections.
  const existing = await tenantDb<Array<{ owner_id: string }>>("tenant_accounts?owner_id=" + eq(owner));
  if (!existing.length) {
    // Concurrent /start and connection updates are safe through the upsert RPC.
    await tenantDb("rpc/tenant_register", "POST", { p_owner: owner });
  }
  const command = text.trim().split(/\s+/)[0].split("@")[0].toLowerCase();
  let response = "Your private AI agent\n\n1. Connect this bot to your account using Telegram’s connected Business/Secretary bot settings. Choose the chats it may access and allow replies.\n2. Send /enable to consent to AI processing and enable replies. Selected incoming message text is sent to the configured AI provider and stored for up to 7 days while the worker runs, or until you clear it sooner.\n\n/pause — stop automatic replies\n/status — connection status\n/dashboard — private web dashboard\n/clearhistory — clear your stored copies\n\nStarting this bot alone does not give it access to your inbox.";
  if (command === "/enable") {
    const connections = await tenantDb<TenantConnection[]>("tenant_connections?owner_id=" + eq(owner));
    let authorized = false;
    for (const connection of connections) if (await verifyTenantConnection(owner, connection.id)) authorized = true;
    if (!authorized) response = "Connect this bot to your account and grant reply permission first. Then send /enable.";
    else {
      await tenantDb("tenant_accounts?owner_id=" + eq(owner), "PATCH", { enabled: true, consent_at: new Date().toISOString() });
      response = "AI processing enabled for the chats you selected in Telegram. /pause stops automatic replies. /dashboard opens your private settings and inbox.";
    }
  } else if (command === "/pause") {
    await tenantDb("tenant_accounts?owner_id=" + eq(owner), "PATCH", { enabled: false });
    await tenantDb(`tenant_jobs?owner_id=${eq(owner)}&status=in.(pending,processing)`, "PATCH", { status: "cancelled" });
    response = "Automatic replies paused. A Telegram send already in progress may still finish.";
  } else if (command === "/status") {
    const account = await tenantAccount(owner);
    const connections = await tenantDb<TenantConnection[]>("tenant_connections?owner_id=" + eq(owner));
    response = `Auto-reply: ${account.enabled ? "on" : "off"}. Saved connections: ${connections.length}. Permissions are checked again before every reply. Use /dashboard to review your inbox.`;
  } else if (command === "/clearhistory") {
    if (text.trim().toLowerCase() === "/clearhistory confirm") {
      const count = await tenantDb<number>("rpc/tenant_clear_history", "POST", { p_owner: owner });
      response = `Cleared ${count} stored message copies and cancelled queued replies. Conversation IDs remain. Original Telegram messages are unchanged.`;
    } else response = "Send /clearhistory confirm to erase only your stored message copies and cancel queued replies. Original Telegram messages stay unchanged. An in-progress send may still complete.";
  } else if (command === "/dashboard") response = "Open your private dashboard below. Your Telegram account signs you in automatically.";
  const appUrl = process.env.APP_BASE_URL?.replace(/\/$/, "");
  const controls: Array<Array<Record<string, unknown>>> = [
    [{ text: "Enable AI (consent)", callback_data: "tenant:enable" }, { text: "Pause", callback_data: "tenant:pause" }],
    [{ text: "Status", callback_data: "tenant:status" }, { text: "Clear copies…", callback_data: "tenant:clearhistory" }]
  ];
  if (appUrl?.startsWith("https://")) controls.unshift([{ text: "Open my dashboard", web_app: { url: appUrl + "/my-agent" } }]);
  await telegramCall("sendMessage", {
    chat_id: owner, text: response,
    reply_markup: { inline_keyboard: controls }
  });
}

/** Called only after the shared webhook secret is verified, BEFORE legacy global storage. */
export async function tenantWebhook(update: Record<string, any>): Promise<void> {
  const callback = update.callback_query;
  if (callback && callback.message?.chat?.type === "private" && String(callback.message.chat.id) === String(callback.from?.id) && /^tenant:(enable|pause|status|clearhistory)$/.test(String(callback.data))) {
    const claimed = await tenantDb<boolean>("rpc/tenant_control_claim", "POST", { p_update: String(update.update_id), p_owner: String(callback.from.id) });
    if (claimed) await tenantControls(String(callback.from.id), "/" + String(callback.data).slice(7));
    await telegramCall("answerCallbackQuery", { callback_query_id: callback.id }).catch(() => undefined);
    return;
  }
  if (update.business_connection?.id) { await syncConnection(String(update.business_connection.id)); return; }
  const direct = update.message;
  if (direct?.chat?.type === "private" && !direct.from?.is_bot && String(direct.from?.id) === String(direct.chat.id)) {
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
  if (!connection.is_enabled || !connection.rights?.can_reply || String(message.from?.id) === String(connection.user.id)) return;
  const text = safeText(message.text || message.caption, 4096);
  if (!text || !Number.isSafeInteger(message.message_id) || !/^[1-9][0-9]*$/.test(String(message.chat.id))) return;
  await tenantDb("rpc/tenant_ingest", "POST", { p_update: String(update.update_id), p_connection: connection.id, p_chat: String(message.chat.id), p_text: text, p_telegram: message.message_id });
}

export async function processTenantJob(job: TenantJob): Promise<void> {
  let sending = false;
  try {
    const account = await tenantAccount(job.owner_id);
    const messages = job.message_id ? await tenantDb<TenantMessage[]>(`tenant_messages?owner_id=${eq(job.owner_id)}&id=eq.${job.message_id}`) : [];
    const message = messages[0];
    if (!message || !account.consent_at || !decideReply({ enabled: account.enabled, allowedContact: true, text: message.body, duplicate: false }).allowed) { await tenantFinish(job, "cancelled"); return; }
    if (!(await verifyTenantConnection(job.owner_id, job.connection_id))) { await tenantFinish(job, "cancelled"); return; }
    if (!(await tenantBudget(job.owner_id))) { await tenantFinish(job, "failed"); return; }
    const history = await tenantThread(job.owner_id, job.connection_id, job.chat_id, 12);
    const reply = await generateReply({ incomingText: message.body, tone: account.tone, language: account.language, replyLength: "concise", recentContext: history.filter(m => m.id < message.id).reverse().map(m => `${m.direction}: ${m.body}`).join("\n").slice(-12000) });
    if (reply === "[ESCALATE]") { await tenantFinish(job, "cancelled"); return; }
    // Recheck after AI latency: pause, cleanup or revoked rights must stop queued sends.
    if (!(await tenantAccount(job.owner_id)).enabled || !(await verifyTenantConnection(job.owner_id, job.connection_id))) { await tenantFinish(job, "cancelled"); return; }
    const claimed = await tenantDb<TenantJob[]>(`tenant_jobs?owner_id=${eq(job.owner_id)}&update_id=${eq(job.update_id)}&status=eq.processing&message_id=not.is.null`, "PATCH", { status: "sending" });
    if (!claimed.length) return;
    sending = true;
    const result = await telegramCall<{ message_id: number }>("sendMessage", { business_connection_id: job.connection_id, chat_id: job.chat_id, text: reply });
    await tenantFinish(job, "sent");
    // Copy failure must never cause the delivered Telegram message to be resent.
    try { await tenantDb("tenant_messages", "POST", { owner_id: job.owner_id, connection_id: job.connection_id, chat_id: job.chat_id, direction: "outgoing", body: reply.slice(0,4096), telegram_id: result.message_id }); } catch { /* sent state is authoritative */ }
  } catch {
    await tenantFinish(job, sending ? "uncertain" : "failed");
  }
}
