# AI review fixes — 2026-10-11

Scope: review findings for tickets 07–09, based on integration `8a10665`.

- Model-proposed edits, completion and cancellation require affirmative current authority. Negation, conditional wishes and status questions clarify without changing task revision, reminder, deadline or source evidence. Public HTTP regressions include `这个还没完成`, `没完成`, `尚未取消`, `如果下雨再取消`, `下雨了就取消`, `not completed`, `unfinished`, `It isn't completed`, conditional edits and status questions. `已完成`, `already completed` and polite `Can you complete this task?` remain valid.
- A persisted native draft keeps cancellation/retry identities through transport uncertainty and relaunch. Only acknowledgement of the matching retry retires the previous cancellation key. Repeated old acknowledgement cannot discard the new cancellation operation. The public HTTP sequence cancels a slow attempt, retries the same input/run, replays the old cancellation operation without stopping the new attempt, then cancels with a new operation. Both late provider outputs produce no task.
- Explicit deadlines cannot disappear from a saved result. Omitted and unresolved deadlines clarify. `明天九点提醒提交材料，周五截止` saves a tomorrow reminder and an independent date-only Friday deadline. Unqualified weekday deadlines use the next future calendar weekday in the original input timezone. Explicit ISO dates remain supported; timed or otherwise unsupported deadline expressions clarify.
- Relative interpretation uses original input receipt time, including queued runs crossing local midnight. Commit-time validation still rejects a reminder that has become past; timeout, budget and authorization checks keep the current clock. Public tests cover the midnight boundary and a reminder that expires while queued.
- Task creation and task actions share one current 22:00–08:00 quiet-hours predicate; the unused copy in task routes was removed.

Validation:

- Authorization and deadline omission each first reproduced a failing public regression, then passed with the fixes.
- `npm run build`: passed.
- `npm test`: 6 files / 57 tests passed, including real PostgreSQL, pg-boss and Pi with a controlled external Anthropic HTTP service (67.34 s). Final additional negative/contraction cases passed in the targeted authority test (17.34 s).
- Targeted deadline / repeated cancellation / midnight tests: 3 passed (9.78 s).
- `swift test --package-path ios`: 15 tests passed, including persisted client lifecycle operation identity.
- Generic iOS Simulator build: passed, log `/tmp/nivli-review-build.log`.
- Evaluation labels now contain 51 cases, with the independent Friday deadline checked by the opt-in evaluator. Evaluation invocation without explicit credentials remains `not_run`, with zero results; no real Claude request or model outcome is claimed.

No new true-device acceptance was performed for these review fixes. Existing outstanding IME, real-model smoke/evaluation and notification-permission checks remain open. Gmail connection is deferred as requested. Accessibility audits remain waived by the user.

## Targeted review follow-up

The next review found conditional creation and a Stop-during-acknowledgement race. Creation and changes now share the same conservative current-instruction authority gate. Public regressions cover English `if`/`unless`/`when` and Chinese `假如`/`若`/`一旦`; all preserve the original words and create no task. An unconditional reminder to buy a `gift` still saves, verifying English word boundaries rather than arbitrary `if` substring rejection. The English conditional creation first reproduced `succeeded` and then passed as clarification.

The native draft now persists Stop intent before transport, including while no initial run ID is known. It defers cancellation until initial/retry acknowledgement and then uses the accepted attempt's cancellation identity. Unknown acknowledgements, transport failures and relaunch preserve the pending Stop; a genuinely new user input or explicit new retry resets it. Already committed results still display their actual saved task.

Swift public client lifecycle tests cover initial no-run-ID Stop, retry acknowledgement loss/relaunch, fresh cancellation identity, cancellation response loss, old draft decoding and explicit new retry. The real HTTP regression uses a transport proxy to withhold retry acknowledgement after the server has committed and started the second model request. Replaying the old key leaves the second attempt running; consuming the acknowledgement and sending the fresh Stop cancels it, and late provider proposals save no task.

- Combined creation/terminal authorization tests: 2 passed (25.39 s).
- Real HTTP delayed retry acknowledgement/late provider test: 1 passed (3.75 s).
- Swift tests: 17 passed; generic iOS Simulator build passed.
- TypeScript build passed. Final full suite: 6 files / 58 tests passed with no unhandled errors (81.06 s), log `/tmp/nivli-review-stable-final.log`.

Verification reproduced a PostgreSQL `57P01` teardown race twice: pg-pool 3.14.0 removes clients from its list and resolves `pool.end()` before asynchronous socket/backend exits finish; immediate `DROP DATABASE WITH (FORCE)` kills an ending client. All six isolated HTTP suites now use one bounded connection-drain helper and a normal database drop, so genuine leaks fail instead of being killed or ignored. The existing raw numeric/timeout integration test now has a 15-second harness allowance for two queue settlements, worker restart and a 1.1-second late-output observation; its actual model hard deadline remains 100 ms. Affected task/agent suites passed 25 tests, followed by the clean 58-test full run above. No model credentials or true-device acceptance were added by this follow-up.
