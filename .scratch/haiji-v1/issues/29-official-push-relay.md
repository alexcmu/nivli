# 29: 绑定和撤销官方推送中继

**What to build:** 使用发行方签名 App 的用户可以为已配对设备授权官方推送中继，接收通用提醒并随时撤销；中继不可被用来给任意设备发送消息。

**Blocked by:** [24: 吊销与替换主要设备](24-revoke-and-replace-device.md)

**Status:** ready-for-agent

**Parent:** [Haiji v1 Engineering Specification](../spec.md)

**规格定位：** US-04、US-44、US-57、US-62–US-63；D-07–D-09、D-13–D-14；AC-01、AC-08、AC-17、AC-22。引用场景按本票范围验收，不要求提前实现其他票的功能。

**交付范围：** 官方分发条件阶段 M5；不阻塞自签名 v1。 条件阶段 M5，仅在推进官方分发时实施。先贯通一条官方 task 通知与绑定生命周期，完整摘要和官方发布验收在 30 完成。

**界面依据：** [Haiji UI 设计](../../../archived/haiji-ui-design.md)。使用原生 SwiftUI，沿用父规格的可访问性与错误反馈要求。

**测试边界：** 沿用父规格 T-01/T-02：从公开 API 验证外部可见行为，使用真实 PostgreSQL/pg-boss，仅替代模型、邮箱和推送等外部服务；涉及系统通知、权限或离线的结果补充原生真机证据。新增或修改的 API 同步维护 OpenAPI 与 Swift DTO 契约。

## Acceptance criteria

- [ ] 发行方 APNs key 只存在中继受控环境，用户 backend 持有受限设备 capability，不能获取发行方密钥或指定任意 owner/device/topic。
- [ ] 绑定从当前有效配对关系发起；用户可查看中继地址、数据去向和状态，capability 有范围、吊销及重放防护。
- [ ] 中继仅接受允许通知类型、通用文案与不透明 occurrence 标识，拒绝明文任务标题、邮件、位置和超限 payload；设置频率/大小限制与最小审计。
- [ ] 可见通知走正确官方签名 topic/environment；发送前校验当前绑定，保留 APNs accepted/unknown 的语义，不把未知结果盲目重试。
- [ ] 用户关闭中继或吊销设备后，旧 capability 不能再使用；界面说明服务器主动触达不可用，本机已有计划仍可保留。
- [ ] 披露中继可见 device token、时间和流量元数据，日志不包含私密正文；不能以通用文案声称中继完全不可见。
- [ ] 公开 API 集成测试绑定、越权、重放、限额及撤销；使用官方签名测试构建在真机接收一条远程通知，并验证关闭绑定后拒绝发送。

**完成条件：** 验收项全部通过并附可复核证据；需要外部凭据、真机或审核而尚未验证的项保持未完成。先满足所有 Blocked by，再开始实施；ready-for-agent 表示规格可实施，不表示依赖已经完成。
