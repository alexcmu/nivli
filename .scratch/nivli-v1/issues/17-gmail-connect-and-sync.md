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

- [x] OAuth 发起/回调绑定当前 owner 和连接会话，验证回调 state；仅申请读取所需范围，token 存在可信服务端并加密，不写 URL query 日志或客户端。
- [x] 连接前说明访问范围、模型数据去向与保留时间；区分 Gmail OAuth 授权和应用内 label/时间过滤。
- [x] 用户确认 label 范围，初始默认最近 7 天，可选更小窗口或仅新邮件；扩大读取范围要再次明确确认。
- [x] 默认 5 分钟增量轮询并有 jitter/backoff，首次授权和手动刷新受限；lastSuccessfulSync 与 syncError 分开显示，不承诺实时发现。
- [x] SourceItem 按账户消息 ID/内容版本去重，保存和需要的后续处理事件与 cursor 同事务；分页中断、重复拉取和 history 失效可恢复且不越出授权范围。
- [x] 凭据失效暂停来源并给重新授权入口；提供基础停止读取能力和授权版本屏障，完整衍生数据清理由 20 补齐。
- [x] 公开 API 集成测试用可控 Gmail 替代物覆盖 OAuth 回调、分页、cursor 失效、范围及授权撤回；原生页面展示授权入口、范围、最近同步和恢复动作。

**完成条件：** 验收项全部通过并附可复核证据；需要外部凭据、真机或审核而尚未验证的项保持未完成。先满足所有 Blocked by，再开始实施；ready-for-agent 表示规格可实施，不表示依赖已经完成。


## Comments

- 2026-10-11：实现只读 Google REST adapter、owner/session/state 绑定、独立文件注入的 AES-256-GCM 主密钥、确认 label/7 天或更窄/仅新邮件、重新授权的范围版本屏障、5 分钟 jitter/backoff、真实 pg-boss 增量 worker、分页/cursor 原子提交、停止读取与迟到写回拒绝。仅产生后续事件，未连接模型或正式事项。
- 可复核边界：`test/gmail.test.ts` 启动真实 HTTP API、隔离 PostgreSQL/pg-boss、可控外部 Gmail HTTP server。OAuth 回调/幂等/state/撤销会话、分页中断、去重、history 404、范围外正文不读取、凭据失效、仅新邮件、执行中停止与输入/版本校验均覆盖。`npm run build`；Gmail 5/5 与 pairing 9/9；Swift 公共 DTO 5/5。OpenAPI 和共享 JSON examples 随代码更新。
- 原生功能：独立 iOS 26.5 iPhone 17 Pro simulator。`GmailUITests.testMyGmailEntryRequiresPersonalEnvironment` 成功；真实 HTTPS API 配对及 Gmail 说明/范围/停止状态页由 `testZGmailNativeConsentRangeAndStatusAgainstPublicAPI` 成功验证，结果 `/tmp/nivli17-native-retry.xcresult` 与 `/tmp/nivli17-native-retry.log`。初次运行仅 LabeledContent 的组合文本断言失败，修正为匹配用户可见文本后通过。用户已明确不要求无障碍专项审计，本票未追加该审计。
- 实际 Google OAuth 客户端、测试用户和审核配置未提供；生产 adapter 的协议依据为 Google 官方文档并通过受控外部服务测试。没有声称真实 Google 登录、审核或真机 Google 授权完成。系统 Web 授权入口使用 ASWebAuthenticationSession；真实账户登录完成仍需按 `docs/GMAIL.md` 配置后复核。来源完整衍生数据清理由票 20，模型提取由票 18。triage 状态保留 ready-for-agent，等待 integration 分支最终审查与统一关闭记录。
