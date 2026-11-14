import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateReply } from "./ai.js";
import { sanitizeHumanReply } from "./reply-style.js";

const settings = (provider: "openai" | "gemini", fallbackEnabled = false) => ({ provider, model: "test-model", fallbackEnabled });

describe("natural Telegram replies", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each(["openai", "gemini"] as const)("preserves complete multi-part replies from %s", async provider => {
    const reply = "First, the train leaves at 3. " + "The second route takes about an hour. ".repeat(65);
    fetchMock.mockResolvedValue(Response.json(provider === "openai"
      ? { choices: [{ message: { content: reply }, finish_reason: "stop" }] }
      : { candidates: [{ content: { parts: [{ text: reply }] }, finishReason: "STOP" }] }));
    const result = await generateReply({ incomingText: "What time is the train? Also explain the other route. " + "More context. ".repeat(60) }, settings(provider));
    expect(result).toBe(reply.trim());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(provider === "openai" ? body.max_tokens : body.generationConfig.maxOutputTokens).toBe(1600);
  });

  it.each(["Hola, ¿cómo estás?", "ሰላም፣ እንዴት ነህ?", "مرحبا كيف حالك؟", "😂", "why?"])("passes the message and context without forcing English: %s", async incomingText => {
    fetchMock.mockResolvedValue(Response.json({ choices: [{ message: { content: "Test reply" } }] }));
    await generateReply({ incomingText, recentContext: "Them: We were discussing the trip.", replyLength: "detailed when needed" }, settings("openai"));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(JSON.parse(body.messages[1].content)).toEqual({ latestMessage: incomingText, conversationAndOwnerNotes: "Them: We were discussing the trip." });
    expect(body.messages[0].content).toContain("whatever it is");
    expect(body.messages[0].content).not.toContain("latest incoming message is English");
    expect(body.max_tokens).toBe(1600);
  });

  it.each(["openai", "gemini"] as const)("does not send incomplete %s output", async provider => {
    fetchMock.mockResolvedValue(Response.json(provider === "openai"
      ? { choices: [{ message: { content: "The second answer is" }, finish_reason: "length" }] }
      : { candidates: [{ content: { parts: [{ text: "The second answer is" }] }, finishReason: "MAX_TOKENS" }] }));
    await expect(generateReply({ incomingText: "Explain both answers" }, settings(provider))).rejects.toThrow(/cut off/);
  });


  it("does not hide invalid provider credentials by calling the alternate provider", async () => {
    fetchMock.mockResolvedValueOnce(Response.json(
      { error: { message: "invalid API key" } },
      { status: 401 }
    ));
    await expect(generateReply({ incomingText: "Hello" }, settings("openai", true)))
      .rejects.toThrow(/OpenAI API request failed \(401\)/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back from OpenAI to Gemini when the alternate provider is configured", async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json({ error: { message: "temporary OpenAI failure" } }, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ candidates: [{ content: { parts: [{ text: "Gemini fallback reply" }] }, finishReason: "STOP" }] }));
    const result = await generateReply({ incomingText: "Hello" }, settings("openai", true));
    expect(result).toBe("Gemini fallback reply");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain("generativelanguage.googleapis.com");
  });

  it("falls back from Gemini to OpenAI when the alternate provider is configured", async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json({ error: { message: "temporary Gemini failure" } }, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: "OpenAI fallback reply" }, finish_reason: "stop" }] }));
    const result = await generateReply({ incomingText: "Hello" }, settings("gemini", true));
    expect(result).toBe("OpenAI fallback reply");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain("api.openai.com");
  });

  it("does not send a personal provider key to the alternate vendor", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: { message: "provider unavailable" } }, { status: 503 }));
    await expect(generateReply(
      { incomingText: "Hello" },
      { ...settings("openai", true), apiKey: "personal-openai-key" }
    )).rejects.toThrow(/personal-openai-key|fallback/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain("api.openai.com");
  });

  it("preserves owner review even when a provider wraps the marker", async () => {
    fetchMock.mockResolvedValue(Response.json({ choices: [{ message: { content: 'Reply: "[ESCALATE]"' } }] }));
    expect(await generateReply({ incomingText: "Confirm a commitment for me" }, settings("openai"))).toBe("[ESCALATE]");
  });
});

describe("reply formatting", () => {
  it("removes wrappers while preserving the answer", () => {
    expect(sanitizeHumanReply('Reply: "**Yes**, that works."')).toBe("Yes, that works.");
  });
  it("preserves serious or transparent replies instead of substituting a joke", () => {
    const reply = "This is an automated reply. The owner can confirm when they are available.";
    expect(sanitizeHumanReply(reply)).toBe(reply);
    expect(sanitizeHumanReply("Happy to help!")).toBe("Happy to help!");
  });
  it("rejects empty and oversized replies instead of sending partial text", () => {
    expect(() => sanitizeHumanReply('Reply: ""')).toThrow(/empty reply/);
    expect(() => sanitizeHumanReply("x".repeat(4097))).toThrow(/message limit/);
  });
});
