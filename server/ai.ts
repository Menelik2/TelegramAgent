import { operationSignal } from "./operation-deadline.js";
import { buildSystemInstruction, buildUserPrompt, sanitizeHumanReply, replyTokenBudget } from "./reply-style.js";
import { getAiRuntimeSettings } from "./store.js";

/**
 * AI providers for Telegram auto-replies.
 * Goal: replies should feel like a real person — clear, warm, useful, never chatbot-like.
 *
 *   AI_PROVIDER=openai   + OPENAI_API_KEY  (+ OPENAI_MODEL=gpt-4o recommended)
 *   AI_PROVIDER=gemini   + GEMINI_API_KEY  (+ GEMINI_MODEL=gemini-3.5-flash-lite)
 */
const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";
const DEFAULT_OPENAI_MODEL = "gpt-4o";

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
  error?: { message?: string; status?: string; code?: number };
};

type OpenAiResponse = {
  choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  error?: { message?: string; type?: string; code?: string };
};

function providerName(): "openai" | "gemini" {
  const raw = (process.env.AI_PROVIDER || "").trim().toLowerCase();
  if (raw === "openai" || raw === "gpt" || raw === "chatgpt") return "openai";
  if (process.env.OPENAI_API_KEY?.trim() && !process.env.GEMINI_API_KEY?.trim()) return "openai";
  return "gemini";
}

export function isAiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim());
}

export function getAiProviderLabel(): string {
  const p = providerName();
  if (p === "openai") return process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
}

export class AiQuotaError extends Error {
  readonly status = 429;
  constructor(message: string) {
    super(message);
    this.name = "AiQuotaError";
  }
}

async function generateWithOpenAI(input: {
  incomingText: string;
  recentContext?: string;
  tone?: string;
  language?: string;
  replyLength?: string;
}, selectedModel?: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");
  const model = selectedModel || process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;
  const maxTokens = replyTokenBudget(input);

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST", signal: operationSignal(30000),
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + apiKey
    },
    body: JSON.stringify({
      model,
      temperature: 0.75,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: buildSystemInstruction({ ...input, incomingText: input.incomingText }) },
        { role: "user", content: buildUserPrompt(input) }
      ]
    })
  });

  const result = await response.json().catch(() => ({})) as OpenAiResponse;
  if (!response.ok) {
    const detail = result.error?.message || "";
    if (response.status === 429) {
      throw new AiQuotaError(
        `OpenAI quota/rate limit for model "${model}". Check billing at https://platform.openai.com/usage. ` +
          (detail ? `Provider detail: ${detail}` : "")
      );
    }
    throw new Error(`OpenAI API request failed (${response.status})${detail ? `: ${detail}` : "."}`);
  }

  if (result.choices?.[0]?.finish_reason === "length") throw new Error("OpenAI reply was cut off; no partial reply was sent.");
  const text = (result.choices?.[0]?.message?.content || "").trim();
  if (!text) throw new Error("OpenAI returned an empty reply.");
  if (text.trim() === "[ESCALATE]") return "[ESCALATE]";
  return sanitizeHumanReply(text);
}

async function generateWithGemini(input: {
  incomingText: string;
  recentContext?: string;
  tone?: string;
  language?: string;
  replyLength?: string;
}, selectedModel?: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");
  const model = selectedModel || process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST", signal: operationSignal(30000),
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: buildSystemInstruction({ ...input, incomingText: input.incomingText }) }] },
        contents: [{ role: "user", parts: [{ text: buildUserPrompt(input) }] }],
        generationConfig: {
          temperature: 0.75,
          maxOutputTokens: replyTokenBudget(input)
        }
      })
    }
  );

  const result = await response.json().catch(() => ({})) as GeminiResponse;
  if (!response.ok) {
    const detail = result.error?.message || "";
    if (response.status === 429) {
      throw new AiQuotaError(
        `Gemini quota exceeded for model "${model}". ` +
          `Use GEMINI_MODEL=gemini-3.5-flash-lite or switch AI_PROVIDER=openai. ` +
          (detail ? `Provider detail: ${detail}` : "")
      );
    }
    throw new Error(`Gemini API request failed (${response.status})${detail ? `: ${detail}` : "."}`);
  }

  if (result.candidates?.[0]?.finishReason === "MAX_TOKENS") throw new Error("Gemini reply was cut off; no partial reply was sent.");
  const text = result.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    .join("")
    .trim() || "";

  if (!text) throw new Error("Gemini returned an empty reply.");
  if (text.trim() === "[ESCALATE]") return "[ESCALATE]";
  return sanitizeHumanReply(text);
}

export async function generateReply(input: {
  incomingText: string;
  recentContext?: string;
  tone?: string;
  language?: string;
  replyLength?: string;
}, overrideSettings?: { provider: "gemini" | "openai"; model: string; fallbackEnabled?: boolean }): Promise<string> {
  const settings = overrideSettings || await getAiRuntimeSettings().catch(() => ({
    provider: (process.env.AI_PROVIDER?.trim().toLowerCase() === "openai" ? "openai" : "gemini") as "openai" | "gemini",
    model: process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL,
    fallbackEnabled: true
  }));
  const provider = settings.provider;
  const model = settings.model;

  const runPrimary = async (): Promise<string> => {
    if (provider === "openai") {
      if (!process.env.OPENAI_API_KEY?.trim()) throw new Error("The selected OpenAI provider requires OPENAI_API_KEY on the server.");
      return generateWithOpenAI(input, model);
    }
    if (!process.env.GEMINI_API_KEY?.trim()) throw new Error("GEMINI_API_KEY is not configured.");
    return generateWithGemini(input, model);
  };

  try {
    return await runPrimary();
  } catch (error) {
    if (provider === "gemini" || settings.fallbackEnabled !== true) throw error;
    const fallbackModel = provider === "openai"
      ? (model === "gpt-4o-mini" ? "gpt-4o" : "gpt-4o-mini")
      : model;
    if (fallbackModel === model) throw error;
    try {
      if (provider === "openai") {
        if (!process.env.OPENAI_API_KEY?.trim()) throw error;
        return await generateWithOpenAI(input, fallbackModel);
      }
      if (!process.env.GEMINI_API_KEY?.trim()) throw error;
      return await generateWithGemini(input, fallbackModel);
    } catch (fallbackError) {
      throw new Error("Selected AI model and automatic fallback both failed. " +
        (fallbackError instanceof Error ? fallbackError.message : "Provider unavailable."));
    }
  }
}

