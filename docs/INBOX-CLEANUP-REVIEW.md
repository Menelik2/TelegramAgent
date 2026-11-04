# Inbox cleanup fix — November 4, 2026

Prepared against root commit `0a01cd6f26638804ae92a7704e4bfa931e8162c2`.
GitHub CI run 41808179707 succeeded for that base commit. This document records
the implementation and local validation; production migration is a separate step.

## Finding and proposed behavior

The original cleanup deletes agent_messages. listInbox derives all destinations
from at most 500 message rows, and manual replies search that list. The dashboard
also explicitly empties its contacts after cleanup. This confirms the code-level
failure path; it is not evidence of a production incident.

The proposal introduces agent_conversations, keyed by the exact Business
connection ID and chat ID (including existing group sender scopes). It retains
only those IDs, sender ID, last activity timestamp, and last direction. Sender ID
supports the existing contact permission display and reply audit association.
Names, usernames, message text, previews and Telegram message IDs are NOT copied
into metadata. After cleanup, conversations are shown by numeric ID until new
history supplies a display name. Metadata does not grant permission to send.

A transactional migration backfills ALL existing destinations, not just the
latest 500 messages. An insert trigger maintains metadata atomically with message
writes; failed writes roll back both. Older incoming updates cannot regress the
activity timestamp. A security-invoker view joins only currently retained message
history for previews and counts. Both tables and the view are service-role only.

The cleanup RPC deletes message copies in one transaction and returns the actual
row count without returning all deleted IDs. It does not touch permission,
owner, memory, event, or conversation tables, and makes no Telegram API calls.
If the migration is absent or storage fails, the app reports an error; there is
no fallback to the old destructive cleanup route. Inserts concurrent with cleanup
preserve their destination metadata through the trigger. Separate-session
concurrency/load testing against Supabase remains outstanding.

Manual replies use an exact metadata destination lookup, independent of list
pagination. They still require dashboard authentication and a known conversation.
Business replies additionally recheck the current Telegram connection ID, enabled
state, owner membership and can_reply rights (modern rights field or legacy field).
Disabled connections, removed owners, revoked reply rights and mismatched
connections fail closed. Telegram send errors remain delivery failures.
Group allowlist checks remain in place. A contact's auto-reply switch continues to
mean manual-only when off; cleanup never enables it or changes its value.

The UI retains conversation selection, erases displayed history and previews,
resets history pagination, and refreshes conversation metadata after cleanup.

## Files

- server/store.ts: RPC cleanup, paged metadata list and exact destination lookup.
- server/index.ts: metadata lookup and stricter current Business reply checks.
- src/App.tsx: preserve conversation access after cleanup.
- supabase/migrations/20261104000000_inbox_conversations.sql: table, backfill,
  trigger, service-only view and cleanup RPC.
- server/inbox-cleanup.test.ts: isolated SQL and HTTP regression coverage.
- package.json: PGlite development dependency for PostgreSQL regression tests.

## Validation

- Automated suite: 84 passing tests across 9 files; 13 new cleanup tests.
- TypeScript: frontend, server and Vercel checks passed.
- Production build: server compilation and Vite build passed.
- Local smoke: 8 checks passed with a clean environment and no external credentials.
  Authenticated smoke checks were skipped by that script; the regression tests
  independently exercised authenticated cleanup and reply HTTP routes.
- Lint: passed after adding ESLint 9 TypeScript configuration and fixing existing
  unused variables/imports and unnecessary escapes. CI now runs lint as well.
- Diff whitespace check: passed.

New regressions execute SQL in PGlite (PostgreSQL compiled to WebAssembly) and run
real Express routes on localhost. A simulated PostgREST transport maps supported
requests into that isolated database; Telegram responses and owner configuration
are mocked. Rate-limit middleware is bypassed in these route tests; existing
rate-limiter tests still run. No production credentials or data are used.

Coverage includes backfill, cleanup idempotence/counts, metadata persistence,
1,100 destinations, scoped routing, post-cleanup manual delivery, authentication,
confirmation requirements, Business revocation/ownership/scope errors, group
allowlist failure, storage failure, SQL rollback, anonymous access denial,
Telegram send failure, and successful delivery with a failed history-copy write.

No live Telegram send, real Supabase migration, browser interaction test, or
production cleanup was performed. This is not a claim of live delivery success.

## Rollout requirements for later approval

Review and apply the migration before deploying the application changes. The
migration takes a write lock while backfilling; schedule according to table size.
It does not delete any history. Do not run cleanup as part of deployment.
Existing metadata cannot reconstruct destinations whose history was already
deleted before migration; those need a new message or a separately approved
recovery source. New messages can appear after cleanup, as expected.

Deleted rows free logical history storage; PostgreSQL may reuse the space rather
than immediately reduce allocated disk size. Cleanup does not erase other data
stores such as memories or activity records. Retained IDs are still personal data;
this operation is history cleanup, not a complete account-data erasure feature.
A separate destination-forgetting flow can be designed if complete removal is
needed. Deploying, pushing, applying migration, and deleting production history
require authorization. The user authorized pushing these changes to GitHub;
production migration and cleanup have not been performed.
