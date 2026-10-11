# 05: 收到自有 APNs 远程提醒

**What to build:** 自签名 App 的用户在服务器拥有投递归属时收到可见远程提醒；App 和管理端能区分待发送、APNs 已受理、失败与结果未知。

**Blocked by:** [03: 安排本地时间提醒](03-local-time-reminder.md)

**Status:** ready-for-agent

**Parent:** [Nivli v1 Engineering Specification](../spec.md)

**规格定位：** US-13、US-24、US-44、US-57、US-59–US-61、US-64；D-03、D-07–D-09、D-13–D-14；AC-05、AC-08、AC-22。引用场景按本票范围验收，不要求提前实现其他票的功能。

**交付范围：** 自签名 v1 必需范围。 实现自有 APNs 配置、确定性调度和可见推送。只处理明确 server-owned 的实例；本地/远程切换由 06 完成，不能擅自接管本地计划。

**界面依据：** [Nivli UI 设计](../../../archived/nivli-ui-design.md)。使用原生 SwiftUI，沿用父规格的可访问性与错误反馈要求。

**测试边界：** 沿用父规格 T-01/T-02：从公开 API 验证外部可见行为，使用真实 PostgreSQL/pg-boss，仅替代模型、邮箱和推送等外部服务；涉及系统通知、权限或离线的结果补充原生真机证据。新增或修改的 API 同步维护 OpenAPI 与 Swift DTO 契约。

## Acceptance criteria

- [ ] 管理员配置 Team、Bundle ID、APNs key 和开发/生产环境；设备 token 绑定已认证设备、topic 和环境，配置错误有可行动反馈。
- [ ] 服务端业务命令能明确创建尚未本地安装的 server-owned occurrence；客户端准确展示远程路径和投递状态，不以权限关闭为由声称远程一定可显示。
- [ ] delivery worker 启动恢复扫描并滚动物化未来 24 小时计划；默认 60 秒扫描，业务提交与必要 job 同事务或事务性 outbox，job 只携带业务引用。
- [ ] 发送领取在事务中检查当前任务状态、提醒版本、有效设备、归属、偏好和有效窗口；同一实例只能领取一次有效发送资格。
- [ ] 明确可重试拒绝按有界退避处理；无效 token 停用；网络结果不明或 sending 时崩溃转 unknown 且不自动重发。APNs accepted 只显示已受理。
- [ ] 远程默认通用文案，使用可见通知而非依赖静默唤醒；点按打开当前事项。正常投递不调用模型。
- [ ] 默认补发窗口为到期后 15 分钟，按规格处理 deadline 截短与明确晚于截止时间的提醒；过期实例不在恢复时批量重放。
- [ ] 真实 PostgreSQL/队列与可控 APNs 替代物覆盖发送竞态、拒绝、unknown、崩溃和过期；自签名真机完成一条远程通知并保存证据。

**完成条件：** 验收项全部通过并附可复核证据；需要外部凭据、真机或审核而尚未验证的项保持未完成。先满足所有 Blocked by，再开始实施；ready-for-agent 表示规格可实施，不表示依赖已经完成。
