import { useState } from "react";

type Check = { name: string; ok: boolean; detail: string };
type Result = {
  error?: string; message?: string; warning?: string; matchesExpected?: boolean; webhookUrl?: string;
  setup?: { ready: boolean; mode: string; checks: Check[] };
  webhook?: { url?: string; pending_update_count?: number; last_error_message?: string; last_error_date?: number };
};
export default function WebhookPanel({ enabled, apiRequest, readJson }: {
  enabled: boolean;
  apiRequest: (path: string, init?: RequestInit) => Promise<Response>;
  readJson: (response: Response) => Promise<Record<string, any>>;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  async function run(register: boolean) {
    setBusy(true); setResult(null);
    try {
      const response = await apiRequest("/api/agent/telegram/" + (register ? "configure-webhook" : "webhook-info"), { method: register ? "POST" : "GET" });
      const data = await readJson(response) as Result;
      setResult(response.ok ? data : { ...data, error: data.error || "Could not check the webhook. Try again." });
    } catch (error) { setResult({ error: error instanceof Error ? error.message : "Webhook check failed. Try again." }); }
    finally { setBusy(false); }
  }
  const failed = result?.setup?.checks.filter(check => !check.ok) || [];
  const webhook = result?.webhook;
  return <div className="integration-row owner-settings">
    <div className="owner-settings-content">
      <b>Telegram webhook</b>
      <p>Check database setup, pending updates and Telegram’s last delivery error.</p>
      <div className="owner-add-row">
        <button className="secondary-button compact" disabled={!enabled || busy} onClick={() => void run(false)}>Check delivery</button>
        <button className="secondary-button compact" disabled={!enabled || busy} onClick={() => void run(true)}>Configure webhook</button>
      </div>
      {busy && <p role="status">Checking webhook setup…</p>}
      {result && <div aria-live="polite" style={{ overflowWrap: "anywhere" }}>
        {result.error && <p role="alert">{result.error}</p>}
        {result.message && <p>{result.message}</p>}
        {result.setup && <p><b>{result.setup.ready ? "Database read checks passed" : "Setup needs attention"}</b> · {result.setup.mode}</p>}
        {failed.length > 0 && <ul>{failed.map(check => <li key={check.name}><b>{check.name}</b><p>{check.detail}</p></li>)}</ul>}
        {result.setup?.ready && <p className="helper-text">These checks do not send a message or test database writes, worker functions or AI generation. Verify delivery with a new permitted incoming message.</p>}
        {webhook && <>
          <p>{webhook.url ? "Registered URL: " + webhook.url : "No webhook is registered."}</p>
          {result.matchesExpected === false && <p role="alert">The registered URL differs from this deployment’s expected URL. Confirm APP_BASE_URL, then configure the webhook.</p>}
          <p>Waiting for delivery: {webhook.pending_update_count ?? "Unknown"}</p>
          {webhook.last_error_message ? <p>Last reported error{webhook.last_error_date ? " · " + new Date(webhook.last_error_date * 1000).toLocaleString() : ""}: {webhook.last_error_message}. This is Telegram’s last recorded error; it may predate the latest deployment.</p> : <p>Telegram reports no previous delivery error. New delivery still needs verification.</p>}
        </>}
      </div>}
    </div>
  </div>;
}
