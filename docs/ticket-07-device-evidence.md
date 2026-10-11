# 工单 07：AI 交代的原生真机闭环

2026-10-11 在用户授权的测试 iPhone Alchemist 上，通过开发签名运行 `AgentUITests.testZDurableAgentInputCreatesSystemReminderAndRecoversAfterRelaunch`。签名使用已授权开发团队；使用临时独立 bundle `app.nivli.agentvalidation`，不替换或修改现有 Nivli 应用、连接或数据。

## 验证路径和结果

- 新建独立 PostgreSQL 数据库及 HTTPS 测试环境，使用真实 API、pg-boss worker 和发布版本 Pi 1.1.0；仅在外部 Anthropic HTTP 边界返回受控 schema/工具结果，没有调用真实 Claude 或读取其他凭据。
- 在生产原生“交代”页面输入含明确日期和 15:30 的中文 Unicode 指令，以 Enter 提交。出现“正在处理，原话已保留…”后终止应用；外部模型延迟 10 秒，重开应用从 Keychain draft/run 恢复，保留相同原话。
- 手机展示真实当前标题、时间/时区、来源，以及“本机已安排”。测试通过公开 API 独立读取，只有一个任务、一次模型 HTTP 请求，事项提醒状态为 `local_installed`。
- 通过只读 DEBUG 验收入口直接查询 `UNUserNotificationCenter.pendingNotificationRequests()`，匹配公开 API 返回的真实 task ID，实际系统 pending 为 1，通知标题和正文均为生产默认通用预览。该入口不创建、修改或清理提醒。
- 再次重开生产页面确认仍显示当前事项；随后通过公开界面认证吊销测试 session 并断开，清理该测试安装身份的通知。

正确构建的聚焦真机测试结果为 **TEST SUCCEEDED**。初次运行只有 DEBUG 检查器使用了猜测的默认正文导致预览断言失败；改为生产默认正文并重建后同一聚焦场景通过，未改变业务或通知实现。私有结果：`/tmp/nivli07-device-validation-retry.xcresult`；测试日志：`/tmp/nivli07-device-retry.log`。结果与日志可能包含临时环境元数据，不发布到仓库。

## 边界与清理

程序化 Unicode 输入验证已提交文字及 Enter 行为，不能代替真实中文输入法 marked-text 组合验收。中文组合与 Shift+Enter 的人机观察仍未完成；真实 Claude Sonnet 5.5 schema/工具冒烟仍待管理员显式提供服务端 API key。系统 pending 不宣称用户已经收到或看到这条次日通知。

测试结束后关闭 worker/API/受控模型服务，删除独立数据库，停止 HTTPS tunnel，移除源码和测试 bundle 中的 `AgentFixture.json`，恢复默认项目 bundle/signing 设置，并卸载两个临时测试 app。现有 Nivli 与其通知命名空间未改变，手机已释放。

## 重复运行入口

`AgentUITests.swift` 默认在没有私有 `AgentFixture.json` 时跳过。隔离 fixture 的字段为 `serverUrl`、一次性 `code`、合成 `instruction`、合成 `title`、`proofUrl`。`proofUrl` 只对该独立 fixture 暴露公开任务读取的结果 `{requests,tasks}`；测试不直接读取数据库。为 fixture 配置独立 app bundle 后，通过现有 `generate-project.rb` 把临时 JSON 包入测试 bundle，再运行上述单个测试。结束时移除 JSON、生成默认项目并清理测试资源；不要提交凭据或复用真实用户环境。

## 真实 Claude 补充验收

2026-10-11 管理员提供服务端密钥后，已在独立数据库、HTTPS 环境和临时原生 bundle 上，用真实 Claude Sonnet 5.5 / Pi 1.1.0 完成缺时间澄清、重启恢复、关联回答保存、同一事项时间修改、当前历史重启恢复、实际 OS pending=1 与 `local_installed`。修复工具 operation 契约后聚焦真机测试 1 项通过（70.212 秒），3 个 run 各 1 次请求与 1 次工具，用量估价 USD 0.0164388。首次实际模型失败和隔离 Keychain 的测试问题均如实记录；完整路径、费用及清理见 [真实模型真机证据](live-ai-device-evidence.md)。此前“真实模型凭据尚缺”的描述是当时状态；IME composition 和 Shift+Enter 仍未验收。
