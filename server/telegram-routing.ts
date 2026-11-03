/** Telegram group routing. Never respond to general group traffic. */
export type TelegramMessageLike = {
  text?: string;
  caption?: string;
  entities?: Array<{ type?: string; offset?: number; length?: number }>;
  caption_entities?: Array<{ type?: string; offset?: number; length?: number }>;
  reply_to_message?: { from?: { id?: number | string; username?: string; is_bot?: boolean } };
};
export function isGroupAddressedToBot(message: TelegramMessageLike, botUsername: string, botId?: string): boolean {
  const username = botUsername.replace(/^@/, "").toLowerCase();
  if (!username) return false;
  const replyFrom = message.reply_to_message?.from;
  if (replyFrom && ((botId && String(replyFrom.id || "") === botId) ||
    (replyFrom.is_bot === true && String(replyFrom.username || "").toLowerCase() === username))) return true;
  const text = message.text || message.caption || "";
  const entities = message.entities || message.caption_entities || [];
  // Telegram entity offsets use UTF-16 code units, matching JavaScript string slicing.
  return entities.some(entity => entity.type === "mention" && Number.isInteger(entity.offset) && Number.isInteger(entity.length) &&
    text.slice(entity.offset!, entity.offset! + entity.length!).toLowerCase() === "@" + username);
}
export function stripBotMention(text: string, username: string): string {
  const escaped = username.replace(/^@/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp("@" + escaped + "\\b", "gi"), "").trim();
}

/** Storage namespace for one sender in one group. Never use this as Telegram chat_id. */
export function groupSenderScope(groupChatId: string, senderId: string): string {
  if (!/^-?[0-9]{1,22}$/.test(groupChatId) || !/^[0-9]{1,22}$/.test(senderId)) {
    throw new Error("Invalid group chat or sender ID.");
  }
  return "group:" + groupChatId + ":user:" + senderId;
}
