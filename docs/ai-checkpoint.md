# AI agent implementation checkpoint

2026-10-11，集成分支 `integration/haiji-v1`，最新代码提交 `092a0b3ae6be5176510dd669e0c80d9c7b47795d`。早期软件检查点为 `20cb1c7`；本次补充真实 Claude 验证。

07–09 的软件闭环已合入：持久化输入与实际 Pi/pg-boss 执行、多轮澄清与修改、当前事项确认卡和本地安装回执、取消与超时、稳定重试及每日模型预算。邮件连接按用户要求继续延后；此检查点不代表完整 v1 已完成。

## Validation

- 最终 60 项真实 HTTP/PostgreSQL/pg-boss 测试、19 项 Swift 测试、TypeScript 构建、原生构建和隔离契约导出通过。
- 受控外部 Anthropic 服务的真机测试验证单轮提交、执行中重启恢复、一次业务结果、真实系统通知安装及通用隐私文案；多轮真机测试验证澄清回答、自然语言修改和重启后的当前历史。
- 实际 Claude Sonnet 5.5、Pi 1.1.0 与 pg-boss 的签名真机测试通过（70.212 秒）：动态澄清、关联时间回答、保存唯一事项、同一事项修改至 revision 2、重启当前历史、真实 OS pending=1 和隐私预览。三个 run 各一次模型请求和一次工具调用，详见真实设备证据。
- 用户确认锁屏且离线时收到本地提醒，记录见 ticket 03。
- 最新代码用团队 `Q974D4E3V6` 成功签名，并通过 `devicectl` 更新到测试 iPhone 的 `app.haiji.Haiji`，包括拒绝请求不自动关联澄清的原生修复。安装保留原 App 数据，未卸载正式测试 bundle。签名日志 `/tmp/haiji-ai-real-claude-signed.log`，构建 `/tmp/haiji-ai-final-signed/Build/Products/Debug-iphoneos/Haiji.app`。
- 临时测试 App、数据库、私有 fixture、HTTPS tunnel 和实施 worktree 已清理。

## Standards

审查基准 `36bb8c8...8a10665`；复核修复提交 `7a3a6e8`、`da2855b`。未发现仓库书面规范违规。

发现并修复了取消后重试复用旧取消标识，以及重试确认响应延迟期间 Stop 意图丢失的问题。停止意图现在先持久化，收到初次提交或重试确认后发送正确的取消命令；响应不确定及重启不会丢失操作身份。创建与修改共用安静时段判断，删除重复和未使用的副本。原审查者的定向复核确认以上问题解决，无新增实质问题。

## Spec

发现并修复了否定/条件表达可能提交无条件事项变更，以及明确截止日期被模型遗漏或无法验证的问题。创建、修改、完成和取消共用当前授权判断；规格原句“明天九点提醒提交材料，周五截止”保存独立提醒和周五截止日期。相对日期采用输入到达服务器的时间及原时区，提交时仍检查提醒是否已过期。原审查者定向复核确认修复，无新增实质问题。

最终未解决的代码审查发现：Standards 0，Spec 0。

## Real model results

管理员配置服务端 key 后，真实契约冒烟通过。完整单版本 `ac9d741` 评估 51 条中英文案例、69 步骤：50 案例通过，唯一拒绝类案例返回通用失败。修改工具操作枚举、英文省略修改和 DST 唯一时刻提示的修复在这次全量中通过。

后续定位到 SDK 将明确的 refusal/sensitive 映射为 error；现已提供静态 `MODEL_REFUSED` 反馈、结算已知用量、阻止部分工具和澄清授权链。修复版本 `344fb71` 的真实失败案例专项通过（一次请求、零工具调用）。完整 50/51 与后续专项属于不同版本，原报告均保留，没有声称最新版重新跑了完整 51 条。评估 CLI 的预算耗尽/清理异常报告路径也通过零模型调用故障检查。

Standards 与 Spec 定向复审确认新增修复，无实质未解决发现。七次评估保守估算合计 1.076034 USD；加上独立冒烟与真机模型尝试，合计约 1.115208 USD，包含未知请求预留，不代表供应商账单。密钥仅留在服务器私有文件，未进入手机、仓库或报告。详细版本、结果和费用见 [真实评估证据](evals/claude-sonnet-5-5-evidence.md)，配置见 [model.md](model.md)。

## Outstanding acceptance

真实中文 IME 组合输入和 Shift+Enter 尚未观察，07/08 对应验收项继续保持未完成。

设备通知权限关闭、锁屏通知动作认证及旧通知打开的剩余验收仍分别记录在 03/04，未以本检查点代替。

详细证据见 [review fixes](ai-review-fixes-evidence.md)、[真实设备](live-ai-device-evidence.md)、[07 controlled device](ticket-07-device-evidence.md)、[08](ticket-08-evidence.md)、[09](ticket-09-evidence.md)。
