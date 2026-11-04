import { createHmac, timingSafeEqual } from "node:crypto";

/** Only Telegram-signed, recent Mini App data can select a tenant. Never trust initDataUnsafe. */
export function telegramAccount(initData: string, token: string, now = Date.now()): string | null {
  if (!token || !initData || initData.length > 12000) return null;
  try {
    const params = new URLSearchParams(initData);
    if (new Set(params.keys()).size !== [...params.keys()].length) return null;
    const hash = params.get("hash") || "";
    if (!/^[a-f0-9]{64}$/.test(hash)) return null;
    params.delete("hash");
    const check = [...params.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${k}=${v}`).join("\n");
    const secret = createHmac("sha256", "WebAppData").update(token).digest();
    const expected = createHmac("sha256", secret).update(check).digest();
    if (!timingSafeEqual(expected, Buffer.from(hash, "hex"))) return null;
    const date = Number(params.get("auth_date"));
    if (!Number.isSafeInteger(date) || date > now / 1000 + 30 || now / 1000 - date > 3600) return null;
    const user = JSON.parse(params.get("user") || "{}");
    return Number.isSafeInteger(user.id) && user.id > 0 ? String(user.id) : null;
  } catch { return null; }
}
