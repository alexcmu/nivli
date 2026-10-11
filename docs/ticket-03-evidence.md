# Ticket 03 — local time reminders

## Server and public contract

The primary iPhone supplies `localDeviceId` when saving a manual reminder. In the same PostgreSQL transaction as the task and idempotency result, the server saves a local occurrence, reminder revision, routing version and stable system request identity. The instant can be beyond 24 hours. Calls without a device preserve ticket 02's honest `not_scheduled` result.

`GET /v1/devices/{id}/notification-plans` returns the authenticated device's current active local plans, including installed plans for reconciliation. `POST` verifies owner, current session/device, current task/reminder revision, routing version and exact request identity. Installation receipts are idempotent and do not activate a server delivery path. Failed receipts distinguish permission, product capacity and installation errors. Opening the task detail is read-only.

The default quiet interval is 22:00–08:00 in the reminder's IANA zone. A saved local reminder in this interval starts as `needs_confirmation`; installation receipts are rejected until the user explicitly confirms. UTC instants remain unchanged, including around daylight saving changes.

The dedicated `migrateLocalNotifications` migration upgrades the original restrictive reminder status CHECK and creates `local_occurrence`. Startup verifies that this table exists. No feature changes the global schema version in this ticket.

## Verification

- `npm run build`: passed.
- `npm test`: 20 tests passed across pairing and task public HTTP suites, using isolated real PostgreSQL databases and real pg-boss initialization.
- The local intent test first failed with HTTP 422 before the implementation, then passed.
- The HTTP suite exercises an actual ticket-02 schema fixture (original status CHECK, no occurrence table), migrates it, and then saves local plans.
- Coverage includes creation beyond the rolling window, stable plan identity after application restart, installation ack recovery/repetition, stale routing/reminder versions, wrong system request identity, wrong device, unauthenticated plan access, receipt transport key conflict/replay, quiet confirmation, denied permission and capacity failure with no server fallback.
- OpenAPI and both notification plan JSON examples exported and validated against TypeBox using a migrated isolated database. These examples are also available for Swift contract decoding.

## Native evidence

Native implementation and device verification are recorded below when completed. Backend passing tests alone do not prove that iOS displayed a notification while locked or offline.
