# 工单 02：手动事项

实现入口：`src/tasks.ts`、`src/task-contracts.ts`、`src/task-schema.ts`，原生入口 `ios/Nivli/TaskViews.swift`，持久投影 `ios/Sources/NivliCore/Tasks.swift`。

## 已验证的公开边界

`npm run build`；`npm test`（真实 PostgreSQL 17，临时独立数据库，真实 HTTP）；`npm run contract`。

7 个事项 API 场景覆盖：

- 手动创建、详情持久读取、原始背景依据、UTC instant 与 IANA 时区、独立 date-only 截止。
- 并发同键提交与稳定 commandId 重试得到同一结果；嵌套提醒条件变更复用同键返回 409；同标题的新输入独立保存。
- 无提醒时保存 date-only / instant 截止；空白标题、无效日历日期与时区返回 422 且不存在事项。
- 到时与最近提醒优先、UUID 稳定排序、状态筛选、keyset 分页；API 重启后使用旧分页游标继续读取；错误游标及跨状态游标返回 422。
- 在数据库提交边界注入真实 PostgreSQL trigger 故障，HTTP 返回可重试 503；事项详情与全部列表均不可见；移除故障后相同任务/命令身份可成功重试且依据仅一份。
- 所有公开事项入口认证；拒绝客户端 ownerId 字段；未知对象 404。
- 稳定命令以新的传输幂等键重放后，该键仍被保留，不能用于不同输入。

持久对象在同一事务中写入 Task、Reminder、手动 Evidence、ChangeLog、命令与幂等键别名。关联使用 owner 复合外键；命令提交前再次锁定校验当前 session/device 吊销状态。客户端不传 revision。90 日响应窗口之后保留业务命令身份，拒绝旧操作重放。

OpenAPI 从服务注册 schema 导出；版本化 `contracts/examples/task*.json` 同时由 TypeBox 和 Swift DTO 检查。Swift 本地 SQLite 投影按服务器/owner/device 隔离，应用重开仍可读取已保存事项。

## 原生验证

详见 `ios/VALIDATION.md` 的工单 02 记录。原生使用 SwiftUI 日期控件、明确 IANA 时区输入与独立截止类型，未安装通知时显示“已保存，提醒尚未安排”。失败保留表单与 commandId，修改输入后产生新身份。

用户已豁免无障碍专项验收；保留系统默认语义控件，普通功能与深浅色继续验证。通知排程归工单 03，本票不宣称通知已经就绪。
