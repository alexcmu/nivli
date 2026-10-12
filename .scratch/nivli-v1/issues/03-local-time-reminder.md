# 03: 安排本地时间提醒

**What to build:** 用户创建明确时间事项后，授权并在 iPhone 上安排系统通知；锁屏或暂时断网时已有计划仍能触发，应用准确展示排程状态。

**Blocked by:** [02: 手动创建与查看事项](02-manual-task.md)

**Status:** ready-for-agent

**Parent:** [Nivli v1 Engineering Specification](../spec.md)

**规格定位：** US-05–US-06、US-13、US-15、US-24、US-44、US-48、US-51、US-60；D-02、D-05、D-07–D-10；AC-04、AC-07、AC-09、AC-17。引用场景按本票范围验收，不要求提前实现其他票的功能。

**交付范围：** 自签名 v1 必需范围。 建立 local occurrence 身份、归属和回执契约；服务端可见推送尚未实现。任务打开只读，完成与推迟动作由 04 交付。

**界面依据：** [Nivli UI 设计](../../../archived/nivli-ui-design.md)。使用原生 SwiftUI，沿用父规格的可访问性与错误反馈要求。

**测试边界：** 沿用父规格 T-01/T-02：从公开 API 验证外部可见行为，使用真实 PostgreSQL/pg-boss，仅替代模型、邮箱和推送等外部服务；涉及系统通知、权限或离线的结果补充原生真机证据。新增或修改的 API 同步维护 OpenAPI 与 Swift DTO 契约。

## Acceptance criteria

- [x] 在创建第一条需要通知的提醒时请求权限；拒绝或授权关闭时事项仍保存，显示未就绪原因和去设置入口，不循环请求权限。
- [x] 业务提交时预先建立 local(device) 的稳定 occurrence 与 routingVersion；设备安装后回传 requestId/提醒版本，服务端确认后展示“本机已安排”。
- [x] 超过服务端 24 小时预建窗口的本地计划也立即获得 occurrence 并可安装；后续扫描复用身份，不另建服务端投递归属。
- [x] 安装成功但 ack 丢失保持 local pending；客户端能查询 pending requests 并用同一身份补回执，不能因超时改走远程路径。
- [x] 本地系统请求与持久投影有可恢复日志；应用重启可修复安装差异。容量不足时明确列出未安排计划，不能承诺靠后台刷新一定补齐。
- [x] 使用已确认 UTC instant 与 IANA 时区，旅行不静默移动提醒。默认通用文案不暴露标题、邮件或地点；打开通知查看当前详情，不完成事项。
- [x] 公开 API 测试验证认领、旧回执拒绝及丢失回执恢复；真机验证一条本地通知、锁屏/后台/离线、权限关闭和容量处理，记录系统版本及结果。

**完成条件：** 验收项全部通过并附可复核证据；需要外部凭据、真机或审核而尚未验证的项保持未完成。先满足所有 Blocked by，再开始实施；ready-for-agent 表示规格可实施，不表示依赖已经完成。

## Comments

### 2026-10-11 — 锁屏与离线观察

真实系统已安装的提醒于 15:06:25 PDT 触发；用户按要求开启飞行模式并锁屏后明确回复“锁屏且离线时看到了提醒”。锁屏/离线显示已取得用户观察证据。真机通知权限关闭的验收仍未完成，故本票继续保持未完成；按用户最新指示并行推进 AI agent 闭环。

- 2026-10-11: Software implementation committed on `implement/nivli-03` and merged integration `0424ac1`. Atomic local intent/identity and strict current-owner/version receipts, quiet confirmation and honest failure states are implemented. Evidence: [ticket-03-evidence](../../../docs/ticket-03-evidence.md). Post-merge backend 25 tests, Swift 11 tests and generic iOS build passed. Device validation is waiting for the connected iPhone to unlock; locked/offline display, real permission-off and measured capacity remain unchecked. Status remains `ready-for-agent`; this is not a closure claim. Accessibility audits are waived by the user.

- 2026-10-11 follow-up: Real iPhone platform test passed (one test, 20.031 seconds): 16 OS-pending requests, conservative next-request capacity rejection, persistent journal reopening, actual generic background banner and delivered record. Locked/offline display and real permission-off validation remain incomplete; no closure. The user's later steering prioritizes the AI agent path, with remaining native verification continuing separately. See the same evidence document for the actual result bundle.

- 2026-10-11 继续验收：独立安装先请求系统授权后已找到真实 Settings 通知开关，但自动化点击未令其变为关闭，权限关闭测试 skipped；未取得 denied 证据。手机录像出现 Siri 输入浮层，等待用户清除干扰后再继续。详情见原证据文档。本票不关闭。

- 2026-10-11 20:29 PDT 真机权限关闭验收补齐：用户在独立验收安装中手动关闭允许通知；生产客户端读取真实 denied，显示“通知权限未开启 · 事项已保存”和设置入口，无重复权限弹窗。公开 API 复核同一事项仍 active、revision 未变、schedulingStatus=permission_denied；用户随后重新开启权限。原生完整脚本的业务断言全部通过，脚本另一个无关主机静态标签断言失败（已移除，保留失败记录），不将整项 XCTest 宣称为通过。结合已有安装/回执/恢复/容量及锁屏离线证据，03 的业务验收项已全部满足。本票验收完整，triage 状态继续使用 ready-for-agent。
