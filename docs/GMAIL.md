# Gmail 只读来源

管理员在自己的 Google Cloud project 中启用 Gmail API，创建 **Web application** OAuth 客户端，登记精确 redirect URI `https://<PUBLIC_URL 主机>/v1/gmail/oauth/callback`。Google OAuth consent screen 的测试用户必须包含自己的测试账户。按 Google 控制台实际要求完成发布/审核；本项目的自动化替代物测试不代表 Google 真实账户授权成功，也不代表完成审核。

客户端 JSON 文件形如 `{"clientId":"your-web-client-id","clientSecret":"your-web-client-secret"}`。单独生成加密密钥文件 `openssl rand -hex 32 > gmail-token-key`，设置文件权限为 600。两者通过 `GMAIL_CONFIG_FILE` 与 `GMAIL_TOKEN_KEY_FILE` 注入 API 和 agent worker，或使用 `deploy/gmail.compose.yaml` 覆盖配置（`GMAIL_CLIENT_PATH`、`GMAIL_TOKEN_KEY_PATH`）。主密钥不进入数据库，不与管理员密钥共用，必须独立于数据库备份妥善保存。更换/丢失密钥前先停止全部来源，重新启动后需重新授权；不要直接轮换密钥并期待旧凭据仍可解密。

iPhone 在“我的 → Gmail”选择 label、历史窗口及缓存时间，阅读说明，再确认并进入系统 Web 授权会话。初始默认最近 7 天，支持 3/1 天及仅新邮件；选择多个 label 时按任一匹配读取，可输入自定义 `Label_...` ID。Google 授权 scope 仅为 `gmail.readonly`，实际包含整个邮箱的读取权限。Haiji 的 label/时间过滤是应用内约束，不能误称 Google 的细分授权。扩大范围通过再次确认和重新授权实现。一个 owner 只连接一个邮箱；重新授权要求同一账户。

首次同步与手动刷新均受限，正常 history 增量轮询 5 分钟 ± 30 秒。每页最多 30 个消息/记录，每次扫描最多 200 页，每项正文只保留必要 header 与最多 12,000 字符纯文本，不请求附件、不抓取正文中的链接。不足以完成大窗口时显示失败；用户可以选更窄范围后重授权。失败按 1 分钟开始的指数退避及随机间隔重试，最多 1 小时。`lastSuccessfulSync` 只在完成整个扫描时推进，`syncError` 单独记录。分页提交 SourceItem、后续事件和续页状态在同一事务中；最终 cursor 的 history baseline 在初始列表前取得，以免漏掉列表期间新增邮件。history 404 重建同一个已授权时间/label 范围。授权失败暂停来源，重新授权入口保留。

正文缓存默认 7 天，可选 3/1 天，重复消息不会延长同内容版本的原文缓存寿命。删除正文后仍保留不含正文的最小去重 identity 和后续事件。停止读取删除加密 token、提升授权 revision 并禁止旧 job 写回和读取来源项；完整衍生数据清理由工单 20 提供。目前后续事件不发送模型、不创建正式事项。备份中残留数据最长 7 日。

应用服务器关闭 request URL/query 日志，所有错误均不回显 Gmail 响应/凭据。OAuth 标准的 Google 回调带短时 `code` 和随机 `state` query；不要在反向代理记录该回调的原始 URI，代理访问日志关闭或仅记录无 query 的 path。该回调不包含 access/refresh token；回到 iPhone 的 URL 仅有结果标记，凭据全程在服务端。OAuth code 单次消费，state 绑定 owner、连接会话和来源 revision；会话撤销后回调不能建立来源。

## 验证依据

Google 官方 REST 文档：[只读 scope](https://developers.google.com/workspace/gmail/api/auth/scopes)、[服务端授权](https://developers.google.com/identity/protocols/oauth2/web-server)、[history.list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list)、[同步与失效 cursor](https://developers.google.com/workspace/gmail/api/guides/sync)。生产 adapter 使用这些 REST 边界，无额外第三方 SDK。

`npm test -- --run test/gmail.test.ts` 启动真实 HTTP API、真实 PostgreSQL/pg-boss 与可控外部 Gmail HTTP server。覆盖状态绑定、分页中断、幂等重复、授权范围过滤、history 404、授权过期、仅新邮件与执行中停止的版本屏障。真实 Google 凭据与 consent screen 尚未提供，实际 Google 授权、审核及 iPhone 上 Google 登录完成仍需环境配置后复核。
