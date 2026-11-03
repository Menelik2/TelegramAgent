import { describe, expect, it } from "vitest";
import { groupSenderScope, isGroupAddressedToBot, stripBotMention } from "./telegram-routing.js";
import { conversationId, parseConversationId } from "./store.js";

describe("Telegram group routing", () => {
  it("responds only to a real @yeniagentbot mention entity", () => {
    expect(isGroupAddressedToBot({ text: "hello @yeniagentbot", entities: [{ type: "mention", offset: 6, length: 13 }] }, "yeniagentbot")).toBe(true);
    expect(isGroupAddressedToBot({ text: "hello @someoneelse", entities: [{ type: "mention", offset: 6, length: 12 }] }, "yeniagentbot")).toBe(false);
    expect(isGroupAddressedToBot({ text: "@yeniagentbot" }, "yeniagentbot")).toBe(false);
  });
  it("responds to replies to the bot, not other people", () => {
    expect(isGroupAddressedToBot({ reply_to_message: { from: { id: 100, is_bot: true, username: "yeniagentbot" } } }, "yeniagentbot", "100")).toBe(true);
    expect(isGroupAddressedToBot({ reply_to_message: { from: { id: 200, is_bot: true, username: "otherbot" } } }, "yeniagentbot", "100")).toBe(false);
  });
  it("removes bot mentions from the AI prompt", () => {
    expect(stripBotMention("Hello @yeniagentbot, help", "yeniagentbot")).toBe("Hello , help");
  });
});
describe("conversation isolation", () => {
  it("isolates group, direct, and business chats even with the same chat ID", () => {
    const ids = ["direct", "group:-100100", "business-connection-1"].map(connection => conversationId(connection, "-100100"));
    expect(new Set(ids).size).toBe(3);
    expect(parseConversationId(ids[1])).toEqual({ connectionId: "group:-100100", chatId: "-100100" });
  });
  it("keeps two senders in the same group in separate histories", () => {
    const groupId = "-1001234567890";
    const first = conversationId(groupSenderScope(groupId, "111"), groupId);
    const second = conversationId(groupSenderScope(groupId, "222"), groupId);
    expect(first).not.toBe(second);
    expect(parseConversationId(first)).toEqual({ connectionId: "group:-1001234567890:user:111", chatId: groupId });
    expect(parseConversationId(second)).toEqual({ connectionId: "group:-1001234567890:user:222", chatId: groupId });
    expect(() => groupSenderScope("invalid", "111")).toThrow();
    expect(() => groupSenderScope(groupId, "invalid")).toThrow();
  });
  it("rejects malformed IDs", () => {
    expect(parseConversationId("bad")).toBeNull();
    expect(parseConversationId("group~not-a-chat")).toBeNull();
  });
});
