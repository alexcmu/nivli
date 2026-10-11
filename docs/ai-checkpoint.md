# AI agent implementation checkpoint

2026-10-11，集成分支 `integration/nivli-v1`，代码提交 `20cb1c765fc74473fe22adbb3e7c9c22ddd5191c`。

07–09 的软件闭环已合入：持久化输入与实际 Pi/pg-boss 执行、多轮澄清与修改、当前事项确认卡和本地安装回执、取消与超时、稳定重试及每日模型预算。邮件连接按用户要求继续延后；此检查点不代表完整 v1 已完成。

## Validation

- 最终 58 项真实 HTTP/PostgreSQL/pg-boss 测试通过，无未处理错误；17 项 Swift 测试、TypeScript 构建和原生构建通过。
- 受控外部 Anthropic 服务的真机测试验证单轮提交、执行中重启恢复、一次业务结果、真实系统通知安装及通用隐私文案；多轮真机测试验证澄清回答、自然语言修改和重启后的当前历史。
- 用户确认锁屏且离线时收到本地提醒，记录见 ticket 03。
- 最新代码用团队 `Q974D4E3V6` 成功签名，并通过 `devicectl` 更新到测试 iPhone 的 `app.nivli.Nivli`。安装保留原 App 数据，未卸载正式测试 bundle。签名日志 `/tmp/nivli-ai-final-signed.log`，构建 `/tmp/nivli-ai-final-signed/Build/Products/Debug-iphoneos/Nivli.app`。
- 临时测试 App、数据库、私有 fixture、HTTPS tunnel 和实施 worktree 已清理。

## Standards

审查基准 `36bb8c8...8a10665`；复核修复提交 `7a3a6e8`、`da2855b`。未发现仓库书面规范违规。

发现并修复了取消后重试复用旧取消标识，以及重试确认响应延迟期间 Stop 意图丢失的问题。停止意图现在先持久化，收到初次提交或重试确认后发送正确的取消命令；响应不确定及重启不会丢失操作身份。创建与修改共用安静时段判断，删除重复和未使用的副本。原审查者的定向复核确认以上问题解决，无新增实质问题。

## Spec

发现并修复了否定/条件表达可能提交无条件事项变更，以及明确截止日期被模型遗漏或无法验证的问题。创建、修改、完成和取消共用当前授权判断；规格原句“明天九点提醒提交材料，周五截止”保存独立提醒和周五截止日期。相对日期采用输入到达服务器的时间及原时区，提交时仍检查提醒是否已过期。原审查者定向复核确认修复，无新增实质问题。

最终未解决的代码审查发现：Standards 0，Spec 0。

## Outstanding acceptance

真实 Claude Sonnet 5.5 契约冒烟与评估尚未运行。评估集有 51 条标注样本，实际报告为 `not_run`、0 条模型结果；受控 provider 证据不代表真实 Claude 质量。管理员仍需提供模型 API key 的本地文件路径或环境变量名；配置见 [model.md](model.md)。真实中文 IME 组合输入和 Shift+Enter 尚未观察，07/08 对应验收项继续保持未完成。

设备通知权限关闭、锁屏通知动作认证及旧通知打开的剩余验收仍分别记录在 03/04，未以本检查点代替。

详细证据见 [review fixes](ai-review-fixes-evidence.md)、[07 device](ticket-07-device-evidence.md)、[08](ticket-08-evidence.md)、[09](ticket-09-evidence.md)。
