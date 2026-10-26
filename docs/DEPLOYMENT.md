# Deploy TelegramAgent to Vercel

This repository can run as a single Vercel project: Vite serves the dashboard, and `api/[...path].ts` routes `/api/*` requests to the Express API. Supabase is required for reliable Telegram webhook idempotency, live inbox storage, contacts, memories, preferences, and automation state across serverless cold starts.

## 1. Connect GitHub to Vercel

1. Open https://vercel.com/new and import `Menelik2/TelegramAgent`.
2. Select the `root` branch.
3. Use the repository root as the project root.
4. Framework preset: Vite (or Other if Vite is not detected).
5. Build command: `npm run build`.
6. Output directory: `dist`.
7. Install command: `npm install`.
8. Deploy after adding the environment variables below. Do not commit any credentials to GitHub.

The root `vercel.json` configures the Vite build and SPA fallback. The `api/[...path].ts` function serves the existing Express API on the same domain, so `VITE_API_BASE_URL` can remain blank. Do not set it to localhost in production.

## 2. Add Vercel environment variables

In Vercel → Project → Settings → Environment Variables, add these for **Production** (and Preview if you intend to test there):

| Variable | Required | Value |
|---|---|---|
| `DASHBOARD_API_TOKEN` | Yes | A long, random secret used in the dashboard Settings page |
| `TELEGRAM_BOT_TOKEN` | Yes | Token from BotFather; server-side only |
| `TELEGRAM_WEBHOOK_SECRET` | Yes | Random secret of 1–256 characters using Telegram's allowed characters: letters, numbers, underscore, hyphen |
| `GEMINI_API_KEY` | Yes | Gemini API key; server-side only. Create one at https://aistudio.google.com/apikey |
| `GEMINI_MODEL` | No | Defaults to `gemini-3.5-flash` |
| `SUPABASE_URL` | Yes for live functionality | Supabase project URL, e.g. `https://YOUR_PROJECT.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes for live functionality | Supabase service-role key; never expose in a `VITE_*` variable |
| `TELEGRAM_ALLOWED_USER_IDS` | Recommended | Comma-separated numeric Telegram sender IDs explicitly permitted for automatic replies |
| `FRONTEND_URL` | No | Your Vercel site origin, e.g. `https://your-project.vercel.app`; same-origin requests do not require a separate API origin |
| `VITE_API_BASE_URL` | No | Leave blank for the same-domain Vercel API |
| `APP_ENCRYPTION_KEY` | No | Reserved for future encryption features; it does not replace the other secrets |

Generate a dashboard/webhook secret privately. Never paste secrets into source code, public issues, screenshots, or chat. If a key has already been exposed, rotate it.

## 3. Set up Supabase persistence

In the Supabase SQL Editor, run each SQL migration in timestamp order:

1. `supabase/migrations/20261026000000_agent_persistence.sql`
2. `supabase/migrations/20261027000000_agent_memory_contacts.sql`
3. `supabase/migrations/20261028000000_live_inbox.sql`
4. `supabase/migrations/20261029000000_serverless_runtime_state.sql`

The latest migration persists the automation ON/OFF state. Without it, the app intentionally refuses to enable automatic replies on Vercel. Keep the service-role key only in Vercel server-side environment variables.

After adding or changing environment variables, redeploy the project so the new values are included in the deployment.

## 4. Configure Telegram Business webhook

This app uses Telegram's supported **Business bot connection** updates. It does not log into a personal account or scrape normal account sessions. The Telegram account owner must connect an eligible bot through Telegram Business settings and grant the required permissions.

After deployment, set the webhook URL to:

`https://YOUR-PROJECT.vercel.app/api/telegram/webhook`

Run this command in a private terminal after setting the shell variables. Replace the URL with the real Vercel deployment URL. Do not commit this command with real credentials.

```bash
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"https://YOUR-PROJECT.vercel.app/api/telegram/webhook\",\"secret_token\":\"$TELEGRAM_WEBHOOK_SECRET\",\"allowed_updates\":[\"business_connection\",\"business_message\"]}"
```

The Telegram secret must exactly match `TELEGRAM_WEBHOOK_SECRET` in Vercel. Check the JSON response for `"ok": true`.

## 5. Verify the deployment before enabling automation

1. Open `https://YOUR-PROJECT.vercel.app/api/health`; it should return JSON with `"ok": true`.
2. Open `https://YOUR-PROJECT.vercel.app/api/status`; confirm `telegramConfigured`, `aiConfigured`, and `storageConfigured` are true.
3. In the dashboard Settings page, enter the exact `DASHBOARD_API_TOKEN`.
4. Confirm the live inbox loads. If it returns a storage/migration error, apply the migrations and check the Supabase URL/key.
5. Send a real test message through the connected Telegram Business account and confirm it appears in the inbox.
6. Add one trusted test contact using its numeric sender ID. Keep automation paused until the test is successful.
7. Use the dashboard's simulation tool to verify AI replies first. Then enable automation for the trusted test contact only.
8. Verify pause and emergency-stop immediately disable future automatic replies.

## 6. Operational limitations

- Vercel functions are serverless. Automation state is stored in Supabase; process memory is not durable across cold starts.
- The current per-IP rate limiter is in-memory and best-effort. For public/high-volume production, add a shared rate-limit store and edge protection.
- The dashboard currently uses one shared API token, not individual accounts or MFA. Keep it private and rotate it if exposed.
- Prompt-injection detection is defense-in-depth, not a guarantee. Keep the explicit contact allowlist enabled and review sensitive conversations.
- Test with a dedicated permitted contact before relying on automatic replies. Never assume a successful build alone proves Telegram delivery.
