# Ticket 08 evidence

Implemented linked, durable conversation inputs and deterministic task changes. Each conversation allocates input revisions transactionally; workers cannot claim an input while an earlier revision is queued/running. Inputs retain their original text. Before calling Pi, the application persists an immutable context snapshot containing at most eight recent messages (500 characters each) and four task projections. Retries retain those identities and expected task revisions. A clarification answer can authorize creation only through its explicit linked ancestry; unrelated conversation text is not authorization. Stale clarification answers are rejected.

Conversation history returns the most recent 30 messages and rereads the current task for each historical card. Edits use `executeTaskAction`, the input UUID as command identity, and the persisted expected revision. Completed/cancelled tasks cannot be restored through conversation edits. A single task or an explicit selected task is required. Short clock edits retain the existing calendar date and original timezone; deadlines remain independent. Source instructions and original time expressions are stored. Quiet-hour plans continue to require the existing explicit confirmation before installation.

## Automated evidence

Public HTTP tests use real PostgreSQL 17, pg-boss and the published Pi 1.1.0 adapter, replacing only the external Anthropic SSE boundary. The conversation tests cover API/worker restart and history, linked answers and source preservation, Chinese `九点半` edits, late edits versus completion, concurrent ordered inputs, multiple task ambiguity and explicit selection during travel with an independent deadline, vague postponement, unspecified Friday and a nonexistent DST clock. Existing agent tests cover repeated DST clocks, wishes, invalid authority, request/tool limits and provider failures. Swift contract tests decode conversation history and lifecycle states.

Final merged verification: TypeScript build passed; 53 public HTTP tests across six files passed (18.89 seconds); 14 Swift tests passed; generic iOS Simulator build passed. Conversation-specific seven HTTP tests also passed. OpenAPI is generated using a fresh schema-version 4 fixture, rather than modifying a user's server.

## Native evidence

2026-10-11: signed iPhone 17 Pro / iOS 27.2 (24B5089g), isolated bundle `app.haiji.HaijiTicket08`, fresh database, HTTPS tunnel and controlled external Anthropic provider. `ConversationUITests/testLinkedClarificationModificationAndCurrentHistoryAfterRelaunch` passed, 56.039 seconds. The test verified an original clarification, relaunch/restoration, linked time answer, one saved task with actual local installation receipt, a natural-language time change, and persistent current history after another relaunch. The public fixture proof confirmed three provider requests and one task at revision 2. The isolated connection was revoked and fixture database/tunnel/private pairing resource removed afterward. The existing Haiji bundle was preserved.

- Log: `/tmp/haiji08-device.log`
- Result: `/tmp/haiji08-device/Logs/Test/` (the test result bundle records screenshots).
- Chinese committed Unicode input was exercised. Actual marked-text IME composition was not observed; no IME-specific acceptance claim is made. Accessibility/max accessibility text audits are excluded by the user's recorded instruction.

## Model evaluation

`evals/conversation-cases.json` contains 50 independently labeled cases, 25 Chinese and 25 English, with expected business results, required clarification and forbidden actions, including DST and references. These labels are not evaluated model results.

`npm run build && npm run model:eval` writes a `not_run` report unless `HAIJI_REAL_MODEL_EVAL=1` and server-only model configuration are present. A live run creates an isolated database, authenticates through public HTTP, starts the real queue worker, evaluates all message chains, records model/Pi versions, request/tool counts and budget/usage estimates, and drops the database in `finally`. No existing user's tasks are modified. The configured daily budget (default USD 1, evaluator cap USD 10) remains enforced. `HAIJI_EVAL_REPORT` chooses the report path; default `/tmp/haiji-conversation-evaluation.json`. Provider invoices are not inferred from usage.

At this checkpoint, the real Claude key was unavailable. The observed report is `not_run`, model `claude-sonnet-5-5`, Pi `1.1.0`, budget USD 1, 50 labeled cases and zero evaluated results. Actual Claude contract quality/evaluation remains unverified and ticket 08 remains open for that external acceptance and IME observation.

## 2026-10-11 本轮范围调整

用户明确“中文输入法不要管”，实际 marked-text/中文组合验收已豁免，不宣称已观察通过。07 的 Shift+Enter 仍单独验收。08 的真实模型记录以 [最终评估证据](evals/claude-sonnet-5-5-evidence.md) 和 [真实模型真机证据](live-ai-device-evidence.md) 为准；以上早期缺凭据/not_run 描述保留为历史，已被后续证据更新。
