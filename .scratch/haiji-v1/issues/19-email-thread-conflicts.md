# 19: 处理后续邮件与截止时间冲突

**What to build:** 同一邮件线程出现新的行动或日期变化时，用户看见合适的更新或冲突建议，而不是重复事项或已确认安排被静默改写。

**Blocked by:** [18: 邮件生成行动建议](18-email-action-suggestions.md)

**Status:** ready-for-agent

**Parent:** [Haiji v1 Engineering Specification](../spec.md)

**规格定位：** US-25、US-33–US-34、US-36–US-38；D-05–D-07、D-10、D-12；AC-05、AC-13–AC-14。引用场景按本票范围验收，不要求提前实现其他票的功能。

**交付范围：** 自签名 v1 必需范围。 以稳定外部身份、动作和目标关联判断重复，不单靠标题或线程 ID 合并。

**界面依据：** [Haiji UI 设计](../../../archived/haiji-ui-design.md)。使用原生 SwiftUI，沿用父规格的可访问性与错误反馈要求。

**测试边界：** 沿用父规格 T-01/T-02：从公开 API 验证外部可见行为，使用真实 PostgreSQL/pg-boss，仅替代模型、邮箱和推送等外部服务；涉及系统通知、权限或离线的结果补充原生真机证据。新增或修改的 API 同步维护 OpenAPI 与 Swift DTO 契约。

## Acceptance criteria

- [ ] 同线程同动作的 pending 建议可更新并提升 revision，保留证据集合；旧版本接受返回明确冲突和最新内容。
- [ ] 已接受建议对应的事项不会被新邮件直接修改；生成关联 targetTaskId/expectedTaskRevision 的变更建议。
- [ ] 变更界面呈现旧值与新值，允许保留当前安排或编辑接受；deadline 与 reminder 独立，不能以更新截止日悄悄改提醒时间。
- [ ] 不同动作可以在同线程形成不同建议；歧义时保留证据请求确认，不因相同主题丢失合法行动。
- [ ] 邮件提取与用户接受并发时由事务/版本约束决定有效结果；重同步、分页重放与内容版本重复不复制建议。
- [ ] 公开 API 测试覆盖 pending 更新、已接受后改期、多动作线程、并发接受和旧 suggestion revision；SwiftUI 验证冲突前后值及用户选择。

**完成条件：** 验收项全部通过并附可复核证据；需要外部凭据、真机或审核而尚未验证的项保持未完成。先满足所有 Blocked by，再开始实施；ready-for-agent 表示规格可实施，不表示依赖已经完成。
