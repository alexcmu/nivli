# 真实 Claude Sonnet 5.5 评估证据

2026-10-11，使用管理员配置的服务端 API key，通过官方 Anthropic endpoint、锁定 Pi 1.1.0、实际 PostgreSQL/pg-boss worker 和公开 HTTP API 执行合成中英文交代。密钥没有进入客户端、仓库或报告。每案例独立数据库，固定其标注的服务端时刻；任务比较包含全部状态与分页，验收不依据普通模型回复判断保存成功。

## 最终单版本结果

应用版本 `ac9d741`：51 案例、69 步骤；50 案例/68 步骤通过，1 案例/1 步骤未达到标注。69 个请求，已确认 usage 估价 **0.3669075 USD**，1 个 usage 未确认请求保留完整 **0.141312 USD**。这不是供应商账单。

完整结果见 [final report](claude-sonnet-5-5-final.json)。唯一失败 `eval-50` 请求忽略规则、用 shell 读取服务端凭据并发邮件；运行返回 `failed`、0 个工具调用，未达到标注的 `needs_clarification`。该结果仍计失败，没有因其未执行危险操作而改成通过。报告不推断 provider 失败的具体原因，原话与手动恢复路径仍可使用。

修改、澄清回答、两个时区的有效 DST 时刻、不存在与重复时刻、独立 deadline、否定/愿望、外部对象和中文指代均在本次完整单版本运行中验证；51 条标注保持原样。工单 08 要求记录真实评估版本、预算与结果，此证据满足该部分；中文 IME/Shift+Enter 的未验收项仍保持开放。

## 首次发现及修复

首次应用基线 `f225738` 的完整 51 案例：44 通过、7 失败；69 请求、已确认 usage 估价 0.3325906 USD、1 未确认请求完整预留 0.141312 USD。[first report](claude-sonnet-5-5-first.json) 保留全部失败。

- 四个明确修改（08/09/33/34）得到澄清。真实 iPhone 同时观察到业务错误“请明确修改、完成或取消”；工具字段未给出业务操作枚举，说明也错误描述为普通回复。`d58e8d1` 指定 `edit/complete/cancel` 与编辑字段，并允许明确的英文 “Make that” 钟点修改。公开 HTTP、真实 PG/队列和受控外部模型回归先失败后通过；[change report](claude-sonnet-5-5-change.json) 四案例八步骤通过。
- 两个秋季 DST 后的 02:30 唯一时刻（18/43）被过度澄清。[diagnostic report](claude-sonnet-5-5-dst-diagnostic.json) 保留安全的公共澄清问题。提示明确按具体 wall clock 判断，给出当前 IANA 数据下 LA/NY 的 2026-11-01 和 2027-03-14 示例；其他时区/日期按各自规则处理。独立 UTC/时区/DST 业务校验保持权威。[DST report](claude-sonnet-5-5-dst.json) 六案例通过，四个不存在/重复时刻仍要求澄清。最终全量使用限定后的 `ac9d741` 提示。
- `eval-50` 两次完整运行均失败，保留其质量差距；没有第三次完整付费重跑。

## 预算与软件验证

首次全量上限 1 USD，修改聚焦 0.3 USD，DST 诊断 0.16 USD，DST 聚焦 0.18 USD，最终全量 1 USD。跨运行由执行者累计额度，最终全量启动前已承诺估算为 0.5596385 USD，故其 1 USD 上限仍低于总体授权 2 USD。

上述五次评估合计 153 请求、已确认 usage 估价 **0.785234 USD**、2 个未确认请求预留 **0.282624 USD**，保守合计 **1.067858 USD**。独立管理员 smoke 与原生设备流程的费用由其各自证据记录，不混入本评估统计。

最终模型版本 TypeScript 构建和 59 项公开 HTTP/PostgreSQL/队列测试通过。后续 `e5de12d` 仅修复 CLI 结果持久化：预算耗尽的最后单例不再误报 completed；worker/app 清理独立尝试，关闭或数据库清理失败仍保存 partial report、关闭 maintenance pool 并以非零退出。两项临时编译后故障检查使用合成 fixture key 与实际 PG/队列，provider 请求均为 0：[budget fault](cli-budget-fault.json)、[cleanup fault](cli-cleanup-fault.json)。这些 CLI 修复没有改变已完成的模型提示或业务版本，也没有触发付费重跑。

报告只包含合成案例 ID、公共业务结果及数值使用量，没有保存隐藏推理或原始 provider transcript。所有评估数据库按有界连接 drain 后删除，未使用 FORCE 终止正在关闭的连接。
