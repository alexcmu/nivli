# 23: 导出个人数据

**What to build:** 用户从“我的”发起导出并下载可迁移的结构化个人数据；生成期间发生删除、链接过期或会话失效时，下载不会暴露已无权访问的内容。

**Blocked by:** [22: 删除对话或整个个人环境](22-delete-conversation-and-environment.md)

**Status:** ready-for-agent

**Parent:** [Nivli v1 Engineering Specification](../spec.md)

**规格定位：** US-55–US-57；D-05、D-07、D-10、D-13；AC-18。引用场景按本票范围验收，不要求提前实现其他票的功能。

**交付范围：** 自签名 v1 必需范围。 依赖 22 的 deletion epoch 与授权终止语义，以便从第一版导出就验证删除竞态。提供导出，不增加导入产品范围。

**界面依据：** [Nivli UI 设计](../../../archived/nivli-ui-design.md)。使用原生 SwiftUI，沿用父规格的可访问性与错误反馈要求。

**测试边界：** 沿用父规格 T-01/T-02：从公开 API 验证外部可见行为，使用真实 PostgreSQL/pg-boss，仅替代模型、邮箱和推送等外部服务；涉及系统通知、权限或离线的结果补充原生真机证据。新增或修改的 API 同步维护 OpenAPI 与 Swift DTO 契约。

## Acceptance criteria

- [ ] POST /v1/exports 创建 owner 范围内异步导出 job，用户可查看处理中、完成、失败和重试结果。
- [ ] 输出带 schemaVersion 的 JSON 与必要附件清单，包含事项、提醒、记忆、偏好、来源引用及授权保留的依据；字段与日期/时区语义有说明。
- [ ] 私钥、session/OAuth/APNs token、模型 key、隐藏推理与第三方登录信息不进入导出或日志。
- [ ] 下载短时有效且每次鉴权；导出完成不代表永久授权，过期自动清理生成物，设备吊销后下载失败。
- [ ] 生成、结果发布及下载分别检查 data revision/deletion epoch；期间发生相关删除时失效、重做或终止，不能返回已经删掉的内容。
- [ ] 真实队列通过公开 API 测试请求→生成→下载→过期，覆盖删除竞态、重复请求和越权访问；原生界面可触发并分享/保存真实导出文件。

**完成条件：** 验收项全部通过并附可复核证据；需要外部凭据、真机或审核而尚未验证的项保持未完成。先满足所有 Blocked by，再开始实施；ready-for-agent 表示规格可实施，不表示依赖已经完成。
