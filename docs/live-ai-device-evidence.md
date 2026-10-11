# Live Claude native acceptance

The opt-in `LiveAgentUITests/testLiveClaudeClarificationCreationModificationAndSystemReceipt` exercises the production native connection and conversation views with an actual Anthropic Claude Sonnet 5.5 endpoint, published Pi 1.1.0, Fastify, PostgreSQL 17, and pg-boss. No model output is substituted. A private `LiveAgentFixture.json` supplies only the isolated HTTPS server, one-use pairing code, synthetic instruction/answer/change, and fixture proof URL. The API key is read by the server from the administrator-authorized external secret file and is never included in the phone or test bundle.

The test consumes actual public API task/run/history projections through a private proof endpoint; it does not query the database. It obtains the model's actual clarification text from the public run, rather than assuming wording or title. Each run must remain within one to three provider requests and six tool calls, with all request usage resolved. Ordinary CI skips this test without the private fixture.

## Observed first attempt

2026-10-11, signed iPhone 17 Pro / iOS 27.2. The live provider asked for a missing clock time, the phone restored that question after relaunch, and the linked `15:30` answer created a single task with `local_installed`. An explicit `改成15:45` edit safely returned `needs_clarification` with `请明确修改、完成或取消。`; the task stayed at revision 1. This attempt failed the edit acceptance rather than treating the clarification as successful. Three runs used one request and one tool each; combined usage estimate was USD 0.0154394, not a supplier invoice.

The failure reproduced the missing `propose_change.operation` enum and incorrect tool description found by live evaluation. The minimal tool-contract correction was applied before the next model attempt. A harness-only retry then restored an obsolete Keychain connection because iOS uninstall retains Keychain records; it stopped before pairing and made zero model requests. The next retry uses a distinct temporary bundle so both application data and Keychain access group are isolated.

## Boundaries

Programmatic committed Unicode and Enter submission do not verify marked-text Chinese IME composition or a physical Shift+Enter gesture. Those acceptance items remain open. OS pending plus a local receipt confirms installation, not that the user has seen the scheduled reminder. Usage prices are estimates and are not claimed as invoices.

## Successful corrected attempt and cleanup

The corrected build passed on the same signed physical iPhone: **one test, zero failures, 70.212 seconds**, completed 2026-10-11 at 16:41:12 PDT. Real Claude generated a missing-time clarification; relaunch preserved the dynamic question; the linked answer saved one task; `改成15:45` updated that same task to revision 2 with a different instant. The phone reread the latest history after another relaunch. The native read-only inspector confirmed actual OS pending count 1 and generic private notification preview. The public API reported `local_installed` after creation and modification.

All three runs used one request and one tool each, with no unresolved usage. Corrected-attempt usage estimate: **USD 0.0164388**; both actual provider attempts combined: **USD 0.0318782**. Each isolated fixture used a USD 1 budget, with total acceptance capped at USD 2. This is a usage estimate, not an invoice.

The successful test revoked and disconnected its isolated session through the production native UI. Afterward the worker/API and tunnel stopped, independent database deletion was verified (zero matching fixture databases), and both temporary app/runner bundles were uninstalled. The private pairing JSON, transient fixture script, tunnel log, and derived build/results containing private fixture resources were deleted. Retained test logs were scrubbed of fixture URLs and codes: `/tmp/nivli-live-device.log` (success), `/tmp/nivli-live-device-before-fix.log` (actual operation failure), `/tmp/nivli-live-device-keychain-retry.log` (harness-only failure). Default project bundle/signing configuration is restored. The user's existing Nivli app and data were not replaced or erased.
