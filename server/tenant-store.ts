export type TenantAccount = { owner_id: string; enabled: boolean; consent_at: string | null; tone: string; language: string };
export type TenantConnection = { id: string; owner_id: string; enabled: boolean; can_reply: boolean };
export type TenantMessage = { id: number; owner_id: string; connection_id: string; chat_id: string; body: string; direction: "incoming" | "outgoing"; created_at: string };
export type TenantJob = { update_id: string; owner_id: string; connection_id: string; chat_id: string; message_id: number | null; status: string };
export const eq = (value: string) => "eq." + encodeURIComponent(value);
export async function tenantDb<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Multi-user storage is not configured.");
  const response = await fetch(url + "/rest/v1/" + path, {
    method, signal: AbortSignal.timeout(15000),
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  if (!response.ok) throw new Error("Multi-user storage unavailable. Check the migration and connection.");
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}
export async function tenantAccount(owner: string): Promise<TenantAccount> {
  const rows = await tenantDb<TenantAccount[]>("tenant_accounts?owner_id=" + eq(owner));
  if (!rows[0]) throw new Error("Connect your account and send /start to the bot first.");
  return rows[0];
}
export async function tenantBudget(owner: string): Promise<boolean> {
  const raw = Number(process.env.TENANT_DAILY_REPLY_LIMIT || 100);
  const limit = Number.isSafeInteger(raw) ? Math.max(1, Math.min(10000, raw)) : 100;
  return tenantDb<boolean>("rpc/tenant_budget", "POST", { p_owner: owner, p_limit: limit });
}
export async function tenantThread(owner: string, connection: string, chat: string, limit = 30): Promise<TenantMessage[]> {
  return tenantDb<TenantMessage[]>(`tenant_messages?owner_id=${eq(owner)}&connection_id=${eq(connection)}&chat_id=${eq(chat)}&order=created_at.desc,id.desc&limit=${limit}`);
}
export async function tenantFinish(job: TenantJob, status: string): Promise<void> {
  await tenantDb("tenant_jobs?owner_id=" + eq(job.owner_id) + "&update_id=" + eq(job.update_id) + "&status=in.(processing,sending)", "PATCH", { status });
}
