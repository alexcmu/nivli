# 10: 离线创建和处理提醒

**What to build:** 用户离线时仍能手动创建、完成或推迟事项，看到待同步状态；联网后按因果顺序同步，冲突由用户核对且不会重复提醒。

**Blocked by:** [04: 完成、推迟、取消与撤销](04-task-actions-and-undo.md)；[06: 安全切换投递路径](06-delivery-route-handoff.md)

**Status:** ready-for-agent

**Parent:** [Haiji v1 Engineering Specification](../spec.md)

**规格定位：** US-12、US-24–US-25、US-48–US-51；D-05–D-07、D-09、D-11；AC-07、AC-09–AC-10。引用场景按本票范围验收，不要求提前实现其他票的功能。

**交付范围：** 自签名 v1 必需范围。 实现本机 SQLite 投影、持久 outbox 与系统计划恢复日志。游标过期和重装恢复由 11 扩展，不能把这些场景静默当作成功同步。

**界面依据：** [Haiji UI 设计](../../../archived/haiji-ui-design.md)。使用原生 SwiftUI，沿用父规格的可访问性与错误反馈要求。

**测试边界：** 沿用父规格 T-01/T-02：从公开 API 验证外部可见行为，使用真实 PostgreSQL/pg-boss，仅替代模型、邮箱和推送等外部服务；涉及系统通知、权限或离线的结果补充原生真机证据。新增或修改的 API 同步维护 OpenAPI 与 Swift DTO 契约。

## Acceptance criteria

- [ ] 离线命令先原子写本机投影/outbox，再更新系统通知；应用崩溃或重启后可以修复数据库与 pending requests 差异。
- [ ] 离线手动创建使用稳定 task UUID、mutationId/requestId，允许立即本地安装；自然语言离线只保存原话草稿或转明确表单，不声称已理解。
- [ ] 联网先读取最新服务端状态，按每实体前驱关系重放；前驱成功后更新后续 expectedRevision，不把自身前驱误判为远程冲突。
- [ ] 同步本地已安装计划时，业务事务同时建立 local pending 归属并绑定服务器版本；不得短暂经过可发送的 server-owned 状态。
- [ ] 真实版本冲突暂停该实体后续操作并保留差异，其他实体继续；取消或替换冲突的本机请求，由用户决定新计划。
- [ ] terminal 状态阻止旧编辑和 snooze；离线修改 server-owned 计划明确标注服务器尚未获知，旧推送到达时打开当前状态。
- [ ] 公开 API 测试重放重复、乱序、因果串联与跨实体冲突；真机完成离线创建→重启→恢复网络→唯一结果，并验证已有本地提醒独立触发。

**完成条件：** 验收项全部通过并附可复核证据；需要外部凭据、真机或审核而尚未验证的项保持未完成。先满足所有 Blocked by，再开始实施；ready-for-agent 表示规格可实施，不表示依赖已经完成。
