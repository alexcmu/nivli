# Ticket 04 — deterministic actions and causal undo

`POST /v1/tasks/{id}/commands` implements edit, complete, cancel, snooze, explicit restore and causal undo. `executeTaskAction` exposes the same transaction-owned boundary to confirmed conversation changes. Identity is derived from the authenticated owner/device/session; commands require commandId, clientMutationId and expectedRevision. The transport key, command identity and owner mutation identity reserve exact request contents for 90 days. Replaying a committed command returns its recorded result; clients fetch current detail before projecting it or installing notifications.

The owner serialization lock and active session/device check cover the complete transaction: task revision, independent deadline, reminder revision, invalidation of old occurrences, new local plan, causal before-state, unique command result and unique revision ChangeLog. Completed/cancelled tasks reject ordinary edits, completion or snooze. Restore and undo preserve fields causally and require an explicit future reminder time when the recovered time has passed. A removed reminder remains removed through cancel/restore. Stale occurrence identity/revision/routing/request identity cannot modify current state. Reads and ordinary notification opening have no command side effect.

Migration `migrateTaskActions` upgrades existing databases and records schema version 2. It adds mutation identity/before-state, occurrence invalidation and the action ChangeLog kinds. The application requires migration before startup. OpenAPI and `task-action.json` are published; Swift models preserve an explicit null deadline through persistence/retry.

Native details provide completion, 30 minute snooze, explicit time selection with the independent deadline displayed, title/background/deadline editing, cancellation, explicit restore and immediate causal undo. Exact in-flight requests are saved in a server/owner/device/task-namespaced Keychain record before transport, permitting retry after a lost response or relaunch. Current projection drives the existing SQLite notification reconciliation journal. History labels use current terminal state. Notification category actions require both `authenticationRequired` and foreground activation; occurrence checks reject obsolete actions, errors open current detail, and successful notification actions expose undo.

## Evidence

- First public HTTP action test failed 404, then passed after implementation.
- `npm run build` passed; 30 tests across all three suites passed; the task suite contains 16 cases. Tests use isolated real PostgreSQL 17 databases and real pg-boss setup. Coverage includes concurrent terminal commands, retries/reserved keys, stale occurrence, independent deadline past snooze, undo conflict, past-time restore, explicit reminder removal, and an injected real database commit failure leaving task and OS-plan projection unchanged until exact retry.
- `npm run contract` passed against an isolated migrated database; fixture database removed afterwards. No credentials or test private content were added to the repository.
- `swift test --package-path ios`: 12 tests passed. The explicit-null roundtrip first failed, then passed after the persisted action decoder was corrected. Public client boundary verifies stable transport identity and the shared fixture.
- Generic iOS simulator build passed: `/tmp/haiji04-build.log`.
- Physical Alchemist iPhone, actual team `Q974D4E3V6`: `testNotificationActionsReplaceAndCancelAcrossJournalReopen` passed, 1 test / 0 failures, 7.846 seconds. `/tmp/haiji04-device/Logs/Test/Test-Haiji-2026.10.11_15-12-11--0700.xcresult`. Production UNUserNotificationCenter category contained both protected foreground actions. The production adapter replaced the old pending request and cancelled the new request across a reopened SQLite journal. Only the validation namespace was cleaned.

Actual locked-device authentication prompt and opening an old delivered notification still need human/device observation. The category flags and scheduler result do not claim those visual interactions were observed. This ticket therefore remains `ready-for-agent` with those physical acceptance items unchecked; its software command boundary is available for AI tickets 08/09 under the spec's execution-order amendment. Accessibility audits are waived by the user.

## 2026-10-11 20:32 PDT — 旧通知冷启动打开已验收

在独立签名安装 `app.haiji.acceptance.Haiji`、真实 iPhone 17 Pro / iOS 27.2、独立 PostgreSQL 与 HTTPS fixture 上，`NotificationInteractionUITests/testOldDeliveredNotificationOpensCurrentTaskAfterColdLaunch` 通过：1 项，0 failures，45.030 秒。

通过公开 API 建立真实本地计划，生产客户端安装后在 Home 屏观察到系统的通用 `Haiji 提醒`。保留已投递通知，在应用后台通过公开任务命令改变事项标题与提醒版本；终止应用后，从 Notification Center 点开旧 occurrence。应用冷启动显示最新标题与“事项详情”；再用公开 API 验证同一 task id、当前 revision 完全未变、仍为 active。原生输出 `HAIJI_OLD_NOTIFICATION cold_launch=true current_title=true revision_unchanged=true active=true`。这是真实旧通知打开的行为证据，不是直接调用通知 delegate。

结果 `/tmp/haiji-acceptance-3qxCym/build/Logs/Test/Test-Haiji-2026.10.11_20-32-08--0700.xcresult`；日志 `/tmp/haiji-acceptance-3qxCym/old-notification.log`。没有使用真实个人事项，也没有调用模型。

另已安装真实事项的三分钟提醒，生产公开 API 回执为 `local_installed`，只读 OS 检查器确认实际 pending=1 且通用隐私预览。准备测试 1 项通过，17.134 秒为 xcodebuild 总测试耗时；计划 UTC `2026-10-12T03:36:26.816Z`（当地 20:36:26）。准备成功不代表锁屏动作认证已观察；该项等待用户实际操作。

## 2026-10-11 20:37 PDT — 实际通知完成与撤销入口

用户在上述真实已投递通知上选择“完成”，明确回复：“没有要求 faceid，出现了撤销”。公开 API 随后独立读取该事项：`status=completed`、`revision=6`、`reminder=null`；操作前为 active/revision=5。因此实际通知完成命令及原生撤销入口已取得观察证据。

系统认证提示没有观察到，点击动作瞬间的设备锁定状态也没有独立记录。既有 `.authenticationRequired` category 标志不代替该观察，本票仍保留锁屏通知动作认证这一项未验收。按用户要求尽快推进、不在 corner case 上继续耗时，本轮不再重复此操作；旧通知打开、完成和撤销入口等已取得证据的项目不重跑。公开状态摘要保留在私有 `/tmp/haiji-acceptance-3qxCym/completion-proof.json`；不包含模型费用或真实个人事项。

本轮清理：独立连接已通过生产“吊销并断开此设备”界面撤销，聚焦清理测试 1 项/0 failures/8.183 秒。已停止 API 与 HTTPS tunnel、删除独立数据库（复核剩余 0）、移除私有 fixture 与含其资源的临时构建产品，并卸载独立验收 app/runner。现有 Haiji 安装未替换。
