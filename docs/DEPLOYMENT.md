# Deployment guide

## 1. Requirements
- Node.js 20+
- A Telegram bot eligible for Business connections
- An OpenAI API key (kept on the backend only)
- An HTTPS URL for the webhook
- A persistent Node.js host for the API; Vercel is suitable for the static frontend

## 2. Configure Telegram
1. Create a bot with @BotFather.
2. Enable the supported Business/Secretary functionality for the bot in BotFather, if available to the account.
3. Deploy the API and set `TELEGRAM_BOT_TOKEN` and a long random `TELEGRAM_WEBHOOK_SECRET`.
4. Connect the bot from Telegram Business settings and grant only the required rights.
5. Configure the webhook with the `business_connection` and `business_message` update types. Example (run privately; do not commit the token):

```bash
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://YOUR-API-HOST/api/telegram/webhook","secret_token":"YOUR_WEBHOOK_SECRET","allowed_updates":["business_connection","business_message"]}'
```

Telegram sends the secret in `X-Telegram-Bot-Api-Secret-Token`. The API verifies it before processing updates. See the official [Bot API](https://core.telegram.org/bots/api) documentation.

## 3. Configure environment
Copy `.env.example` to your local environment or configure secrets in your host's dashboard. Set `TELEGRAM_ALLOWED_USER_IDS` to a comma-separated allowlist of numeric Telegram sender IDs. Do not use display names or usernames as authorization identifiers.

Set `OPENAI_API_KEY` and optionally `OPENAI_MODEL`. Never expose the key through a Vite `VITE_*` variable or browser bundle.

## 4. Run locally
```bash
npm install
cp .env.example .env
npm run dev
```

Frontend: `http://localhost:5173`  
API health: `http://localhost:8787/api/health`

## 5. Deploy
- Deploy the frontend to Vercel using `vercel.json`.
- Deploy the API to a persistent Node.js host with the root directory set to the repository.
- Configure `FRONTEND_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_ALLOWED_USER_IDS`, and `OPENAI_API_KEY` on the API host.
- Set Telegram's webhook URL to the deployed API URL.
- Run `npm run typecheck`, `npm test`, and `npm run build` before enabling live replies.

## Production hardening still required
Supabase-backed webhook idempotency and minimal activity logging are available when configured; the in-memory fallback remains for local development only. Dashboard control routes use a shared `DASHBOARD_API_TOKEN`, suitable only as a small single-owner gate behind HTTPS. Before multi-user production, replace it with proper user authentication and per-user authorization, use a durable queue and managed secrets, add monitoring/rate limits, and implement a tested retention/deletion workflow. The inbox and contact list still include illustrative sample conversation data; contact toggles are not yet persisted as the server allowlist. Do not treat demo conversation rows as live Telegram data.
