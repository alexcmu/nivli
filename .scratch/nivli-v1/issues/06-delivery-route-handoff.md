# 06: 安全切换投递路径

**What to build:** 用户能在允许的情况下切换本地与远程提醒路径；设备断线、安装失败或回执丢失时，界面说明待确认状态，避免两个路径同时主动投递。

**Blocked by:** [05: 收到自有 APNs 远程提醒](05-direct-apns-reminder.md)

**Status:** ready-for-agent

**Parent:** [Nivli v1 Engineering Specification](../spec.md)

**规格定位：** US-13、US-24–US-25、US-48、US-51、US-64；D-05、D-07–D-09；AC-07–AC-08。引用场景按本票范围验收，不要求提前实现其他票的功能。

**交付范围：** 自签名 v1 必需范围。 复用 03/05 的 occurrence、routingVersion 和投递结果。路由切换不创建第二个逻辑提醒，也不承诺撤回在途外部请求。

**界面依据：** [Nivli UI 设计](../../../archived/nivli-ui-design.md)。使用原生 SwiftUI，沿用父规格的可访问性与错误反馈要求。

**测试边界：** 沿用父规格 T-01/T-02：从公开 API 验证外部可见行为，使用真实 PostgreSQL/pg-boss，仅替代模型、邮箱和推送等外部服务；涉及系统通知、权限或离线的结果补充原生真机证据。新增或修改的 API 同步维护 OpenAPI 与 Swift DTO 契约。

## Acceptance criteria

- [ ] server→local 必须在尚未领取发送资格且没有 accepted/unknown 结果时原子停用远程路径、提升 routingVersion，然后设备安装；不允许先安装再争取归属。
- [ ] local→server 先取消设备请求并确认不存在，再接收当前 routingVersion 的取消回执后切换；设备不可达或结果不明时保持待确认。
- [ ] 安装失败且确认没有系统请求可显式切换；ack 丢失则查询并重传，超时不自动启动兜底路径。
- [ ] 旧 job、旧回执和重复切换不能改变当前归属；相同操作键返回相同业务结果。
- [ ] 用户可查看当前路径、未就绪原因与下一步；能力不足、权限关闭和容量不足分别说明，不把“服务可发送”表示成系统一定展示。
- [ ] 公开 API 与真实队列测试构造发送领取/切换竞争、崩溃及重复回执，验证只有一个主动路径；设备验收取消、重装及恢复 pending 的完整流程。

**完成条件：** 验收项全部通过并附可复核证据；需要外部凭据、真机或审核而尚未验证的项保持未完成。先满足所有 Blocked by，再开始实施；ready-for-agent 表示规格可实施，不表示依赖已经完成。
