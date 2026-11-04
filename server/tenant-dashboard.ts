/** Use configured deployment metadata, never an untrusted request Host header. */
export function tenantDashboardUrl(): string | null {
  const base = process.env.APP_BASE_URL?.trim() || (process.env.VERCEL_URL ? "https://" + process.env.VERCEL_URL : "");
  try {
    const url = new URL(base);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return new URL("/dashboard", url.origin).href;
  } catch { return null; }
}
