// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import WebhookPanel from "./WebhookPanel";
afterEach(cleanup);
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const readJson = (r: Response) => r.json();
it("keeps the exact failed setup check visible and offers a read-only recheck", async () => {
  const api = vi.fn().mockResolvedValue(response({ error: "Setup incomplete", setup: { ready: false, mode: "admin inbox", checks: [{ name: "agent_preferences", ok: false, detail: "Apply 20261029000000_serverless_runtime_state.sql" }] } }, 503));
  render(<WebhookPanel enabled apiRequest={api} readJson={readJson} />);
  fireEvent.click(screen.getByText("Configure webhook"));
  expect(await screen.findByText("Apply 20261029000000_serverless_runtime_state.sql")).toBeTruthy();
  api.mockResolvedValue(response({ setup: { ready: true, mode: "admin inbox", checks: [] }, webhook: { url: "https://app.test/api/telegram/webhook", pending_update_count: 0 } }));
  fireEvent.click(screen.getByText("Check delivery"));
  expect(await screen.findByText("Database read checks passed")).toBeTruthy();
  expect(screen.queryByText("Setup incomplete")).toBeNull();
  expect(api).toHaveBeenLastCalledWith("/api/agent/telegram/webhook-info", { method: "GET" });
  expect(screen.getByText(/New delivery still needs verification/)).toBeTruthy();
});
it("displays Telegram's historical error, pending count and URL mismatch without claiming delivery works", async () => {
  const api = vi.fn().mockResolvedValue(response({ matchesExpected: false, webhook: { url: "https://old.test/api/telegram/webhook", pending_update_count: 7, last_error_message: "503 Service Unavailable", last_error_date: 1793750400 } }));
  render(<WebhookPanel enabled apiRequest={api} readJson={readJson} />);
  fireEvent.click(screen.getByText("Check delivery"));
  expect(await screen.findByText(/Waiting for delivery: 7/)).toBeTruthy();
  expect(screen.getByText(/may predate the latest deployment/)).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toContain("registered URL differs");
});
it("requires dashboard authorization and prevents duplicate requests while busy", async () => {
  const api = vi.fn(); const view = render(<WebhookPanel enabled={false} apiRequest={api} readJson={readJson} />);
  expect((screen.getByText("Check delivery") as HTMLButtonElement).disabled).toBe(true);
  view.rerender(<WebhookPanel enabled apiRequest={api} readJson={readJson} />);
  let finish!: (r: Response) => void; api.mockImplementation(() => new Promise(r => { finish = r; }));
  fireEvent.click(screen.getByText("Check delivery")); fireEvent.click(screen.getByText("Configure webhook"));
  expect(api).toHaveBeenCalledTimes(1); finish(response({ error: "Temporary failure" }, 503));
  expect(await screen.findByRole("alert")).toBeTruthy();
});
