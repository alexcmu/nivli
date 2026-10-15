# Ticket 09 — bounded runs and recovery

Validated 2026-10-11 against PostgreSQL 17, actual pg-boss workers and the published Pi 1.1.0 adapter. Only the external Anthropic HTTP service is controlled. Tests use isolated databases and synthetic input; no live Claude API success is claimed.

## Public HTTP and queue behavior

`test/agent-recovery.test.ts` contains seven public-boundary scenarios:

1. Two competing real workers reserve one UTC day's input/output budget atomically. Three submissions yield exactly one provider request, one saved result and two actionable budget failures. The manual task API remains available. Admin model validation shares the same budget and returns 409 without an external request after exhaustion. Provider payload honors the configured 512-token output cap.
2. Cancelled runs preserve original input/time zone, retain unknown request fees, reject late provider proposals and do not start further requests. Replayed cancellation stays cancelled.
3. A shortened test deadline exercises the same default 60-second hard deadline: late output cannot commit; retry retains input/run identity; cancelling an already successful run leaves its real task intact.
4. An actual child process is killed with SIGKILL before an unconfirmed request completes. Expired lease recovery makes the second external request and saves exactly one stable business result. The recovered worker is then killed after the successful transaction. Another worker restart makes no third request and leaves one task.
5. Advancing the injected clock past 20 seconds reports `running/stillProcessing` while the manual HTTP task API remains responsive.
6. Enabled HTTP logging excludes the synthetic original input, model key, access token and admin secret.
7. Provider-reported usage above the conservative reservation is charged, remaining budget floors at zero, and later requests fail before reaching the provider.

The recovery fixture also upgrades an earlier notification schema and v3 agent schema without budget/cancellation/deadline/lease fields to v4 before exercising the HTTP flows. The migration remains additive for existing identity/tasks; old clarification states become `needs_clarification`. v4 readiness refuses an unmigrated database.

The combined agent/conversation tests cover every run state, raw tool/request limits, clarification versus failure, durable context, owner isolation and revision conflicts. The full backend suite passed with 51 tests in 6 files. `npm run build` passed. OpenAPI and all published JSON examples were exported and validated using an isolated, migrated v4 database; the shared fixture database was not altered merely to run contract export.

## Native and resource isolation

The Swift client understands queued/running/needs_clarification/succeeded/failed/cancelled/timed_out, polls persisted runs after returning to the page, preserves drafts and failed input identities in Keychain, exposes cancellation/retry/manual controls, and distinguishes usage estimates, reserved estimates and unconfirmed usage from provider invoices. Conversation history and current task cards come from the server; a model reply cannot manufacture a saved task identity.

`swift test --package-path ios`: 14 tests passed. Generic iOS build passed with `xcodebuild -project ios/Haiji.xcodeproj -scheme Haiji -destination 'generic/platform=iOS' -derivedDataPath /tmp/haiji09-generic CODE_SIGNING_ALLOWED=NO build`; local log `/tmp/haiji09-generic.log`.

API, agent and delivery run as independent processes/queue roles; each agent worker has concurrency 1. The HTTP tests establish that slow or budget-blocked agent work does not occupy the manual API. Installed local reminders do not call the model: ticket 03's real-system evidence includes the user's observation of a reminder while the test iPhone was locked and offline. This ticket does not claim APNs or future server reminder delivery consumers are implemented.

## Accounting and limits

API and worker share `MODEL_DAILY_BUDGET_USD` (default 1 USD, 0–10000) and `MODEL_MAX_OUTPUT_TOKENS` (default 1024, 128–1024). Budget reset is UTC midnight. Every admitted model request reserves 65536 input tokens plus the output cap, including bounded context/tools/provider framing. Known usage settles conservatively; unknown usage after interruption retains the entire reservation. Retry can repeat model charges. Admin `/v1/admin/model/budget` and run `cost` expose estimates, usage and unknown requests with `invoiceAvailable:false`.

The explicitly enabled CLI smoke has its own bounded testing budget (default 0.5 USD, maximum 1 USD), reports that it does not share the production budget, and never writes a business entity. No API key was available for a live provider smoke. That ticket 07 acceptance remains open; controlled-provider tests are evidence of lifecycle behavior only.
