/** Telegram user IDs are positive decimal IDs; reject usernames and malformed values. */
export function isValidTelegramSenderId(value: string): boolean {
  return /^\d{1,22}$/.test(value.trim());
}
