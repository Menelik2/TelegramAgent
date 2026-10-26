export type ReplyDecision = { allowed: boolean; reason: string };
const sensitivePatterns = [
  /\b(password|passcode|verification code|2fa|authentication code|recovery code)\b/i,
  /\b(send|transfer|wire|pay)\s+(me\s+)?(money|cash|crypto|bitcoin|funds)\b/i,
  /\b(bank account|credit card|private key|seed phrase)\b/i,
  /\b(lawyer|lawsuit|contract|legal advice|diagnos(is|e))\b/i,
  /\b(emergency|suicid|self[- ]harm|threaten|i will hurt)\b/i
];
export function decideReply(input: { enabled: boolean; allowedContact: boolean; text: string; duplicate: boolean }): ReplyDecision {
  if (!input.enabled) return { allowed: false, reason: "Automation is disabled." };
  if (!input.allowedContact) return { allowed: false, reason: "Contact is not on the explicit allowlist." };
  if (input.duplicate) return { allowed: false, reason: "Duplicate message event." };
  if (sensitivePatterns.some(pattern => pattern.test(input.text))) return { allowed: false, reason: "Sensitive content requires owner review." };
  return { allowed: true, reason: "Contact and content passed basic policy checks." };
}
export function safeText(value: unknown, maxLength = 1800): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, maxLength);
}