# AI 交代

本版本锁定 `@earendil-works/pi-ai` 与 `@earendil-works/pi-agent-core` 1.1.0，使用 Anthropic Claude Sonnet 5.5 (`claude-sonnet-5-5`)。Pi 仅运行应用声明的提醒 proposal、澄清和回复工具；没有文件、shell、URL 或邮箱工具。

## 配置与测试

服务端 API 和 agent 进程设置 `MODEL_API_KEY_FILE`，指向管理员提供的 Anthropic API key 文件。也支持管理员显式设置 `ANTHROPIC_API_KEY` 环境变量。不会读取 Claude Code OAuth、本机其他凭据或客户端输入。可选 `MODEL_BASE_URL` 默认为 `https://api.anthropic.com`，必须 HTTPS，无 URL 凭据。手机 `GET /v1/model` 与环境资料展示实际模型数据去向，不返回密钥。

Docker Compose 添加 `-f deploy/model.compose.yaml` 并设置 `MODEL_API_KEY_PATH`。API 与 agent 同时使用这一配置；修改后重启两者。尚未配置时交代仍然持久化，处理失败后可改用手动设置。

管理员可使用 Bearer 管理密钥向 `POST /v1/admin/model/test` 提交 `{}`。该操作发送固定合成内容、检查 schema/工具 proposal，不写业务事项。另可先构建，再显式设置 `NIVLI_REAL_MODEL_SMOKE=1` 运行 `npm run model:smoke`；输出仅包括模型身份、数值使用量与计数。真实测试会产生少量模型费用；每 run 最多 3 次请求、每次 1024 输出 token、6 个原始工具调用、60 秒硬超时，不启用 SDK 重试或模型回退。缺少管理员配置时不能宣称已完成真实模型验收。

## 业务契约

`POST /v1/inputs` 接收 `{text,timeZone}` 与 UUID Idempotency-Key，持久化原话 InputEvent 和 queued run 后返回 202 `{inputId,runId}`。事务记录构成 durable outbox，真正 pg-boss worker 周期恢复未投递记录。`GET /v1/runs/:id` 返回当前处理状态与真实 `taskId`；模型文字无法证明事项保存。POST 相同输入标识恢复同一 run，内容不同返回 409。`POST /v1/runs/:id/retry` 的独立幂等键重新排队失败 run，保留 input 身份；重复成功操作不会创建第二事项。

服务端提供 owner、设备、当前时间、时区和允许证据。工具仅输出 proposal；独立业务校验阻止身份字段、非字符串强制转换、非明确指令、原文之外的证据、错误时区/时间、过去日期、DST 重叠及普通愿望。当前确定性日期校验支持明确年月日、今天/明天/后天与数字时刻，其他表达先澄清。操作身份从 InputEvent ID 派生，源证据标记 `instruction`。事务再次检查 run、设备及 session 权限，避免晚到/已失效结果提交。

本地提醒沿用同一事务命令与 occurrence/installation receipt 契约。确认卡查询当前真实事项并安排本地通知，显示实际安装状态，安静时段必须先确认。该服务器的独立静默预算/完整多轮修改由工单 08/09 扩展。

## 失败、取消与预算恢复

运行状态为 `queued/running/needs_clarification/succeeded/failed/cancelled/timed_out`。20 秒后 `stillProcessing` 明确表示仍在处理，不提前宣称成功；每次尝试默认 60 秒硬期限。`GET /v1/runs/:id` 返回持久化原话、时区、处理结果和真实事项身份。`POST /v1/runs/:id/cancel` 使用独立 UUID 幂等键，停止尚未完成的执行，后续请求、工具及提交再次检查持久化状态和尝试身份。已提交事项保留成功结果，取消不会声称撤销它。失败、超时或取消可通过 retry 恢复同一输入身份；缺信息应补充回答。

API 与 agent 配置同一 `MODEL_DAILY_BUDGET_USD`（默认 1 USD，范围 0–10000）和 `MODEL_MAX_OUTPUT_TOKENS`（默认 1024，范围 128–1024），修改后同时重启。预算按 **UTC 日期、UTC 00:00** 重置。每次请求在数据库事务内锁定当天预算，先预留 65536 输入 token（涵盖 16000 UTF-16 字符上下文、工具结果与 provider 封装）及最大输出 token 的保守费用；Pi 每次请求都会重新检查上下文增长。已确认 usage 按 token 费率与 SDK 估价的较高值记账；超出预留也计入下一次请求的预算检查。传输中断、取消、进程崩溃且 usage 未确认时保留完整预留，不假定费用为零。记录仅包含数值、请求/运行身份，不保存模型隐藏推理或原始 provider 数据。

管理员 `GET /v1/admin/model/budget` 返回 UTC 日期、额度、预留估算、已确认 usage、usage 未确认的请求数量和剩余可用额度。运行结果 `cost` 同样区分预留、usage 与未知请求；`invoiceAvailable:false` 明确这些都不是 provider 账单。管理员 `/v1/admin/model/test` 使用同一生产预算，预算不足返回 `MODEL_BUDGET_EXHAUSTED`。CLI smoke 则是显式启用的独立测试：`MODEL_SMOKE_BUDGET_USD` 默认为 0.5 USD、最高 1 USD，每次请求预留后才发送；它会产生模型费用，**不共享生产每日预算**，输出注明独立预算与账单不可用。

运行 lease 用数据库时间更新。进程被终止后未确认请求由队列重新执行，可能再次产生模型费用；原业务操作使用稳定 InputEvent UUID，且业务写入与运行成功在同一事务提交。旧尝试的晚到结果不能提交。API、agent 和 delivery 分开运行，agent 单个 worker 的并发额度为 1；模型阻塞或预算耗尽不会占用 API 或 delivery 配额，也不会影响设备已安装的离线提醒。

## 真实模型评估

`npm run model:eval` 默认只写 `not_run`，必须显式设置 `NIVLI_REAL_MODEL_EVAL=1` 与服务端模型配置才调用付费模型。`MODEL_DAILY_BUDGET_USD` 是本次评估的全局上限，默认 1 USD、最高 2 USD；每个标注案例使用独立 PostgreSQL 数据库、实际 API 和 pg-boss worker，累计已确认 usage 与未知请求的完整预留后，才允许下一案例请求。模型失败仍记录为失败；没有足够预算执行的案例记录为 `unevaluated`，不能视作语义通过或失败。

任务比较通过公开 API 的 `status=all` 分页进行，包含完成和取消事项，避免默认 active 筛选伪造数量变化。报告完成前为 `running`，完成后才为 `completed`；其含义是评估已执行，逐例 `passed` 才表示标注达成。`NIVLI_EVAL_REPORT` 指定报告路径；修复后可用 `NIVLI_EVAL_CASE_IDS=eval-08,eval-09` 进行聚焦重跑，必须保留原始失败结果。跨 CLI 调用的费用不会自动共享数据库，执行者必须累计各次 usage 与未知预留，确保合计不超过授权限额。

2026-10-11 的真实 Anthropic Claude Sonnet 5.5 结果见 [评估证据](evals/claude-sonnet-5-5-evidence.md)。这些数值是 usage/估价与保守预留，不是供应商账单；常规 CI 使用受控外部提供方，不随机调用付费模型。
