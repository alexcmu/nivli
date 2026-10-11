# 09: 模型失败、取消与预算恢复

**What to build:** 用户能理解和恢复一次失败或超时的交代，取消不再需要的执行；管理员能限制模型成本，预算耗尽不会关闭手动事项和已有提醒。

**Blocked by:** [07: 用 Pi 创建明确时间提醒](07-pi-create-reminder.md)

**Status:** ready-for-agent

**Parent:** [Nivli v1 Engineering Specification](../spec.md)

**规格定位：** US-02、US-12、US-25、US-51、US-57、US-59–US-60；D-03–D-05、D-07、D-13；AC-04–AC-05、AC-16、AC-20。引用场景按本票范围验收，不要求提前实现其他票的功能。

**交付范围：** 自签名 v1 必需范围。 完善有界 run 生命周期与业务副作用恢复。provider 内部已产生的费用无法通过取消保证撤回，应区分估算、usage 和账单。

**界面依据：** [Nivli UI 设计](../../../archived/nivli-ui-design.md)。使用原生 SwiftUI，沿用父规格的可访问性与错误反馈要求。

**测试边界：** 沿用父规格 T-01/T-02：从公开 API 验证外部可见行为，使用真实 PostgreSQL/pg-boss，仅替代模型、邮箱和推送等外部服务；涉及系统通知、权限或离线的结果补充原生真机证据。新增或修改的 API 同步维护 OpenAPI 与 Swift DTO 契约。

## Acceptance criteria

- [x] run 状态完整覆盖 queued/running/needs_clarification/succeeded/failed/cancelled/timed_out；20 秒前台目标后仍明确处理中，默认 60 秒硬超时拒绝晚到提交。
- [x] 取消阻止新的模型请求和工具开始，并拒绝晚到 proposal；已成功提交的业务操作不被假装撤销，界面仍能查看结果。
- [x] 进程重启可重做未确认完成的模型请求，但稳定业务操作键防止重复事项；说明重试可能重复模型费用。
- [x] 管理员设置每日预算和每次输出上限；每次请求前按剩余预算及保守上限检查，记录实际 usage，额度不足返回可执行的错误。
- [x] 失败、缺信息、额度耗尽和等待状态分开显示；原话不丢，重试与手动设置保留输入身份，离开页面后可重新查看 run。
- [x] agent 与 delivery 使用独立并发配额；模型卡住或预算耗尽时，公开 API 手动创建和已安装本地提醒仍可工作。
- [x] 公开 API/真实队列测试使用慢响应、取消后晚到、预算竞争和提交前后崩溃，断言外部请求次数及唯一业务结果；日志不得含原始对话或密钥。

**完成条件：** 验收项全部通过并附可复核证据；需要外部凭据、真机或审核而尚未验证的项保持未完成。先满足所有 Blocked by，再开始实施；ready-for-agent 表示规格可实施，不表示依赖已经完成。


## Comments

2026-10-11: 本票有界生命周期与预算恢复已实现并通过受控外部 Anthropic 服务、真实 Pi/PostgreSQL/pg-boss 验证。公开 HTTP 测试覆盖预算竞争、取消后晚到、硬超时、20 秒等待、SIGKILL 提交前后恢复、真实请求数和唯一事项；Swift 14 项及原生通用设备构建通过。完整证据见 [ticket-09-evidence](../../../docs/ticket-09-evidence.md)。原话/输入身份留在持久化 run/history，手动设置保留输入草稿；手动创建是用户另行确认的操作。已安装本地提醒的锁屏离线真机结果引用 03 用户确认，不宣称 APNs 或尚未实施的后续 delivery 功能。真实 Claude API 凭据缺失，07 的 live smoke 验收仍保留未完成；此处仅关闭本票可替代外部模型的生命周期验收。Status 保持 ready-for-agent，完成以清单及证据评论记录。

- 2026-10-11 AI review fixes: 已修复否定/条件语句被模型误提为完成或取消、重试后再次取消沿用旧操作身份、明确 deadline 被遗漏的问题；按原始输入时刻和时区解析下一未来周五，提交时仍拒绝已过去的提醒。公开 HTTP/真实 PostgreSQL/pg-boss/Pi 全套 57 测试与最终否定语句专项、15 Swift 测试、通用 iOS Simulator 构建通过。证据见 [AI review fixes](../../../docs/ai-review-fixes-evidence.md)。新增至 51 条评估标注，真实 Claude 评估仍为 not_run，未关闭原有外部凭据或 IME 验收项。

- 2026-10-11 targeted review follow-up: create 与 edit/complete/cancel 共用保守的当前指令授权校验，英文 if/unless/when 与中文 假如/若/一旦 不再变成无条件提醒；gift 等含有 if 字母的词仍可提交。原生 Stop 意图先持久化，在首次提交或 retry 回执未明时保留并延后取消，确认后用新 attempt 操作身份发送；覆盖无 runId、重启、丢失回执与真实 HTTP 延迟 retry 回执/晚到模型输出。17 Swift 测试、通用 iOS 构建及最终 58 项公开 HTTP/PG/队列测试无未处理错误通过；隔离数据库 teardown 的 pg-pool 3.14.0 关闭竞态已通过共用有界连接 drain 修复，未隐藏连接泄漏。详见 [AI review fixes](../../../docs/ai-review-fixes-evidence.md)。真实 Claude 与既有未验收项保持开放。
