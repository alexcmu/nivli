# 17: 连接 Gmail 与控制读取范围

**What to build:** 用户主动连接一个只读 Gmail 账户，确认读取范围和初始历史窗口，并在“我的”看到同步成功、失败或需要重新授权。

**Blocked by:** [01: 部署个人环境并配对 iPhone](01-deploy-and-pair.md)

**Status:** ready-for-agent

**Parent:** [Nivli v1 Engineering Specification](../spec.md)

**规格定位：** US-05、US-31–US-32、US-38、US-57；D-03、D-05、D-07、D-10、D-12–D-13；AC-01、AC-13、AC-16。引用场景按本票范围验收，不要求提前实现其他票的功能。

**交付范围：** 自签名 v1 必需范围。 建立授权、受限增量同步与来源状态的完整用户路径。邮件建议由 18 接入；在此之前不把邮箱内容自动发送给模型或显示成事项。

**界面依据：** [Nivli UI 设计](../../../archived/nivli-ui-design.md)。使用原生 SwiftUI，沿用父规格的可访问性与错误反馈要求。

**测试边界：** 沿用父规格 T-01/T-02：从公开 API 验证外部可见行为，使用真实 PostgreSQL/pg-boss，仅替代模型、邮箱和推送等外部服务；涉及系统通知、权限或离线的结果补充原生真机证据。新增或修改的 API 同步维护 OpenAPI 与 Swift DTO 契约。

## Acceptance criteria

- [ ] OAuth 发起/回调绑定当前 owner 和连接会话，验证回调 state；仅申请读取所需范围，token 存在可信服务端并加密，不写 URL query 日志或客户端。
- [ ] 连接前说明访问范围、模型数据去向与保留时间；区分 Gmail OAuth 授权和应用内 label/时间过滤。
- [ ] 用户确认 label 范围，初始默认最近 7 天，可选更小窗口或仅新邮件；扩大读取范围要再次明确确认。
- [ ] 默认 5 分钟增量轮询并有 jitter/backoff，首次授权和手动刷新受限；lastSuccessfulSync 与 syncError 分开显示，不承诺实时发现。
- [ ] SourceItem 按账户消息 ID/内容版本去重，保存和需要的后续处理事件与 cursor 同事务；分页中断、重复拉取和 history 失效可恢复且不越出授权范围。
- [ ] 凭据失效暂停来源并给重新授权入口；提供基础停止读取能力和授权版本屏障，完整衍生数据清理由 20 补齐。
- [ ] 公开 API 集成测试用可控 Gmail 替代物覆盖 OAuth 回调、分页、cursor 失效、范围及授权撤回；原生页面展示授权入口、范围、最近同步和恢复动作。

**完成条件：** 验收项全部通过并附可复核证据；需要外部凭据、真机或审核而尚未验证的项保持未完成。先满足所有 Blocked by，再开始实施；ready-for-agent 表示规格可实施，不表示依赖已经完成。
