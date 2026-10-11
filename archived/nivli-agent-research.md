# Nivli：Agent 与后端基础设施核查

研究日期：2026-10-10。依据 PRD v0.3。本文区分「已核实事实」和「架构建议」。没有运行产品基准测试，没有把框架宣传语当作本产品的实测结论。

## 结论

**建议采用 TypeScript / Node.js 的 API + 独立 worker + PostgreSQL + pg-boss，以 Pi 的 `pi-ai` / `pi-agent-core` 实现可替换的 agent adapter。** API 与 worker 属于同一个模块化后端、复用一份代码和镜像，但使用不同进程入口。提醒状态、授权、任务修改、通知调度和删除语义由应用自己的业务层掌握。

这个判断来自 Nivli 的工作形态：多数操作是短时理解、检索和生成建议；明确提醒一旦存储，不应该继续依赖模型运行。开发重点是可靠地兑现已确认安排，而不是让一个通用 coding agent 永久在线。

**DeepSeek Harness 是真实的 DeepSeek 官方项目，不应误写为 LangChain Deep Agents。** 本次已核实官方介绍和仓库。它能力完整，但仍明确标为 developer preview；对 Nivli 首版，SDK 调用语义和默认工具边界带来的适配成本高于 Pi core。可以保留实验 adapter，暂不作为唯一生产依赖。[DeepSeek 官方介绍](https://www.deepseek.com/harness/en/)、[仓库说明](https://github.com/deepseek-ai/deepseek-harness)

## 1. DeepSeek Harness 与 Pi：真正需要比较的差异

### DeepSeek Harness：适合深度定制整个 harness

**已核实事实：** dsh 基于 Cordis，模型、工具、session、agent loop 都是可替换插件；提供 `web`、`headless`、`sdk`、`sdk-minimal` 等 profile，具有 session event log 与持久化扩展点。不能把它描述成“只有 CLI、没有 SDK”。[架构文档](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/docs/architecture.md)

TypeScript 的 `@deepseek-ai/dsh-sdk-client` 启动独立 runtime 子进程，通过 stdio JSON-RPC 驱动它。当前文档明确：没有 mid-turn cancel，放弃执行需关闭 runtime；`run()` 的结果是从 prompt 入队回执到下一次 idle 期间最后一条已提交 assistant 响应，并非严格归属于某一 prompt；用于未来 approval 的双向请求尚未实现。并行 steering、注入上下文和请求归属需要应用额外约束。[SDK client](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/sdk/client/README.md)

`sdk-minimal` 默认提供 persistent shell 和 working-directory 工具，采用 danger-full-access，并省略许多完整 profile 服务。它是最小 coding runtime，不是默认受限的个人提醒引擎。[最小 SDK profile](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/bundle/sdk-minimal/README.md)

**对 Nivli 的判断：** 如果未来核心产品变成用户可安装插件、复杂代码执行、长期多代理协作，dsh 的可组合性很有吸引力。首版若只是读授权信息、产生建议并调用少量领域工具，需要裁剪 coding 能力、管理子进程、实现权限与业务持久化，收益暂不足以抵消成本。官方还明确提示尚未经安全审计，不应将 harness 自身作为唯一隔离层。[安全说明](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/SAFETY.md)

### Pi：选择基础库，而不是把 coding CLI 当服务器

**已核实事实：** 原 `badlogic/pi-mono` 地址在本次读取时重定向至 `earendil-works/pi`。当前文档使用 `@earendil-works/pi-ai`、`@earendil-works/pi-agent-core`，旧文章中的 `@mariozechner/*` 不应未经验证直接写进新项目依赖。Pi 仓库为 MIT，明确不内建限制 filesystem/process/network/credential 的权限系统。[官方仓库](https://github.com/earendil-works/pi)

`pi-ai` 提供模型 provider 抽象、流式请求、token 与成本记录，并支持自定义 provider。`pi-agent-core` 提供有状态工具循环、事件、工具前后钩子、请求准备与 abort，可直接由 TypeScript 进程调用。Nivli 可以只注册自己的领域工具。[pi-ai](https://github.com/earendil-works/pi/blob/ea448f454af474f3e2fe9733b331e17b0662f5d6/packages/ai/README.md)、[pi-agent-core](https://github.com/earendil-works/pi/blob/ea448f454af474f3e2fe9733b331e17b0662f5d6/packages/agent/README.md)

**时效性细节：** Pi 已提供 `pi-durable`，所以“Pi 完全没有 durable execution”已不是准确表述。该包有恢复、requestId 去重与持久化任务；列出的 storage 包括 Memory、SQLite、JSONL 和 Cloudflare Durable Object。文档同时明确同一 storage 由一个进程拥有，不提供跨进程锁；本次文档未列出 Postgres adapter。SQLite 默认 WAL / NORMAL 的进程崩溃保障也不能扩写成任意主机断电零丢失。[pi-durable](https://github.com/earendil-works/pi/blob/ea448f454af474f3e2fe9733b331e17b0662f5d6/packages/durable/README.md)

**对 Nivli 的判断：** 首版采用 core + 应用 Postgres 状态，避免同时维护业务数据库和另一套会话文件数据库。worker 重启后，从已存输入和 run 状态安全重试短任务；所有写操作幂等。这个方案不承诺从任意 token 精确继续运行，可能重复少量模型费用。长任务恢复变得重要时，再评估 pi-durable 的单进程所有权模型或 LangGraph。选择 Pi 不意味着获得现成的权限、调度或业务记忆系统；这些仍需实现。

### LangChain Deep Agents：相关备选，不是 DeepSeek 产品

**已核实事实：** Deep Agents 有 Python 与 JavaScript/TypeScript 实现，二者仓库均为 MIT；JS 有 Node server 入口，返回编译后的 LangGraph graph，可使用其 streaming/checkpointer 等能力。默认规划、文件系统、子代理和上下文管理较完整，不必为了选它把整个后端改成 Python。[JS 仓库](https://github.com/langchain-ai/deepagentsjs)、[Python 仓库](https://github.com/langchain-ai/deepagents)

LangGraph 区分 thread checkpoint 与跨线程 store，支持持久化 checkpointer；内存 saver 不跨重启保存。它支持恢复与 human-in-the-loop，但 graph checkpoint 仍不能替代 Nivli 自己的事项与通知账本。[持久化文档](https://docs.langchain.com/oss/javascript/langgraph/persistence)

**对 Nivli 的判断：** 若接下来确实需要跨天等待用户审批、分支恢复和复杂多步研究，可优先考察 LangGraph JS 或 LangChain `createAgent`，再判断是否需要全套 Deep Agents。简单提醒解析没有必要每次都规划、分派子代理和读写虚拟文件。只有团队明显偏好 Python、或确实需要 Python 专有处理库，才值得增加 Python worker 和跨语言契约。默认工具权限仍应由应用强制，而不能期待模型自行遵守。[Deep Agents 适用范围](https://docs.langchain.com/oss/javascript/deepagents/overview)

## 2. 推荐的后端分工

以下均为架构建议，不是已实现能力。

- **API：** TypeScript / Node.js，Fastify 或同等轻量 HTTP 框架；负责身份、设备、事项 CRUD、同步、授权与输入入队。Swift 客户端以 OpenAPI 契约生成或校验 DTO。
- **Worker：** 同一代码库、独立入口；执行 agent run、邮箱同步、建议生成、到期通知。按队列隔离模型慢任务与提醒投递，防止邮箱积压拖慢准时提醒。
- **PostgreSQL：** 保存 task、reminder、suggestion、memory、source evidence、permission、agent run、tool operation 和 notification occurrence。业务表是事实来源。
- **pg-boss：** 持久化短任务、重试、到期唤醒。首版不额外引入 Redis/Kafka；吞吐或隔离需求经测量后再拆。
- **检索：** 初期结构化条件 + 全文检索；语义检索有明确收益后加 pgvector。embedding 是可重建索引，原始记忆、确认状态和来源存放在普通表中。
- **部署：** 一个应用镜像启动 api、worker 两种命令，配 PostgreSQL 容器和持久 volume；可选反向代理终结 TLS。数据库不暴露到公网；迁移以独立一次性步骤运行。

Node 对这种 HTTP、数据库、LLM、邮箱等 I/O 为主的工作是合适的。这里真正的区别是“同步请求内跑一切”与“持久任务 + worker”，不是 JavaScript 能否做 AI 后端。CPU 密集附件解析、转码或本地模型推理以后可以独立进程部署。

自托管交付应提供锁定版本的镜像、arm64/amd64 构建、示例配置、健康检查、数据库备份与恢复说明。模型密钥、OAuth token 和 APNs 凭证不进入镜像或仓库；密钥以独立 secret 注入。个人实例先做单用户，表中仍明确 owner 身份，工具 handler 从认证上下文取 owner，不能采信模型传入的 userId。

## 3. pg-boss 可以简化部署，但不能许诺端到端 exactly-once

**已核实事实：** pg-boss 基于 PostgreSQL `SKIP LOCKED` 实现并发领取，支持延迟、重试、死信、调度等；当前文档要求 Node 22.12+、PostgreSQL 13+，采用 MIT。[仓库说明](https://github.com/timgit/pg-boss/blob/aa3b4f3ccb68fa610caf62ba04985deb9bc801b1/README.md)

`send()` 等操作接受 `db` adapter，可以与业务写入使用同一数据库事务。事务 rollback 时 job 一起 rollback；文档提供 Drizzle、Kysely、Knex、Prisma adapter。[事务 adapter](https://github.com/timgit/pg-boss/blob/aa3b4f3ccb68fa610caf62ba04985deb9bc801b1/docs/api/adapters.md)

`standard`、`singleton`、`exclusive` 等 queue policy 控制排队或运行中的并发，不等价于所有副作用永不重复。`singleton` 的语义是每个 key 最多一个 active，仍允许多个 queued。延迟 job 通过到期后的 polling 领取；LISTEN/NOTIFY 不能让未来时间提醒变成硬实时。[队列文档](https://github.com/timgit/pg-boss/blob/aa3b4f3ccb68fa610caf62ba04985deb9bc801b1/docs/api/queues.md)

**实现要求：**

1. 创建或修改事项时，在一个数据库事务里写业务状态及入队。使用相同 transaction adapter；不能先 commit 事项再无保护地调用 `send()`。
2. job 只带 `reminderId + revision + occurrenceId` 等引用。执行前重新读取当前状态；取消、完成或版本落后就结束，不发旧提醒。
3. 对业务操作建立持久唯一键；以 run id / 输入事件 id / 操作类型等生成稳定 operation key，不能只依靠模型重新生成的 tool-call id。
4. APNs 请求无法加入 PostgreSQL 事务。若发送成功后 worker 崩溃而数据库尚未记账，重试存在重复窗口。记录 pending/sending/accepted/unknown/failed，定义 unknown 的重试策略，并由 occurrence id 与客户端版本检查降低重复影响。不能以 pg-boss 或事务的名义承诺最终通知恰好展示一次。
5. 明确提醒的长期日程保存在业务表。当前 job 文档默认 created/retry retention 为 14 天；因此建议按滚动窗口入队，例如只物化未来 24 小时的 occurrence，并定期修复缺失 job，避免把半年后的提醒仅作为默认配置下的一条队列记录保存。[job retention / deferral](https://github.com/timgit/pg-boss/blob/aa3b4f3ccb68fa610caf62ba04985deb9bc801b1/docs/api/jobs.md)
6. 监控最老 pending age、due lag、重试、死信和 unknown delivery；服务恢复时先判断过期提醒是否仍有价值，不补发一串历史通知。

## 4. Agent 的权限与记忆边界

建议工具最初只开放 `findRelevantTasks`、`readAllowedEvidence`、`lookupConfirmedMemory`、`proposeTaskChange`、`proposeMemory`、`explainReminder`。这些是示意名称，不是任何框架现成 API。

模型生成带 schema 的意图，领域服务检查授权、对象归属、版本、时间解释和操作来源。用户明确交代的事项可以在校验后直接保存并回显，不必多加一次确认；来自邮件的推测必须存为 suggestion，用户接受后才产生承诺。任何邮件正文都只是证据，不能授权发信、扩大范围、删除记忆或改变已确认安排。

首版不给模型 shell、任意 SQL、任意 URL 请求、任意文件系统、凭证读取和直接推送工具。使用 Pi core 时，只注册所需领域工具即可。将邮箱/模型/API 等网络出口做明确配置；凭证留在可信 connector 中，模型只能看到最小必要内容。

个人记忆应有 `sourceId`、`confirmed/inferred`、`validFrom/validTo`、版本和可删除关联。任务事实、用户偏好、模型推测、会话摘要不能混在同一段长期 prompt 里。删除需覆盖派生记忆、检索索引与可回灌的摘要；备份的保留窗口应公开说明。无需保存模型内部推理；保存用户可理解的证据、决定和工具结果足够用于审计。

## 5. 成本控制与可替换 adapter

建议事件驱动触发：用户输入、邮箱增量变化、提醒到期；不为每个用户常驻无限循环 agent。已经确定的时间提醒由调度器执行，发送时默认不再问一次模型。

每次 run 限定模型请求数、工具调用数、总时间、输入体积、输出 token 与费用预算；额度检查在每次请求和工具执行前由服务控制。较便宜模型做分类和提取，复杂歧义再升级，具体型号通过固定 Nivli 评估集决定。Pi 的 usage/cost 可用于账本，但 provider 实际账单仍需对账，不能把框架估算当作精确结算。[pi-ai 成本记录](https://github.com/earendil-works/pi/blob/ea448f454af474f3e2fe9733b331e17b0662f5d6/packages/ai/README.md)

预算初始实验值可设为每次最多 3 个模型请求、6 次工具调用、20 秒交互目标，超出转为异步处理或请用户补充信息。这些是待测策略，不是性能承诺。按用户/day 设模型成本上限；达到上限仍继续运行已确认提醒。

应用对 agent 仅暴露如下概念接口：输入是用户/事件引用、允许的工具、已裁剪证据、预算、取消信号；输出是结构化 proposal、引用证据、usage、完成/需要澄清/失败状态。不要向领域层泄漏 Pi message、Cordis context 或 LangGraph state 类型。一个 `PiAdapter` 首先落地；`DshAdapter` 与 `LangGraphAdapter` 在有验证收益时才开发。共享契约测试足以保护替换，不必预先实现三个生产后端。

## 6. 小型 spike：选型验收，而非凭热度拍板

以下是建议执行的验收，本次研究未实际完成这些测试。

- 用同一模型、同一数据集比较 Pi core 与 dsh SDK；明确日期、跨时区、夏令时歧义、后续修改、邮件重复/冲突与提示注入均纳入。记录正确提案率、需要澄清率、token、费用、p50/p95 延迟和接入代码量。
- 50 条用户交代 + 50 条合成邮件作为起始集；先约定正确答案与必须澄清的场景。框架效果应与模型质量分开测，不能只比较各自最擅长的默认模型。
- 在事务提交前后、工具结果写入前后和发送 APNs 前后强制终止 worker；验收业务写不丢失、不重复完成、旧 revision 不发送，并明确保留外部投递 unknown 窗口。
- 重复提交同一输入、重复消费同一 job、执行中取消与撤销来源权限：应无额外承诺、无越权读取；费用超限能停止后续模型请求。
- 用 Docker Compose 从空环境启动、升级迁移、备份再恢复，确认未来提醒仍可由业务表重新物化。恢复后的旧 token、旧位置事件和旧通知必须重新校验。
- 以真实 iPhone 完成离线、后台、通知权限变化、本地/远程通知冲突测试；模拟器和队列成功不能代替设备到达体验。

若 Pi 在这些场景下的应用代码明显失控，而 dsh 或 LangGraph 可以以更少代码获得明确可验证的恢复与审批语义，再调整选择；若两者效果接近，优先保留更少基础设施和更窄权限面的方案。

## 7. 可复核性与未验证事项

本次通过官方网页、README 和 GitHub API 读取仓库状态，记录以下 commit 以便复核；它们是阅读快照，不是推荐安装的发行版本：

- DeepSeek Harness：`d743267388641bc76f17c45ce8b4c231aed1d32c`，提交时间 2026-10-09。
- Pi：`ea448f454af474f3e2fe9733b331e17b0662f5d6`，提交时间 2026-10-10。
- pg-boss：`aa3b4f3ccb68fa610caf62ba04985deb9bc801b1`，提交时间 2026-10-09。
- Deep Agents JS：`b448f220866bbb5d41924dfdbb1e0079c3b11838`，提交时间 2026-10-05。
- Deep Agents Python：`9f0e39d55a5f31003b206b31b955154f2f1bc49a`，提交时间 2026-10-10。

开工时需选择已发布版本、锁定依赖和镜像 digest，验证文档对应的 API 已包含在该发行物中。本文未对任何框架进行完整代码安全审计，也未验证 Nivli 在真实设备、真实邮箱或具体模型上的表现。MIT 信息来自项目官方声明；最终分发仍应保留项目及传递依赖要求的版权/许可文件。
