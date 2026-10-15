# 26: 查看模型成本与服务健康

**What to build:** 用户和管理员能区分模型额度不足、邮箱不同步及提醒投递故障，看到恢复动作；诊断既有提醒无需查看私人的对话或邮件。

**Blocked by:** [09: 模型失败、取消与预算恢复](09-agent-failure-budget-and-cancel.md)；[05: 收到自有 APNs 远程提醒](05-direct-apns-reminder.md)；[17: 连接 Gmail 与控制读取范围](17-gmail-connect-and-sync.md)

**Status:** ready-for-agent

**Parent:** [Haiji v1 Engineering Specification](../spec.md)

**规格定位：** US-02、US-51、US-57、US-59–US-60、US-64；D-03–D-04、D-07、D-10、D-13–D-14；AC-04、AC-08、AC-13、AC-20。引用场景按本票范围验收，不要求提前实现其他票的功能。

**交付范围：** 自签名 v1 必需范围。 用户在“我的”看到可理解的环境状态；详细运营数据仅在受保护管理入口。正常首页不展示 token、队列或 API key。

**界面依据：** [Haiji UI 设计](../../../archived/haiji-ui-design.md)。使用原生 SwiftUI，沿用父规格的可访问性与错误反馈要求。

**测试边界：** 沿用父规格 T-01/T-02：从公开 API 验证外部可见行为，使用真实 PostgreSQL/pg-boss，仅替代模型、邮箱和推送等外部服务；涉及系统通知、权限或离线的结果补充原生真机证据。新增或修改的 API 同步维护 OpenAPI 与 Swift DTO 契约。

## Acceptance criteria

- [ ] 环境状态分别呈现连接、模型提供方/预算、最近邮箱同步和提醒能力；失败入口指向重试、配置或重新授权，正常状态无虚假保证。
- [ ] 管理员可查看真实 usage、预算余量及估算费用，区分提供方账单；预算变更和请求检查复用 09，不创建第二套计费事实。
- [ ] health/readiness 包含数据库、worker 心跳、队列最老任务年龄、due lag、重试/死信、APNs unknown/拒绝和邮箱同步年龄。
- [ ] API 存活但 worker 停止、模型占满或投递持续失败时状态必须降级；指标不能把 APNs accepted 计为用户已看到。
- [ ] 模型任务和通知任务有独立并发配额；用受控慢模型证明 delivery worker 仍消费已有 server-owned 提醒，预算耗尽也不影响手动路径。
- [ ] 日志和指标使用稳定请求/实体引用，排除原始对话、邮件、位置、凭据和隐藏推理；管理诊断不可被未配对设备读取。
- [ ] 公开 API 集成测试注入 worker/提供方/邮箱失败并断言可见状态及独立投递；原生设置页验证定位故障所需信息和下一步。

**完成条件：** 验收项全部通过并附可复核证据；需要外部凭据、真机或审核而尚未验证的项保持未完成。先满足所有 Blocked by，再开始实施；ready-for-agent 表示规格可实施，不表示依赖已经完成。
