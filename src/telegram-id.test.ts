import { describe, expect, it } from "vitest";
import { isValidTelegramSenderId } from "./telegram-id";

describe("isValidTelegramSenderId", () => {
  it.each(["123456789", " 123456789 ", "1", "9999999999999999999999"])(
    "accepts a numeric Telegram sender ID: %s",
    value => expect(isValidTelegramSenderId(value)).toBe(true)
  );

  it.each(["", " ", "@username", "abc123", "-123", "12 34", "12345678901234567890123"])(
    "rejects an invalid sender ID: %s",
    value => expect(isValidTelegramSenderId(value)).toBe(false)
  );
});
