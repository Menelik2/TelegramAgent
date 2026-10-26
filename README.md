# TelegramAgent — Personal AI Inbox Assistant

A full-stack Telegram Business AI assistant with a modern dashboard, explicit contact allowlists, AI-generated replies, memory controls, and safety-first automation.

## Important Telegram limitation

This app uses the official Telegram Bot API's Business connection updates (`business_connection`, `business_message`) and sends replies with `business_connection_id`. It cannot read arbitrary messages from a normal personal account without an authorized supported connection. The owner must connect an eligible bot/account and grant permissions. See [Telegram Bot API](https://core.telegram.org/bots/api) and [Connected business bots](https://core.telegram.org/api/bots/connected-business-bots).

## Stack

- React + TypeScript + Vite + Tailwind CSS
- Node.js + TypeScript + Express
- Supabase Postgres (required for durable inbox, memory, contact permissions, and activity history)

### Database choice

**Supabase is the selected database for this repository.** The application already uses Supabase's PostgREST API, PostgreSQL-specific migrations, unique constraints for webhook idempotency, and persisted agent preferences. Keeping Supabase avoids a risky database rewrite and preserves the current production path.

Supabase Free currently includes a 500 MB database quota per project, plus separate file-storage and bandwidth allowances; check the [current pricing page](https://supabase.com/pricing) because plan limits can change. For this text-heavy Telegram inbox, 500 MB can be enough to start, but monitor database usage and plan a retention/archive policy for message history as it grows.

TiDB Cloud may offer more free row-storage capacity, but it is MySQL-compatible rather than PostgreSQL-compatible. Moving to it would require replacing the Supabase REST data-access layer, rewriting migrations and adapting unique-conflict, transaction, and persistence behavior. Do not configure TiDB alongside the current Supabase implementation: it will not work as a drop-in replacement.

If the database approaches its quota, first review stored message volume and retention, add pagination/retention where appropriate, and compare paid Supabase with a properly planned TiDB migration. Keep service-role/database credentials server-side only.
- OpenAI-compatible AI provider
- Telegram Bot API Business integration

## Quick start (local development)

1. Install Node.js 20 or newer.
2. Clone this repository and enter the project folder:
   ```bash
   git clone https://github.com/Menelik2/TelegramAgent.git
   cd TelegramAgent
   ```
3. Copy `.env.example` to `.env` and fill in the required credentials.
4. Install dependencies and start the frontend/API:
   ```bash
   npm install
   npm run dev
   ```
5. For Telegram webhook delivery, deploy the API to an HTTPS host and configure Telegram's `setWebhook` with `business_connection` and `business_message` updates.

## Deploy to Vercel (step by step)

This repository is configured for a **single Vercel project**: Vercel serves the Vite dashboard and routes `/api/*` requests to the Express backend through `api/[...path].ts`. You do not need to deploy a separate frontend and backend.

### 1. Import the GitHub repository

1. Push the latest code to GitHub.
2. Open [Vercel New Project](https://vercel.com/new) and sign in.
3. Choose **Import Git Repository**, select `Menelik2/TelegramAgent`, and import it.
4. Select the `root` branch if Vercel asks which branch to deploy.
5. Confirm these project settings:
   - **Framework Preset:** Vite
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
   - **Install Command:** `npm install`
   - **Root Directory:** repository root (leave the default)
6. Before deploying, add the environment variables in the next step. You can also add them under **Project → Settings → Environment Variables** and redeploy afterward.

### 2. Add environment variables

In Vercel, open **Project → Settings → Environment Variables**. Add the following variables to **Production** (and Preview only if you intentionally use test credentials there). Use the exact names below.

| Variable | Required | Value |
| --- | --- | --- |
| `DASHBOARD_API_TOKEN` | Yes | A long, random private token used to authorize dashboard API requests. Generate a unique value and keep it secret. |
| `TELEGRAM_BOT_TOKEN` | Yes | The bot token from Telegram's official BotFather. |
| `TELEGRAM_WEBHOOK_SECRET` | Yes | A random secret made only of letters, numbers, underscores, or hyphens; Telegram uses it to authenticate webhook requests. |
| `OPENAI_API_KEY` | Yes | Your OpenAI API key. |
| `SUPABASE_URL` | Yes | The URL of your Supabase project. |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | The Supabase service-role key from your project's API settings. **Server-side secret only—never add it to a `VITE_*` variable or frontend code.** |
| `OPENAI_MODEL` | No | Optional model name; defaults to `gpt-4o-mini` when omitted. |
| `TELEGRAM_ALLOWED_USER_IDS` | No | Optional comma-separated Telegram user IDs allowed to use owner-level features, if configured by the app. |
| `FRONTEND_URL` | No | Optional public Vercel deployment URL if needed by your configuration. |
| `VITE_API_BASE_URL` | No | Leave blank for this single-project deployment; the dashboard calls the same-origin `/api`. |

**Do not paste credentials into GitHub, README files, screenshots, or chat.** If a secret is accidentally exposed, rotate it with its provider. Make sure all required variables are saved, then redeploy so the functions receive them.

### 3. Apply the Supabase database migrations

1. Open your Supabase project and go to **SQL Editor**.
2. Run each migration file from this repository, in timestamp order, one at a time:
   1. `supabase/migrations/20261026000000_agent_persistence.sql`
   2. `supabase/migrations/20261027000000_agent_memory_contacts.sql`
   3. `supabase/migrations/20261028000000_live_inbox.sql`
   4. `supabase/migrations/20261029000000_serverless_runtime_state.sql`
3. Confirm each script completes successfully before running the next one.

The newest migration adds persistent automation settings. The backend intentionally fails safely when required production persistence is unavailable. Do not enable automation until all migrations have been applied successfully.

### 4. Deploy and verify the app

1. Click **Deploy** in Vercel, or trigger a new deployment after saving environment variables.
2. Wait for the deployment to finish successfully and open the assigned `https://<your-project>.vercel.app` domain.
3. Open `https://<your-project>.vercel.app/api/health`. It should return a healthy response.
4. Open `https://<your-project>.vercel.app/api/status` and check that Telegram, AI, and storage are reported as configured. Do not share responses that contain secrets.
5. Open the dashboard and enter the same `DASHBOARD_API_TOKEN` you saved in Vercel. Keep this token private.

If deployment fails, open the Vercel deployment's **Build Logs** and **Functions/Runtime Logs**. Check that all required environment variables are present and that the project is using the repository root, `npm run build`, and `dist`.

### 5. Connect Telegram Business and configure the webhook

1. Confirm your Telegram bot supports Business connections and connect it from the eligible Telegram Business account's settings. Grant only the permissions it needs.
2. Set the webhook URL to:
   `https://<your-project>.vercel.app/api/telegram/webhook`
3. Configure Telegram's webhook with your actual bot token and the exact same `TELEGRAM_WEBHOOK_SECRET` value saved in Vercel. Run this command in a **private terminal**, replacing the placeholders; do not commit it to the repository:
   ```bash
   curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
     --data-urlencode "url=https://<your-project>.vercel.app/api/telegram/webhook" \
     --data-urlencode "secret_token=<YOUR_TELEGRAM_WEBHOOK_SECRET>" \
     --data-urlencode 'allowed_updates=["business_connection","business_message"]'
   ```
4. Check Telegram's response for `"ok": true`. If it fails, verify the bot token, deployment URL, webhook secret, and that the Vercel deployment is healthy.
5. Send a test message through the connected Business account and verify it appears in the dashboard. First test manual replies and AI simulation with a dedicated test contact.

### 6. Enable automation only after testing

- Automation is **OFF by default**.
- Add only trusted, explicitly permitted contacts to the allowlist.
- Verify inbound messages, saved inbox history, manual replies, and AI-generated reply previews before enabling automatic replies.
- Keep automation off if the webhook, database, allowlist, or AI behavior is not verified.

Vercel deployment does **not** automatically connect your Telegram account or create provider credentials. Those steps require your own Telegram, OpenAI, and Supabase accounts and secrets.

## Human-like multilingual replies

- The reply generator is tuned for natural, context-aware personal messaging rather than generic chatbot phrasing.
- It can mirror English, Amharic (አማርኛ), and mixed-language messages; reply length and tone follow the owner’s saved preferences.
- The generator uses recent stored messages and owner-entered memories when Supabase is configured. Memory is optional and can be disabled.
- Emojis are used sparingly when appropriate. The agent must not invent the owner’s actions or feelings, and it answers honestly if asked whether it is an AI assistant.
- Sensitive requests and high-stakes commitments are escalated for owner review rather than answered automatically.

## Safety defaults

- Automation is OFF by default.
- Only explicitly allowed contacts are eligible for automatic replies.
- Sensitive topics are escalated instead of answered automatically.
- Incoming text is untrusted; it cannot change system policy.
- No Telegram login codes or user-account session scraping.

## Persistence and dashboard authorization

- Apply all migrations in `supabase/migrations/` in timestamp order before production use.
- Configure `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` only on the API host. The service-role key bypasses RLS and must never be exposed to the browser.
- Set a long random `DASHBOARD_API_TOKEN` on the API host. The dashboard's Settings page accepts this token for the current browser session; protected `/api/agent/*` controls and `/api/activity` reject requests without it.
- Without Supabase, development can use in-memory activity/deduplication, but saved memories, saved contact permissions, and the live inbox are unavailable. Do not use in-memory fallback for multi-instance production.

## API abuse protection

- The API applies per-IP, in-memory rate limits to AI simulation (20 requests/minute), manual Telegram replies (30 requests/minute), and Telegram webhook requests (120 requests/minute). Rejected requests receive HTTP 429 and a `Retry-After` header.
- The rate limiter is a lightweight single-process safeguard, not a distributed limiter. For multi-instance or high-traffic production deployments, replace it with a shared store (for example Redis) and enforce limits at the hosting platform or gateway too.
- Do not enable Express proxy trust blindly. If deployed behind a reverse proxy, configure trusted proxy hops explicitly for your hosting environment so client IP rate limits cannot be spoofed.
- The API disables Express's `X-Powered-By` header and limits JSON request bodies. These controls reduce exposure but are not a substitute for an external WAF, monitoring, and incident response.

## Live inbox and remaining limitations

With the Supabase migrations applied, the dashboard can load real Telegram Business conversations, display stored incoming/outgoing text, update explicit contact permissions, and send owner-authored manual replies through the connected business connection. Without a valid dashboard token, the inbox remains in clearly labeled preview mode. AI memory is owner-entered only; the app does not silently learn from private conversations. This is still a single-owner project using a shared dashboard token, not a multi-user product. Before broad production use, add formal user authentication, retention/deletion controls, operational monitoring, and a verified end-to-end Telegram test. Automatic replies remain off after backend restarts and must be explicitly re-enabled.

## Production hardening checklist

The following are still deployment/product limitations and require environment-specific setup or additional implementation before broad public use:

- **Authentication:** the dashboard currently uses a single shared `DASHBOARD_API_TOKEN`, not individual user accounts, MFA, or per-user permissions. Use a proper identity provider before multi-user use.
- **Rate limiting:** current API limits are in-memory and reset on restart; use a shared limiter for multiple server instances.
- **Retention and deletion:** define a data-retention policy and implement owner-facing export/deletion workflows for stored messages, activity events, contacts, and memories. Apply corresponding Supabase retention controls.
- **Monitoring:** configure hosting logs, alerts for repeated 401/429/5xx responses, provider failures, and Telegram delivery failures. Never log secrets or full sensitive message contents.
- **AI security:** regex-based checks catch only known patterns. They cannot reliably detect every paraphrased or indirect prompt injection. Keep automation off for unknown contacts, review high-risk conversations, and test adversarial examples against the configured model.
- **End-to-end validation:** CI and unit tests do not prove live delivery, webhook configuration, Supabase migrations, or provider availability. Perform a controlled Telegram Business test with a dedicated test contact before production.
- **Operational safety:** use a separate test bot/business connection, keep secrets only in the API host, rotate credentials if exposed, and verify backups and incident recovery procedures.
