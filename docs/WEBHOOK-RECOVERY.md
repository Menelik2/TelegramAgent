# Webhook delivery recovery

In the admin workspace, open **Settings → Telegram webhook → Check delivery**.
This authenticated check reads schema only (`limit=0`) and Telegram webhook
status. It does not send Telegram messages, write message copies or delete data.

- **Setup needs attention** lists missing server variables, inaccessible storage,
  or the migration corresponding to a missing table/column. Apply missing
  migrations with their prerequisites in the intended Supabase project. Do not
  rerun every historical migration: some create objects without `IF NOT EXISTS`.
  The per-chat migration `20261105010000_tenant_chat_ai.sql` is safe to rerun.
- Change server variables in the deployment environment, then redeploy. Keep
  the service-role key server-side. An anon/publishable key is insufficient.
- Confirm `APP_BASE_URL` points to the public production site. Configuration
  normalizes it to an HTTPS origin and does not derive it from request headers.
- Use **Configure webhook** after fixing setup. It preserves pending updates
  (`drop_pending_updates=false`). Failed schema reads block registration.
- **Last reported error** includes Telegram's timestamp. `last_error_message`
  describes the most recent recorded delivery failure; it does not prove the
  latest registration attempt failed. Pending count and a fresh test are needed.
- Successful database read checks do not verify writes, sequences, RPC bodies,
  AI availability or end-to-end delivery. With consent, send one new allowed
  incoming message and inspect the inbox, activity and delivery status.

When `MULTI_USER_ENABLED=true`, the webhook uses private-account storage
exclusively, even though registration is managed in the administrator workspace.
Schema checks follow that mode. Never disable isolation as a storage workaround.
Missing tenant RPC/schema failures are logged as `webhook_processing_failed`
with a migration hint where known, without message content or credentials.
If reads pass but delivery keeps failing, inspect Vercel function logs for the
actual failed operation and check Supabase write/RPC privileges and availability.

## Retry behavior

A legacy/admin incoming copy can save successfully before an automation-state,
provider or Telegram error occurs. Previously, the next attempt inserted that
same copy, hit the unique update/direction constraint and returned another 503.
The storage layer now recognizes an exact existing copy after a unique conflict.
It verifies the connection, chat, sender, direction, message ID and text before
continuing. Different content/destinations and unavailable storage still fail.
No migration is required for this retry fix.

Real failures before sending remain retryable. Missing deduplication storage
and unreadable saved contact permissions fail closed. The environment allowlist
cannot override a saved revocation during a database outage. Pause, contact
permission and Business rights are rechecked after AI generation and delay.

A network failure or malformed response after an outbound send starts can mean
Telegram already delivered it. Such an update keeps its durable claim and is
acknowledged without automatically sending again. Activity records
`delivery_uncertain`; check Telegram before manually replying. A confirmed
Telegram rejection (`ok=false`) remains retryable. This is not an exactly-once
send guarantee or a durable queue for legacy admin replies; a process termination
can still require operator review. Private-account replies use their separate
job queue and uncertainty controls.

## Validation

Regression tests reproduce the duplicate-copy 503 loop and recovery with mocked
PostgREST, Telegram and AI calls through real local Express routes. They also
cover confirmed/ambiguous send failures, pauses, revoked/unavailable permissions,
missing schema/credentials, historical errors and authenticated diagnostics.
These are simulated service responses, not live Telegram or production database
tests. UI tests exercise the persistent recovery panel.

References:
- https://core.telegram.org/bots/api#setwebhook
- https://core.telegram.org/bots/api#webhookinfo
