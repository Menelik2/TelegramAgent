import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import { tenantDb, eq } from "./tenant-store.js";

// AES-256-GCM encrypts tenant-owned credentials at rest. Never expose ciphertext or plaintext in API responses.
function encryptionKey(): Buffer {
  const secret = process.env.APP_ENCRYPTION_KEY?.trim();
  if (!secret || secret.length < 32) throw new Error("Operator must configure APP_ENCRYPTION_KEY (at least 32 random characters).");
  return createHash("sha256").update(secret, "utf8").digest();
}
function seal(value: string, owner: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(owner));
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), encrypted.toString("base64")].join(".");
}
function unseal(value: string, owner: string): string {
  const [version, nonce, tag, payload] = value.split(".");
  if (version !== "v1" || !nonce || !tag || !payload) throw new Error("Stored credential format is invalid.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(nonce, "base64"));
  decipher.setAAD(Buffer.from(owner));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(payload, "base64")), decipher.final()]).toString("utf8");
}
type CredentialRow = { owner_id: string; secret_ciphertext: string; model: string };
export async function tenantCredentialStatus(owner: string): Promise<{ configured: boolean; model: string }> {
  const rows = await tenantDb<CredentialRow[]>(`tenant_ai_credentials?select=owner_id,model&owner_id=${eq(owner)}&limit=1`);
  return { configured: rows.length > 0, model: rows[0]?.model || "gemini-3.5-flash-lite" };
}
export async function tenantCredential(owner: string): Promise<{ apiKey: string; model: string } | null> {
  const rows = await tenantDb<CredentialRow[]>(`tenant_ai_credentials?select=owner_id,secret_ciphertext,model&owner_id=${eq(owner)}&limit=1`);
  if (!rows.length) return null;
  return { apiKey: unseal(rows[0].secret_ciphertext, owner), model: rows[0].model };
}
export async function saveTenantCredential(owner: string, apiKey: string): Promise<void> {
  if (!/^AIza[\w-]{20,200}$/.test(apiKey)) throw new Error("Enter a valid-looking Gemini API key.");
  await tenantDb("tenant_ai_credentials?on_conflict=owner_id", "POST", {
    owner_id: owner, model: "gemini-3.5-flash-lite", secret_ciphertext: seal(apiKey, owner), updated_at: new Date().toISOString()
  });
}
export async function deleteTenantCredential(owner: string): Promise<void> {
  await tenantDb(`tenant_ai_credentials?owner_id=${eq(owner)}`, "DELETE");
}
