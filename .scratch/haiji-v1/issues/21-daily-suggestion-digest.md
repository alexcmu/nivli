# 21: 接收每日建议摘要

**What to build:** 用户主动开启建议推送后，按自己的时区和安静时段收到最多每日一条通用摘要；点开查看待确认建议，忽略不会引发反复催促。

**Blocked by:** [18: 邮件生成行动建议](18-email-action-suggestions.md)；[05: 收到自有 APNs 远程提醒](05-direct-apns-reminder.md)；[12: 通知预览与安静时段](12-notification-privacy-and-quiet-hours.md)

**Status:** ready-for-agent

**Parent:** [Haiji v1 Engineering Specification](../spec.md)

**规格定位：** US-17、US-44、US-46–US-47、US-51、US-59、US-64；D-05–D-10；AC-08、AC-17。引用场景按本票范围验收，不要求提前实现其他票的功能。

**交付范围：** 自签名 v1 必需范围。 使用独立 SummaryDelivery 和通知 category，不能伪造 Task/Reminder 或暴露任务动作。当前使用自有 APNs，官方中继由 29/30 验证。

**界面依据：** [Haiji UI 设计](../../../archived/haiji-ui-design.md)。使用原生 SwiftUI，沿用父规格的可访问性与错误反馈要求。

**测试边界：** 沿用父规格 T-01/T-02：从公开 API 验证外部可见行为，使用真实 PostgreSQL/pg-boss，仅替代模型、邮箱和推送等外部服务；涉及系统通知、权限或离线的结果补充原生真机证据。新增或修改的 API 同步维护 OpenAPI 与 Swift DTO 契约。

## Acceptance criteria

- [ ] 默认仍为仅应用内建议；开启后默认当地 09:00、每日最多一条，安静时段内推迟至允许时段，无未读有效建议不发送。
- [ ] 持久摘要身份包含 owner、设备、当地日期与批次，保存 suggestion ID/revision；已纳入摘要且无新版本的建议不因未响应再次推送。
- [ ] 发送前校验当前 pending、来源有效性和偏好，已经接受/撤回的内容不能进入待发摘要；时区或偏好变化不会产生同日重复发送。
- [ ] 摘要投递采用 planned/sending/accepted/unknown/failed/expired/cancelled 等确定性结果与有界重试，unknown 不自动重发，恢复不积压补发多日摘要。
- [ ] 可见推送只有通用文案与不透明摘要身份；独立 category 只打开待确认列表，不提供完成或 30 分钟后动作。
- [ ] 忽略不改变记忆、频率或紧急程度；前台列表在打开时读取当前状态，不依赖推送正文承载私人建议。
- [ ] 公开 API/真实队列与受控时钟覆盖安静时段、跨日/时区、并发发送、建议接受竞态及 unknown；真机验证摘要点开路径与锁屏通用内容。

**完成条件：** 验收项全部通过并附可复核证据；需要外部凭据、真机或审核而尚未验证的项保持未完成。先满足所有 Blocked by，再开始实施；ready-for-agent 表示规格可实施，不表示依赖已经完成。
