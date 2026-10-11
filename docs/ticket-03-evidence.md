# Ticket 03 — local time reminders

## Server and public contract

The primary iPhone supplies `localDeviceId` when saving a manual reminder. In the same PostgreSQL transaction as the task and idempotency result, the server saves a local occurrence, reminder revision, routing version and stable system request identity. The instant can be beyond 24 hours. Calls without a device preserve ticket 02's honest `not_scheduled` result.

`GET /v1/devices/{id}/notification-plans` returns the authenticated device's current active local plans, including installed plans for reconciliation. `POST` verifies owner, current session/device, current task/reminder revision, routing version and exact request identity. Installation receipts are idempotent and do not activate a server delivery path. Failed receipts distinguish permission, product capacity and installation errors. Opening the task detail is read-only.

The default quiet interval is 22:00–08:00 in the reminder's IANA zone. A saved local reminder in this interval starts as `needs_confirmation`; installation receipts are rejected until the user explicitly confirms. UTC instants remain unchanged, including around daylight saving changes.

The dedicated `migrateLocalNotifications` migration upgrades the original restrictive reminder status CHECK and creates `local_occurrence`. Startup verifies that this table exists. No feature changes the global schema version in this ticket.

## Verification

- `npm run build`: passed.
- `npm test`: 25 tests passed across pairing, task and Gmail public HTTP suites after merging integration commit `0424ac1`, using isolated real PostgreSQL databases and real pg-boss initialization.
- The local intent test first failed with HTTP 422 before the implementation, then passed.
- The HTTP suite exercises an actual ticket-02 schema fixture (original status CHECK, no occurrence table), migrates it, and then saves local plans.
- Coverage includes creation beyond the rolling window, stable plan identity after application restart, installation ack recovery/repetition, stale routing/reminder versions, wrong system request identity, wrong device, unauthenticated plan access, receipt transport key conflict/replay, quiet confirmation, denied permission and capacity failure with no server fallback.
- OpenAPI and both notification plan JSON examples exported and validated against TypeBox using a migrated isolated database. These examples are also available for Swift contract decoding.

## Native evidence

- `swift test --package-path ios`: 11 tests passed. Native notification seam tests use the real SQLite journal and a substituted OS notification boundary. They cover denied permission, quiet hours, conservative capacity, lost receipt/restart recovery without duplicate request identity, and exact published plan/receipt JSON DTO decoding.
- Generic iOS build passed after merging the Gmail integration. Log: `/tmp/nivli-03-merged-build.log`.
- SwiftUI supports saved/not-ready reasons, settings link, explicit quiet-hours confirmation and read-only current notification detail. Logout removes this identity's pending and delivered requests and clears its journal.
- Connected physical iPhone: `testNotificationPlatformCapacityRecoveryAndBackgroundDelivery` passed, 1 test / 0 failures, 20.031 seconds. Result: `/tmp/nivli-03-device/Logs/Test/Test-Nivli-2026.10.11_15-00-13--0700.xcresult`. The production adapter installed 16 requests visible in OS pending state, rejected the next request at the conservative product budget, and recovered the same request after reopening the SQLite journal. This verifies the initial supported budget; it does not claim an iOS system maximum.
- The same device test scheduled a generic notification, backgrounded the app, observed the actual `Nivli 提醒` banner (`NIVLI_NOTIFICATION_BANNER_OBSERVED true` in `/tmp/nivli-03-device.log`), then verified the request left pending state and appeared in delivered state.
- Locked/offline display and real permission-off behavior remain unverified. A Settings toggle attempt did not yet establish the expected denied result, so it is not reported as passing. The native agent continues this evidence work separately while the user prioritizes the AI agent path. Ticket 03 is not closed.
- Accessibility audits are waived by the user's explicit scope adjustment. Functional and privacy acceptance remain.
