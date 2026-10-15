# 11: 同步缺口与全量恢复

**What to build:** 用户长期离线、游标过期或重新安装 App 后，可重新获得一致事项状态；未同步操作被保留，已删除对象不会因为旧本机数据重新出现。

**Blocked by:** [10: 离线创建和处理提醒](10-offline-mutations.md)

**Status:** ready-for-agent

**Parent:** [Haiji v1 Engineering Specification](../spec.md)

**规格定位：** US-25、US-48–US-50、US-58、US-64；D-05、D-07、D-09、D-11；AC-10–AC-11。引用场景按本票范围验收，不要求提前实现其他票的功能。

**交付范围：** 自签名 v1 必需范围。 建立一致 snapshot/high-water cursor、tombstone 与过期命令语义。设备吊销和主要设备替换的管理体验由 24 交付。

**界面依据：** [Haiji UI 设计](../../../archived/haiji-ui-design.md)。使用原生 SwiftUI，沿用父规格的可访问性与错误反馈要求。

**测试边界：** 沿用父规格 T-01/T-02：从公开 API 验证外部可见行为，使用真实 PostgreSQL/pg-boss，仅替代模型、邮箱和推送等外部服务；涉及系统通知、权限或离线的结果补充原生真机证据。新增或修改的 API 同步维护 OpenAPI 与 Swift DTO 契约。

## Acceptance criteria

- [ ] GET /v1/changes 提供 owner 范围有序变更、删除 tombstone、opaque cursor 和分页；初始保留 90 天，过期游标返回 410 与完整同步指引。
- [ ] snapshot 在一致读边界生成并返回 high-water cursor；客户端替换服务端投影后继续消费其后的 changes，不漏掉快照期间的新变更。
- [ ] 全量恢复保留本机未同步 outbox，再按有效身份和前驱关系处理；服务端缺失的旧对象不能被直接识别为待新建实体。
- [ ] 幂等响应至少保留 90 天，创建身份与仍存在实体的关系长期保留；超窗旧操作明确过期并让用户核对，不悄悄当作新命令重放。
- [ ] 建立可复用的删除同步/抑制机制，后续数据删除接入同一契约；不能依赖设备 wall clock 判断新旧。
- [ ] 重装后重新确认通知权限和当前推送身份，仅安排当前有效计划；界面不宣称已撤回旧设备离线请求。
- [ ] 公开 API 集成测试在快照生成期间并发修改，覆盖分页缺口、删除 tombstone、过期游标和旧操作；设备测试验证恢复进度、错误重试和保留草稿/outbox。

**完成条件：** 验收项全部通过并附可复核证据；需要外部凭据、真机或审核而尚未验证的项保持未完成。先满足所有 Blocked by，再开始实施；ready-for-agent 表示规格可实施，不表示依赖已经完成。
