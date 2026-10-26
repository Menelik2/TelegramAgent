# TelegramAgent — Personal AI Inbox Assistant

A full-stack Telegram Business AI assistant with a modern dashboard, explicit contact allowlists, AI-generated replies, memory controls, and safety-first automation.

## Important Telegram limitation
This app uses the official Telegram Bot API's Business connection updates (`business_connection`, `business_message`) and sends replies with `business_connection_id`. It cannot read arbitrary messages from a normal personal account without an authorized supported connection. The owner must connect an eligible bot/account and grant permissions. See [Telegram Bot API](https://core.telegram.org/bots/api) and [Connected business bots](https://core.telegram.org/api/bots/connected-business-bots).

## Stack
- React + TypeScript + Vite + Tailwind CSS
- Node.js + TypeScript + Express
- Supabase Postgres/Auth (optional for persistent multi-user deployment)
- OpenAI-compatible AI provider
- Telegram Bot API Business integration

## Quick start
1. Install Node.js 20+.
2. Copy `.env.example` to `.env` and fill in credentials.
3. `npm install`
4. `npm run dev` starts frontend and API in parallel.
5. For webhook delivery, deploy the API to an HTTPS host and configure Telegram `setWebhook` with `business_connection` and `business_message` updates.

## Safety defaults
- Automation is OFF by default.
- Only explicitly allowed contacts are eligible for automatic replies.
- Sensitive topics are escalated instead of answered automatically.
- Incoming text is untrusted; it cannot change system policy.
- No Telegram login codes or user-account session scraping.

## Persistence and dashboard authorization
- Apply `supabase/migrations/20261026000000_agent_persistence.sql` in the Supabase SQL Editor.
- Configure `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` only on the API host. The service-role key bypasses RLS and must never be exposed to the browser.
- Set a long random `DASHBOARD_API_TOKEN` on the API host. The dashboard's Settings page accepts this token for the current browser session; protected `/api/agent/*` controls and `/api/activity` reject requests without it.
- Without Supabase, development falls back to in-memory event/deduplication storage. That fallback is not durable and is not safe for multi-instance production.

## Deployment
Deploy the frontend to Vercel and the API to a persistent Node.js host. Configure all secrets server-side. `TELEGRAM_WEBHOOK_SECRET` must match the secret token configured with Telegram's `setWebhook` call. See `.env.example` and `docs/DEPLOYMENT.md`.

## Current implementation scope
This repository provides the working application foundation, dashboard, API endpoints, webhook handling, policy checks, AI adapter, and a lightweight in-memory development store. For production multi-user use, configure Supabase persistence, Redis-backed durable jobs, managed encryption keys, monitoring, and external integration tests before enabling real auto-replies.