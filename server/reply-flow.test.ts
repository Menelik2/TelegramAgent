import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { generateReply } from "./ai.js";

vi.mock("./ai.js", async importOriginal => ({
  ...await importOriginal<typeof import("./ai.js")>(),
  generateReply: vi.fn()
}));

describe("dashboard reply preview", () => {
  let server: Server;
  let baseUrl: string;
  beforeAll(async () => {
    vi.stubEnv("DASHBOARD_API_TOKEN", "preview-test-token");
    vi.stubEnv("VERCEL", "1");
    const { default: app } = await import("./index.js");
    server = createServer(app);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  beforeEach(() => vi.mocked(generateReply).mockReset());
  afterAll(async () => {
    if (server?.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    vi.unstubAllEnvs();
  });

  const simulate = (body: Record<string, unknown>) => fetch(baseUrl + "/api/agent/simulate", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-dashboard-token": "preview-test-token" },
    body: JSON.stringify(body)
  });

  it("passes the whole Telegram-length text and selected reply length to the model", async () => {
    const text = "a".repeat(4050) + " What time does the train leave?";
    vi.mocked(generateReply).mockResolvedValue("The timetable says 3pm.");
    const response = await simulate({ text, replyLength: "detailed when needed" });
    expect(response.status).toBe(200);
    expect(generateReply).toHaveBeenCalledWith(expect.objectContaining({ incomingText: text, replyLength: "detailed when needed" }));
    expect(await response.json()).toMatchObject({ reply: "The timetable says 3pm.", sent: false });
  });

  it("shows owner review instead of displaying the model's control marker as a reply", async () => {
    vi.mocked(generateReply).mockResolvedValue("[ESCALATE]");
    const response = await simulate({ text: "Can you confirm a major commitment?" });
    const body = await response.json();
    expect(body).toMatchObject({ escalated: true, sent: false });
    expect(body.reply).toBeUndefined();
  });
});
