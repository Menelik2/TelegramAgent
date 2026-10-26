# TelegramAgent — Personal AI Inbox Assistant

A full-stack Telegram Business AI assistant with a modern dashboard, explicit contact allowlists, AI-generated replies, memory controls, and safety-first automation.

## Important Telegram limitation
This app uses the official Telegram Bot API's Business connection updates (`business_connection`, `business_message`) and sends replies with `business_connection_id`. It cannot read arbitrary messages from a normal personal account without an authorized supported connection. The owner must connect an eligible bot/account and grant permissions. See [Telegram Bot API](https://core.telegram.org/bots/api) and [Connected business bots](https://core.telegram.org/api/bots/connected-business-bots).

## Stack
- React + TypeScript + Vite + Tailwind CSS
- Node.js + TypeScript + Express
- Supabase Postgres (required for durable inbox, memory, contact permissions, and activity history)
- OpenAI-compatible AI provider
- Telegram Bot API Business integration

## Quick start
1. Install Node.js 20+.
2. Copy `.env.example` to `.env` and fill in credentials.
3. `npm install`
4. `npm run dev` starts frontend and API in parallel.
5. For webhook delivery, deploy the API to an HTTPS host and configure Telegram `setWebhook` with `business_connection` and `business_message` updates.

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
- Apply all migrations in `supabase/migrations/` in timestamp order: webhook/activity persistence, saved contacts and memories, then live inbox history.
- Configure `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` only on the API host. The service-role key bypasses RLS and must never be exposed to the browser.
- Set a long random `DASHBOARD_API_TOKEN` on the API host. The dashboard's Settings page accepts this token for the current browser session; protected `/api/agent/*` controls and `/api/activity` reject requests without it.
- Without Supabase, development can use in-memory activity/deduplication, but saved memories, saved contact permissions, and the live inbox are unavailable. Do not use in-memory fallback for multi-instance production.

## Deployment
The project is configured for a **single Vercel deployment**: Vite serves the dashboard and `api/[...path].ts` routes `/api/*` to the Express backend. Configure `DASHBOARD_API_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `OPENAI_API_KEY`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` in Vercel Project Settings. Apply all SQL migrations in `supabase/migrations/` in timestamp order before enabling automation. Leave `VITE_API_BASE_URL` blank so the dashboard calls the same-domain API. Follow [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the exact setup and Telegram webhook instructions.

## API abuse protection

- The API applies per-IP, in-memory rate limits to AI simulation (20 requests/minute), manual Telegram replies (30/minute), and Telegram webhook requests (120/minute). Rejected requests receive HTTP 429 and a `Retry-After` header.
- The rate limiter is a lightweight single-process safeguard, not a distributed limiter. For multi-instance or high-traffic production deployments, replace it with a shared store (for example Redis) and enforce limits at the hosting platform or gateway too.
- Do not enable Express proxy trust blindly. If deployed behind a reverse proxy, configure trusted proxy hops explicitly for your hosting environment so client IP rate limits cannot be spoofed.
- The API disables Express's `X-Powered-By` header and limits JSON request bodies. These controls reduce exposure but are not a substitute for an external WAF, monitoring, and incident response.

## Live inbox and remaining limitations
With the three Supabase migrations applied, the dashboard can load real Telegram Business conversations, display stored incoming/outgoing text, update explicit contact permissions, and send owner-authored manual replies through the connected business connection. Without a valid dashboard token, the inbox remains in clearly labeled preview mode. AI memory is owner-entered only; the app does not silently learn from private conversations. This is still a single-owner project using a shared dashboard token, not a multi-user product. Before broad production use, add formal user authentication, rate limiting, retention/deletion controls, operational monitoring, and a verified end-to-end Telegram test. Automatic replies remain off after backend restarts and must be explicitly re-enabled.

## Production hardening checklist

The following are still deployment/product limitations and require environment-specific setup or additional implementation before broad public use:

- **Authentication:** the dashboard currently uses a single shared `DASHBOARD_API_TOKEN`, not individual user accounts, MFA, or per-user permissions. Use a proper identity provider before multi-user use.
- **Rate limiting:** current API limits are in-memory and reset on restart; use a shared limiter for multiple server instances.
- **Retention and deletion:** define a data-retention policy and implement owner-facing export/deletion workflows for stored messages, activity events, contacts, and memories. Apply corresponding Supabase retention controls.
- **Monitoring:** configure hosting logs, alerts for repeated 401/429/5xx responses, provider failures, and Telegram delivery failures. Never log secrets or full sensitive message contents.
- **AI security:** regex-based checks catch only known patterns. They cannot reliably detect every paraphrased or indirect prompt injection. Keep automation off for unknown contacts, review high-risk conversations, and test adversarial examples against the configured model.
- **End-to-end validation:** run CI and perform a controlled Telegram Business test with a dedicated test contact before production. Unit tests do not prove delivery, webhook configuration, Supabase migrations, or provider availability.
- **Operational safety:** use a separate test bot/business connection, keep secrets only in the API host, rotate credentials if exposed, and verify backups and incident recovery procedures.
