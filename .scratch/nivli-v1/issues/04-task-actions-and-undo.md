# 04: 完成、推迟、取消与撤销

**What to build:** 用户在应用或经过系统认证的通知动作中完成、推迟或取消事项，并能撤销误操作；列表、详情与本机计划保持一致。

**Blocked by:** [03: 安排本地时间提醒](03-local-time-reminder.md)

**Status:** ready-for-agent

**Parent:** [Nivli v1 Engineering Specification](../spec.md)

**规格定位：** US-10–US-11、US-18、US-20–US-25；D-05–D-07、D-09–D-10；AC-05–AC-06、AC-09。引用场景按本票范围验收，不要求提前实现其他票的功能。

**交付范围：** 自签名 v1 必需范围。 本票实现确定性事项命令；自然语言修改由 08 接入同一命令边界。不能以终端状态修改隐式恢复事项。

**界面依据：** [Nivli UI 设计](../../../archived/nivli-ui-design.md)。使用原生 SwiftUI，沿用父规格的可访问性与错误反馈要求。

**测试边界：** 沿用父规格 T-01/T-02：从公开 API 验证外部可见行为，使用真实 PostgreSQL/pg-boss，仅替代模型、邮箱和推送等外部服务；涉及系统通知、权限或离线的结果补充原生真机证据。新增或修改的 API 同步维护 OpenAPI 与 Swift DTO 契约。

## Acceptance criteria

- [x] 事项正常转换 active→completed/cancelled；restore 为显式新命令。已经过去的提醒恢复时要求选择新时间，不自动补发。
- [x] edit/complete/cancel/snooze/restore/undo 带命令身份与 expectedRevision，事务同时更新业务、ChangeLog 和相关计划；相同命令重试不重复变更。
- [x] 完成与取消停止后续本地计划；推迟更新 reminder revision 但保持 deadline。允许明确选择晚于 deadline 的提醒，并在确认界面同时显示两者。
- [x] 对已取消事项执行完成返回冲突；旧 edit/snooze 不能复活 terminal task。冲突返回当前实体或可读取引用。
- [x] 撤销关联原 mutationId，只在目标仍是该操作结果时恢复；后续已有修改时显示冲突，不用旧快照覆盖。
- [ ] 通知 category 提供完成和 30 分钟后，两者要求系统认证并携带 occurrence/版本；只读打开不完成，旧版本 snooze 不改变最新计划。
- [ ] 首页、历史、详情及已有关联确认卡展示当前状态，更新系统计划有崩溃恢复日志；可撤销操作提供即时入口。
- [ ] 公开 API 集成测试覆盖并发/重试、旧版本、撤销冲突和事务失败；真机验证通知动作认证、旧通知打开及系统计划取消/更新。

**完成条件：** 验收项全部通过并附可复核证据；需要外部凭据、真机或审核而尚未验证的项保持未完成。先满足所有 Blocked by，再开始实施；ready-for-agent 表示规格可实施，不表示依赖已经完成。


## Comments

2026-10-11：软件命令边界、因果撤销、原生处理控件与持久化重试已实现；公开 HTTP/真实数据库测试与真机系统计划替换/取消通过。详见 [04 证据](../../../docs/ticket-04-evidence.md)。通知 category 已设置系统认证与前台要求，但锁屏动作认证提示和旧已投递通知打开的实际观察尚未完成；对应混合验收项保持未勾选，Status 保持 ready-for-agent。按父规格的顺序调整，04 软件基础可供 08/09 使用。
