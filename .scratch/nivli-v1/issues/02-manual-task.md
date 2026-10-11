# 02: 手动创建与查看事项

**What to build:** 用户通过明确表单创建事项，查看首页和详情中的标题、提醒条件、截止日期与来源；服务重启、重复点按都不会丢失或复制事项。

**Blocked by:** [01: 部署个人环境并配对 iPhone](01-deploy-and-pair.md)

**Status:** ready-for-agent

**Parent:** [Nivli v1 Engineering Specification](../spec.md)

**规格定位：** US-06、US-11–US-13、US-16、US-18–US-19、US-25、US-51–US-54；D-02、D-05–D-07、D-10；AC-04–AC-05、AC-21。引用场景按本票范围验收，不要求提前实现其他票的功能。

**交付范围：** 自签名 v1 必需范围。 先实现已保存的事项和提醒条件，实际系统排程由 03 交付。未排程必须如实标注。所有后续写入复用本票的身份、版本与事务约束。

**界面依据：** [Nivli UI 设计](../../../archived/nivli-ui-design.md)。使用原生 SwiftUI，沿用父规格的可访问性与错误反馈要求。

**测试边界：** 沿用父规格 T-01/T-02：从公开 API 验证外部可见行为，使用真实 PostgreSQL/pg-boss，仅替代模型、邮箱和推送等外部服务；涉及系统通知、权限或离线的结果补充原生真机证据。新增或修改的 API 同步维护 OpenAPI 与 Swift DTO 契约。

## Acceptance criteria

- [x] 表单支持标题、必要背景、明确提醒时间与时区、独立 deadline；date-only 截止日期与具体 instant 分开保存，允许只有 deadline 的未排程事项。
- [x] POST /v1/tasks 接受稳定客户端 task UUID 与命令身份；事项、Reminder、来源和 ChangeLog 在同一事务中提交，owner 约束覆盖读取与关联。
- [x] 相同幂等键/请求返回同一结果，不同请求复用同键返回 409；不同输入即使标题相同也不会静默合并。
- [x] 列表与详情通过公开 API 读取持久结果；首页按已到提醒时刻、最近时间计划及稳定 ID 排序，不依赖模型。全部事项查询支持分页和状态筛选。
- [x] 客户端持久投影支持重开应用继续查看；显示“已保存，提醒尚未安排”，不把写数据库成功当成通知就绪。
- [x] 详情显示来源、完整日期、时区与 deadline；空首页提供清晰新增入口，表单失败保留输入并能重试。
- [x] 公开 API 集成测试使用真实 PostgreSQL，覆盖重复提交、事务回滚、分页与重启读取；SwiftUI 表单/详情在最大字号、VoiceOver 与深浅色下可用。

**完成条件：** 验收项全部通过并附可复核证据；需要外部凭据、真机或审核而尚未验证的项保持未完成。先满足所有 Blocked by，再开始实施；ready-for-agent 表示规格可实施，不表示依赖已经完成。


## Comments

### 2026-10-11 — 实施完成

已完成手动表单、独立 date-only / instant deadline、事务性 Task/Reminder/手动 Evidence/ChangeLog、稳定 UUID 与命令/传输键幂等、状态筛选与稳定分页、持久 SQLite 客户端投影、来源/完整日期/时区详情，以及失败保留输入重试。

验收证据：[后端与契约](../../../docs/ticket-02-evidence.md)、[Swift 与真机验证](../../../ios/VALIDATION.md)。真实 PostgreSQL HTTP 场景 7 项通过（后端全套 16 项）；Swift 7 项通过；模拟器深浅色功能 2 项通过；已连接测试 iPhone 上“Light 表单创建 → 来源与未排程详情 → Dark 重开应用读取 → 吊销”功能流程 1 项通过。用户已明确豁免无障碍专项验收，其对应原要求由父规格顶部范围调整覆盖。

本票保存 Reminder 事实但不安装系统通知，客户端如实显示“已保存，提醒尚未安排”；实际排程属于 03，持久离线写入 outbox 属于 10。按本地五种 triage 词汇保留 `ready-for-agent`；以完成复选框及本评论记录 resolved，不创建自定义关闭标签。
