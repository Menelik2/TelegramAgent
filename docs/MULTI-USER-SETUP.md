# Multi-user Telegram agent

One shared bot can serve independent connected accounts. Each person connects
it through Telegram's Business/Secretary bot settings, chooses permitted chats,
and enables AI processing. Pressing Start alone does not grant inbox access.
The current Telegram documentation says connecting a business bot does not
require Premium. Reply rights apply to eligible private chats with incoming
messages in the last 24 hours. This does not import historical chats, Secret
Chats, or gain access to excluded chats.

Official references:
- https://core.telegram.org/bots/features#business-bots
- https://core.telegram.org/api/bots/connected-business-bots
- https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app

## Operator rollout

1. Apply `supabase/migrations/20261104010000_multi_user_agent.sql`. This creates
   separate tables and functions; it does not delete or migrate legacy history.
   The earlier inbox migration is still required for the legacy admin inbox.
2. In BotFather, enable Business/Secretary support and configure your Mini App
   for `https://YOUR_DOMAIN/dashboard`. Set `APP_BASE_URL` to your HTTPS domain.
   Existing `/my-agent` links remain supported. If `APP_BASE_URL` is absent, the
   bot uses Vercel deployment metadata; it never trusts a request Host header.
3. Configure `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`,
   `TELEGRAM_WEBHOOK_SECRET` and your existing AI credentials. Never expose these
   to users. `CRON_SECRET` is optional for the default webhook processing mode.
4. Set `MULTI_USER_ENABLED=true` and redeploy. It defaults off. When enabled,
   Business and private control messages use the new tenant system exclusively;
   they never fall through to legacy shared memories/settings/inbox. Existing
   owners must connect and opt in to the new account flow too. Legacy data stays
   in the admin dashboard and is not copied into customer accounts.
5. Re-register the webhook using the existing admin setup button so that
   `business_connection`, `business_message`, and `deleted_business_messages`
   and `callback_query` updates are enabled alongside existing types.
6. Leave `TENANT_WORKER_MODE` unset or set it to `webhook` (the default). Each
   authenticated incoming webhook that leaves a pending job starts bounded
   background processing. Vercel uses `@vercel/functions` `waitUntil` so processing
   continues after acknowledgement. A separate worker host and `CRON_SECRET` are
   not required for new incoming replies. The function is configured for 300
   seconds in `vercel.json`; enable Fluid compute if an older Vercel Hobby project
   has it disabled. An ordinary long-lived Node server also processes these tasks.
   Other serverless hosts need their own lifetime support or external mode.
   No additional paid service is provisioned; hosting, AI and database usage still
   count toward your provider limits.
7. Test with two real consenting accounts before inviting 50+ people. Verify
   onboarding, correct identities, permissions, disconnect, pause, cleanup,
   worker operation, AI billing limits and private web access.

## User flow: Telegram and private web dashboard

- `/start`: onboarding and processing disclosure.
- Connect the bot in Telegram settings; select permitted chats and reply rights.
- `/enable`: consent and start replies after a live permission check and service
  configuration checks. Unavailable old connections do not block a valid one.
- Inline buttons also provide enable, pause, status and cleanup controls.
- `/pause`: cancel pending/processing replies. A send already in progress may finish.
- `/status`: saved account status; current rights are checked again before sends.
- `/dashboard`: shows your saved auto-reply status and Enable/Pause controls in
  Telegram, plus a private web dashboard button when a valid HTTPS URL exists.
  Without that URL, Telegram controls still work and explain the missing setup.
  The web dashboard opens as a Telegram Mini App. Telegram's
  signed data authenticates the account; no shared admin token is used. The
  dashboard works inside Telegram on supported mobile/desktop clients. Opening
  the URL in an ordinary browser alone is not a login method. A verified first
  visit can create a paused account before `/start`; it does not grant consent
  or any connection permissions.
- Dashboard: agree to AI processing, then turn on **Enable automatic replies**. The
  switch saves immediately and reflects the server-confirmed state. **Save
  preferences** changes only tone/language; it cannot accidentally enable or
  pause automation. **Pause now** also works with incomplete preference fields.
  Private inbox, manual replies, cleanup and recent queue outcomes remain
  available. Saved status and reply jobs refresh every 30 seconds while visible
  and when returning to the dashboard, without resetting unsaved preferences.
  A failed refresh displays unavailable status rather than claiming auto-reply
  is still on. Reopen after the one-hour signed-session expiry.
- Dashboard and Telegram controls share activation checks. Missing AI credentials,
  absent connections and revoked reply rights produce actionable errors. Only
  explicit external mode requires worker authentication configuration. Enabling
  applies to new messages and does not replay cancelled jobs or import history.
- Pausing does not require AI configuration or current Telegram permissions. If
  the account pauses but queue cancellation fails, the UI reports that partial
  result. Re-enabling cancels leftovers before saving the enabled state.
- `/clearhistory` then `/clearhistory confirm`: erase only that user's stored
  message copies and cancel pending replies. Minimal destination IDs remain.

Selected text/captions are processed. Media-only messages and edited messages do
not generate new automatic replies. Names/usernames are not stored in the tenant
inbox; conversations display chat IDs. Separate chats have separate AI context.

## Isolation and delivery

- Every table read/write is scoped by a server-verified Telegram owner ID.
- Composite foreign keys bind owner, connection and chat. Connection ownership
  cannot be reassigned. Customers cannot access Supabase tables or RPCs directly.
- Mini App HMAC, timestamp and duplicate-field checks reject untrusted identity.
- Business owner, enabled state and reply rights are refreshed from Telegram
  before generation and again immediately before delivery.
- The webhook acknowledges durable ingestion; PostgreSQL jobs deduplicate
  incoming updates and serialize replies per connection/chat across workers.
- Jobs wait at least 10 seconds before becoming eligible; this is not a promised
  10-second delivery time. AI latency, queue length and scheduling add time.
- Each batch processes up to four independent jobs concurrently. An automatic
  invocation handles at most eight batches, with a shared 240-second deadline for
  storage, AI and Telegram requests. It waits for new delayed work once when an
  empty claim finds pending jobs. It does not spin indefinitely on uncertain sends.
  More invocations can claim separate jobs, subject to provider/hosting limits.
- Dismissing a blocked job from the private dashboard also wakes automatic
  processing. Failed/uncertain deliveries themselves are not replayed. The
  webhook and worker endpoint keep their separate authentication checks.
- Stale claims and ambiguous sends become `uncertain`, not automatic retries.
  Later jobs in that chat wait until the user checks Telegram and dismisses the
  uncertain job. Failed generation/delivery jobs appear in the private dashboard.
- Failed jobs are not retried automatically. This favors avoiding duplicate
  private messages. It is not an exactly-once delivery guarantee.
- Cleanup/pause rechecks cancel work before send. An API send already in flight
  cannot be recalled; its successful copy may appear after cleanup.

## Capacity and retention

The schema has no 50-account cap. Tests cover 60 isolated synthetic accounts,
not 50 simultaneous live users or a production throughput guarantee. Actual
capacity depends on message rates, worker concurrency and provider quotas.

`TENANT_DAILY_REPLY_LIMIT` defaults to 100 AI/manual reply attempts per account
per database day (bounded 1–10,000). Attempts reserve budget before external calls;
failed attempts still count. Incoming text storage is capped at 1,000 messages
per account per day. Excess incoming messages are not stored or auto-replied to.

While the worker runs, message copies older than seven days are removed. Completed
job/control dedup metadata expires after seven days; usage totals after 30 days.
Minimal conversation IDs remain until a separate account erasure process is
implemented. In webhook mode, retention runs when a pending job wakes processing;
there is no timer between invocations. With no incoming activity, maintenance can
be delayed beyond seven days. Use an authenticated maintenance worker for scheduled
retention, or clear stored copies manually. The operator must monitor failures.

## Validation and limits

Automated tests use isolated PostgreSQL (PGlite), real Express routes on localhost,
signed synthetic Mini App data and mocked Telegram/AI/PostgREST services. They
cover 60 accounts, cross-account denial, owner binding, consent, deduplication,
queue ordering, AI-context isolation, revoked permissions, pause/cleanup races,
uncertain sends, per-account budgets, manual replies and retention.

No production migration, real customer onboarding, paid hosting provisioning,
live Telegram delivery, or production load test is performed by this change.

Activation regressions cover immediate switch persistence, consent, retry after
failure, independent preference saves, missing configuration, stale connections,
revocation, failed database writes, partial pause failures and delivery through a
simulated webhook/worker flow. React interaction tests run in jsdom. These checks
are not real Telegram client or visual browser testing; no Chromium binary was
available in the implementation environment. See GitHub Actions for validation
of each pushed commit.

Browser interaction tests use pinned jsdom 26.1.0, which supports the Node 20
runtime declared by the project. CI validates both Node 20 and Node 24. This
avoids the newer jsdom/Undici dependency combination that failed before browser
tests could start under Node 20; no tests are skipped to work around it.

## Optional external processing and recovery

For a separate scheduler/worker, set a random `CRON_SECRET` of at least 32
characters and run `npm run worker` with `APP_BASE_URL` and the same secret.
It calls `GET /api/tenant-worker` using `Authorization: Bearer <CRON_SECRET>`
every two seconds after each batch. Never put this secret in the dashboard or
Telegram messages. The endpoint remains locked without it, including in webhook
mode. Set `TENANT_WORKER_MODE=external` only if you want this separate process to
be the sole queue runner. Merely setting a secret does not launch a process.

Background execution is bounded, not a durable scheduler. On storage outages,
function termination, or a burst exceeding the invocation budget, pending jobs
remain in PostgreSQL for a later incoming webhook or an authenticated worker
request. Stale claims and uncertain sends still require user review; they are
never automatically resent. Monitor `tenant_background_worker_failed` logs and
private dashboard job status. A separate maintenance worker is useful for
recovery during idle periods and predictable retention.

The worker-configuration fix needs no new SQL migration beyond the existing
multi-user migration. Redeploy the code, reopen `/dashboard`, enable processing,
and test a new permitted incoming message. Existing cancelled/failed history is
not replayed. Regression tests cover activation without a cron secret, webhook
acknowledgement before background work, duplicate and concurrent updates, delay,
pause/revocation/cleanup, uncertain sends, storage errors and operation deadlines.

Vercel references:
- https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package#waituntil
- https://vercel.com/docs/functions/configuring-functions/duration
