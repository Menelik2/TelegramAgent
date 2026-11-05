// Admin-only, read-only checks. No message rows, SQL writes, or Telegram sends.
export type WebhookCheck = { name: string; ok: boolean; detail: string; migration?: string };
export type WebhookSetup = { ready: boolean; mode: "private accounts" | "admin inbox"; checks: WebhookCheck[] };

export function webhookOrigin(): string | null {
  const explicit = process.env.APP_BASE_URL?.trim();
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  try {
    const url = new URL(explicit || (host ? "https://" + host : ""));
    return url.protocol === "https:" && !url.username && !url.password ? url.origin : null;
  } catch { return null; }
}

export async function inspectWebhookSetup(): Promise<WebhookSetup> {
  const multi = process.env.MULTI_USER_ENABLED === "true";
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET || "";
  const checks: WebhookCheck[] = [
    { name: "Bot token", ok: Boolean(token), detail: token ? "Configured. Telegram validates it when checking registration." : "Set TELEGRAM_BOT_TOKEN in the server environment and redeploy." },
    { name: "Webhook secret", ok: /^[A-Za-z0-9_-]{1,256}$/.test(secret), detail: /^[A-Za-z0-9_-]{1,256}$/.test(secret) ? "Configured." : "Set TELEGRAM_WEBHOOK_SECRET to 1–256 letters, numbers, underscores or hyphens, then redeploy." },
    { name: "Public address", ok: Boolean(webhookOrigin()), detail: webhookOrigin() ? "HTTPS origin configured." : "Set APP_BASE_URL to the public HTTPS website address and redeploy." }
  ];
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    checks.push({ name: "Database", ok: false, detail: "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the server environment and redeploy. The anon key cannot process webhooks." });
  } else {
    const base = "20261104010000_multi_user_agent.sql";
    const chatAi = "20261105010000_tenant_chat_ai.sql";
    const resources = multi ? [
      ["tenant_accounts", "owner_id,enabled,consent_at", base],
      ["tenant_connections", "id,owner_id,enabled,can_reply", base],
      ["tenant_jobs", "update_id,status,message_id,available_at", base],
      ["tenant_daily_usage", "owner_id,day,used,received", base],
      ["tenant_control_updates", "update_id,owner_id", base],
      ["tenant_accounts", "manual_inbox", chatAi],
      ["tenant_conversations", "owner_id,connection_id,chat_id,ai_allowed", chatAi],
      ["tenant_messages", "id,ai_context", chatAi],
      ["tenant_ai_credentials", "owner_id", "20261105000000_tenant_ai_credentials.sql"]
    ] : [
      ["telegram_updates", "update_id,payload_hash", "20261026000000_agent_persistence.sql"],
      ["agent_messages", "id,update_id,business_connection_id,chat_id,direction,message_text,telegram_message_id", "20261028000000_live_inbox.sql"],
      ["agent_contacts", "sender_id,enabled", "20261027000000_agent_memory_contacts.sql"],
      ["agent_preferences", "automation_enabled", "20261029000000_serverless_runtime_state.sql"],
      ["agent_owner_settings", "owner_user_ids", "20261103000000_owner_settings.sql"]
    ];
    checks.push(...await Promise.all(resources.map(async ([table, columns, migration]): Promise<WebhookCheck> => {
      const name = table + " (" + columns + ")";
      try {
        const response = await fetch(`${url}/rest/v1/${table}?select=${columns}&limit=0`, {
          headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000)
        });
        if (response.ok) { await response.body?.cancel(); return { name, ok: true, detail: "Schema read succeeded." }; }
        const error = await response.json().catch(() => ({})) as { code?: string };
        if (["42P01", "42703", "PGRST204", "PGRST205"].includes(error.code || "")) {
          return { name, ok: false, migration, detail: `Required table or column is missing. Apply supabase/migrations/${migration} and its prerequisites in the production Supabase project, then recheck.` };
        }
        if (response.status === 401 || response.status === 403 || error.code === "42501") {
          return { name, ok: false, detail: "Database access denied. Verify SUPABASE_URL and the server service-role key belong to the same project, and that migration grants are applied. Redeploy after changing environment variables." };
        }
        return { name, ok: false, detail: `Database returned HTTP ${response.status}. Check Supabase availability and server logs, then recheck.` };
      } catch {
        return { name, ok: false, detail: "Database could not be reached within the check timeout. Check the project URL, Supabase availability and server network access." };
      }
    })));
  }
  return { ready: checks.every(c => c.ok), mode: multi ? "private accounts" : "admin inbox", checks };
}

export type TelegramWebhookInfo = { url?: string; pending_update_count?: number; last_error_date?: number; last_error_message?: string };
export function webhookRegistrationMessage(info: TelegramWebhookInfo): string {
  const pending = info.pending_update_count ?? 0;
  if (info.last_error_message) {
    const date = typeof info.last_error_date === "number" && Number.isFinite(info.last_error_date)
      ? new Date(info.last_error_date * 1000).toISOString() : "an unknown time";
    return `Webhook registered. Telegram's last reported delivery error at ${date}: ${info.last_error_message}. ${pending} updates are waiting. This error may predate registration. Check delivery and server logs; registration alone does not verify delivery.`;
  }
  return `Webhook registered. ${pending} updates are waiting. Send a new permitted message to verify delivery.`;
}
