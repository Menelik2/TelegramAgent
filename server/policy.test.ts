import { describe, expect, it } from "vitest";
import { decideReply, safeText } from "./policy.js";

describe("reply policy", () => {
  it("blocks all replies when automation is disabled", () => {
    expect(decideReply({ enabled: false, allowedContact: true, text: "Hello", duplicate: false }).allowed).toBe(false);
  });
  it("requires explicit contact allowlisting", () => {
    const result = decideReply({ enabled: true, allowedContact: false, text: "Hey there", duplicate: false });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/allowlist/i);
  });
  it("blocks sensitive messages for owner review", () => {
    expect(decideReply({ enabled: true, allowedContact: true, text: "Please send me your password", duplicate: false }).allowed).toBe(false);
    expect(decideReply({ enabled: true, allowedContact: true, text: "Can you transfer money to me?", duplicate: false }).allowed).toBe(false);
  });
  it("blocks duplicate events", () => {
    expect(decideReply({ enabled: true, allowedContact: true, text: "Hi", duplicate: true }).allowed).toBe(false);
  });
  it("allows an ordinary message from an allowed contact", () => {
    expect(decideReply({ enabled: true, allowedContact: true, text: "Are we meeting at 3?", duplicate: false }).allowed).toBe(true);
  });
  it("sanitizes and limits user-provided text", () => {
    expect(safeText("hello\u0000 world")).toBe("hello world");
    expect(safeText("abcdefgh", 4)).toBe("abcd");
    expect(safeText(null)).toBe("");
  });
});