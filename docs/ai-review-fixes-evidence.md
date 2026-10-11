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
