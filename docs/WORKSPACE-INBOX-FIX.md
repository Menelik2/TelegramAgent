# Workspace / Inbox behavior fixes

The previous refresh rebuilt the conversation list with empty message arrays.
Because the selected conversation ID did not change, the history effect did not
run again. Refreshing or successfully sending a reply could therefore blank the
open conversation. A shared draft also carried text into a different chat, and
late pagination responses could change the newly selected chat's history offset.

The inbox now uses a dedicated credential-scoped controller:

- Refresh preserves displayed history until the selected thread reloads.
- Confirmed sends reload history without discarding another chat's draft.
- Drafts belong to individual conversations; duplicate send clicks are blocked.
- Stale list/history/page responses cannot overwrite the current credential or
  conversation scope. Signing out/changing credentials erases cached inbox data.
- History loading, empty history and request failures have separate states.
- Older pages deduplicate message IDs and do not change another chat's pagination.
- Cleanup invalidates pending reads, preserves conversation selection and reports
  failures without pretending copies were deleted.
- Contact permissions are shown as unavailable if their API fails; this never
  falsely displays them as manual or permits toggling an unknown permission.
- A successful sender permission change updates all threads for that sender.
- The visible Inbox refreshes every 15 seconds, except while a send/cleanup/load
  is in progress or the user has loaded more than 100 older messages.
- Enter during IME composition and Shift+Enter do not send a message.
- When multi-user mode is enabled, the administrator Workspace identifies itself
  as the legacy inbox and directs users to their private Telegram dashboard.
  It does not aggregate or expose other tenants' conversations.
- Missing metadata migrations produce an actionable error naming the SQL file.

Validation uses mocked network responses and React DOM tests in jsdom. It covers
real Workspace navigation, refresh/send controls, per-chat drafts, mobile back
navigation state, cleanup and IME behavior, plus request-race regressions.
Chromium installation was attempted but the download returned an invalid archive;
no visual browser or live Telegram verification is claimed. No production cleanup
or database migration is performed by this change.
