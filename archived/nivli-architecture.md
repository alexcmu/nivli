# Nivli 产品评审与技术选型

方案 v1 · 2026-10-11 · 基于产品 PRD v0.3

配套：[技术方案 HTML](./nivli-architecture.html) · [UI 交互原型](./nivli-ui-prototype.html) · [UI 设计规格](./nivli-ui-design.md) · [Agent 官方资料核查](./nivli-agent-research.md)

本文给出推荐方案，不代表 backend 已实现或性能已实测。框架事实来自官方文档与仓库；其余为针对 Nivli 的设计判断。依赖的阅读快照在文末，实际安装时应锁定可用发行版本。

## 1. 建议先做这个决定

**SwiftUI 原生客户端 + TypeScript / Node.js 24 LTS 模块化后端 + Pi core adapter + PostgreSQL + pg-boss + Docker Compose。**

同一个后端代码库、同一应用镜像，运行三个常驻应用进程：API、agent worker、delivery worker。后两者可复用 worker 入口、用队列参数区分；时间敏感投递不与模型长调用争抢并发。加上 PostgreSQL，核心是四个常驻容器；HTTPS 代理按部署环境选配。单人内测可以先合并两个 worker，但验收前验证慢任务不会拖延投递。

Nivli 的核心资产是用户确认的事项、授权与来源，不是某个 harness 的会话格式。让模型负责理解与建议，让确定性业务服务负责写入、安排、完成与取消。一次性解析能完成的请求就直接解析，不强迫每条输入都进入复杂 agent loop。

“传统 JS 后端”适合这个产品。LLM、邮箱、数据库和通知是 I/O 密集工作；关键是把长任务从 HTTP 请求生命周期中移出，持久化状态并处理重试。用 Node 不妨碍构建 agent。当前 Node 官方把 v24 列为 LTS；正式构建用已验证的安全补丁版与 digest，不直接用本机恰好安装的版本。[Node 发行状态](https://nodejs.org/en/about/previous-releases)

## 2. 产品设计有没有根本问题？

没有发现足以否定方向的矛盾。PRD 对明确交代、AI 推测、渐进授权和不升级骚扰的区分是正确基础。但它还没有定义下列产品契约，建议在实现前作为附录补入，而不是直接改写原文件。

### 提醒可靠性契约

“已保存”表示业务记录存在；“本机提醒已安排”表示 iOS 已接受排程；“推送已被 APNs 接受”不是用户看到了；“打开通知”不是完成。UI 和服务端状态都要遵循这一分层。不能承诺绝对准点或每次送达。

### 自托管交付契约

代码免费不等于服务器、模型调用、Apple 开发者能力和外部服务免费。Docker Compose 解决 backend 安装，不能自动解决 iOS 签名与推送身份。提供自签名独立模式，官方 App 包的便捷模式必须明确其推送中继依赖。

### 地点提醒契约

首版先做“进入 / 离开指定区域”的系统本地通知。不要为它建立持续位置上传服务。到家、离家事件可能延迟；“出门前”应提供明确的时间替代。复杂情境联想可以在后续阶段基于用户提供的事件建立。

### 邮件建议契约

读过邮件不等于没有处理。模型只能提出“可能需要跟进”，应引用邮件原文并让用户确认；后续同线程邮件更新同一建议或提出变更，不能重复产生多条承诺。

### 记忆与删除契约

区分用户确认的事实、模型推测与派生摘要。遗忘应删除可检索来源和派生索引，阻止从旧摘要重新生成；用户确认的任务是否保留要明确选择。断开来源只是停止读取，不等于删除历史数据。

### 首版验收契约

A：时间提醒与通知操作；B：重要地点提醒；C：一个邮箱来源的建议闭环。A/B 是内测里程碑，A+B+C 才兑现 PRD 的首版范围。暂缓泛化“个人信息中心”、多代理协作、来电和灵动岛，不砍掉原文已承诺的首版目标。

## 3. DeepSeek Harness 与 Pi 怎么选

### 首选 Pi 的基础库

本次官方仓库已从 `badlogic/pi-mono` 重定向到 `earendil-works/pi`。当前文档的包名是 `@earendil-works/pi-ai` 与 `@earendil-works/pi-agent-core`。使用 core 的模型抽象、工具循环、事件与取消，不把整个 coding CLI 包装成 HTTP 服务。[Pi 仓库](https://github.com/earendil-works/pi)、[core 文档快照](https://github.com/earendil-works/pi/blob/ea448f454af474f3e2fe9733b331e17b0662f5d6/packages/agent/README.md)

**收益：** 直接嵌入 TypeScript worker；只注册领域工具；可以给每个 run 独立预算、取消信号、上下文与 owner。应用对框架的依赖可以限制在一个 adapter 内。

**代价：** Pi 没有替你完成权限、可靠通知、业务记忆、同步和多用户隔离。框架不是 sandbox。需要自己建立业务状态机、工具校验和测试集。[Pi 安全边界声明](https://github.com/earendil-works/pi)

Pi 已有 `pi-durable`，不能再说它完全没有恢复能力。但当前文档列出的持久层是 Memory、SQLite、JSONL、Cloudflare Durable Object，强调同一 storage 单进程所有权，未列 Postgres adapter。首版不再引入第二套会话数据库：将短 run 的输入、结果和操作账本存 Postgres，崩溃后幂等重试；不保证逐 token 恢复，接受少量重复模型成本。[pi-durable](https://github.com/earendil-works/pi/blob/ea448f454af474f3e2fe9733b331e17b0662f5d6/packages/durable/README.md)

### DeepSeek Harness 是真实候选，但暂不做主路径

DeepSeek 官方 `deepseek-harness` 基于 Cordis，强调可替换插件，具有 SDK 和 headless 能力，不只是 CLI。目前官方仍标为 developer preview 并提示破坏兼容性变更。[官方介绍](https://www.deepseek.com/harness/en/)、[仓库](https://github.com/deepseek-ai/deepseek-harness)

当前 TypeScript SDK 通过子进程与 stdio JSON-RPC 运行。其文档明确缺少 mid-turn cancel，需关闭 runtime 放弃执行；`run()` 返回 prompt 入队回执到 idle 之间最后的 assistant 回复，并非严格绑定单一 prompt；approval 双向请求尚未实现。这些对多请求 backend 的取消、关联和资源清理带来额外工作。[SDK client 快照](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/sdk/client/README.md)

`sdk-minimal` 默认仍包含高权限 shell；“minimal”不能解释为适合处理不可信邮件的安全最小权限。要接入 Nivli 必须自定义 profile、移除通用执行工具，并在进程外落实隔离。[minimal profile](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/bundle/sdk-minimal/README.md)、[安全说明](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/SAFETY.md)

**何时重选：** 用户插件与通用执行成为产品重点，或 SDK 取消、结果归属和审批契约成熟后，以相同验收集重新比较。目前它的可组合性优势与首版需求匹配度不如 Pi core。

### 其他方案的位置

- **直接模型 SDK + schema**：最简单的提醒提取可以这样做；复杂上下文检索再使用 Pi loop。它不是必须被 agent 框架替代的“旧做法”。
- **LangGraph JS / Deep Agents**：跨天审批、复杂分支恢复或多步研究确有需求时值得评估。LangChain Deep Agents 和 DeepSeek Harness 是不同项目；Deep Agents 有 JS 实现，不必因此改用 Python。[Deep Agents JS](https://github.com/langchain-ai/deepagentsjs)、[LangGraph 持久化](https://docs.langchain.com/oss/javascript/langgraph/persistence)
- **Python + FastAPI**：团队或处理库明显偏向 Python 时合理；本项目没有必须增加第二套语言与 runtime 的收益。
- **Temporal、Redis/BullMQ、Kafka、Kubernetes**：暂不引入。当前持久状态与任务量可先由 Postgres 承担；出现跨服务长流程恢复需求或测得的吞吐瓶颈再迁移。

最终选择依据是可取消、可控权限、接入成本与真实场景测试，不以 GitHub star 或“最新”作为质量证明。

## 4. Backend 具体组合

### API 与领域服务

Fastify + TypeScript strict。用 JSON Schema / TypeBox 风格的 schema 定义请求响应，生成 OpenAPI；输入和输出都验证，Swift 侧按契约生成 DTO 或进行契约测试。Fastify 的 schema 支持验证和序列化；所有 schema 来自受信任代码，不能让用户或模型提交运行时 schema。[Fastify 官方说明](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/)

数据库访问选 Drizzle + `pg`，迁移纳入版本管理。这里选择 Drizzle 是为了显式 SQL 与事务边界，不是性能结论。也可用 Kysely；首版固定一个方案，不同时引入两套 ORM。

模块划分：identity、tasks、reminders、suggestions、memory、sources、sync、agent、notifications。它们通过领域服务交互，不必拆成微服务。

### PostgreSQL 与 pg-boss

数据库选择 PostgreSQL 17 的受维护补丁版作为保守基线，升级至其他受支持主版本需测试迁移；版本基线为 17，交付锁定 patch/digest。[PostgreSQL 维护政策](https://www.postgresql.org/support/versioning/)任务、记忆、来源和队列放同一实例，队列表独立 schema。结构化查询先行；中文检索使用规范化与明确索引，不能假设默认英文全文检索适合中文。语义检索验证有效后增加 pgvector，向量仅为可重建索引。

pg-boss 支持用 transaction adapter 把业务写入与 job 插入放入同一 Postgres 事务。它提供持久队列和重试，但外部通知的副作用不在数据库事务中。[pg-boss](https://github.com/timgit/pg-boss)、[事务 adapter](https://github.com/timgit/pg-boss/blob/aa3b4f3ccb68fa610caf62ba04985deb9bc801b1/docs/api/adapters.md)

**不要把半年后的提醒只存成一条延迟 job。** 当前 pg-boss 默认 created/retry retention 为 14 天。长期计划存在 `reminders` 表，滚动物化未来 24 小时的 occurrence；定期 reconciliation 补漏，窗口和 retention 配套设置。到期 job 每次重新读 reminder revision，已取消或旧版本立即退出。[job retention 文档](https://github.com/timgit/pg-boss/blob/aa3b4f3ccb68fa610caf62ba04985deb9bc801b1/docs/api/jobs.md)

### 主动触发

触发来自用户输入、邮箱增量、明确时间到期、已授权的情境变更。用事件与短 run，不为每人常驻一个无限心跳 agent。用户忽略建议不触发升级。

同一用户的会话修改串行处理；多个用户可并发。时限内未结束的 run 可以让 API 返回 202，客户端按 run ID 查看状态；前台可用 SSE 展示进度，断开后通过 cursor / run endpoint 恢复。Swift 应用后台不保持 WebSocket 承担提醒。

## 5. 数据与状态的最小模型

以下是概念模型，不是已生成的 migration。

- `owners / devices / sessions`：单人实例也使用真实 owner ID；设备公钥或设备凭据、APNs token、吊销状态。模型输入中没有可信 userId。
- `tasks`：标题、来源类型、sourceId、status、deadlineAt、revision、ownerId。status 为 active / completed / cancelled；提醒时间不塞进 deadline。
- `reminders`：taskId、time 或 location 条件、IANA timezone、timeSemantics、nextOccurrenceAt、revision。v1 先支持单次；重复规则需有 DST 策略后再开放。
- `suggestions`：候选动作、引用证据、推测条件、pending / accepted / dismissed / superseded、acceptedTaskId。接受事务有唯一约束，重复点击不产生两条任务。
- `memories`：事实、来源、confirmed / inferred、有效时间、修订号；用户确认与模型推测单独检索。
- `sources / source_items / evidence`：OAuth 引用、同步 cursor、消息和线程 ID、内容 hash、允许保留的片段、授权版本。内容可能已删除时返回失效状态。
- `agent_runs / tool_operations`：输入事件、预算、状态、模型版本、结构化结果、usage、稳定 operation key；不保存模型隐藏推理。
- `notification_occurrences`：reminderId、revision、occurrenceAt、deviceId、deliveryOwner、channel、状态与错误。唯一键包含这些业务身份，避免因重试重复创建。
- `sync_operations / change_log`：幂等键、clientMutationId、服务端顺序 cursor、基准 revision、删除 tombstone。

事项状态与投递状态正交。例如 completed task 的历史 notification 可以是 accepted；不能从“已推送”推导“已完成”。

时间保存 UTC instant + IANA timezone + 用户原始本地表达。固定瞬间与随本地时间变化的意图分开；旅行换时区不静默改约定。夏令时不存在或重复的时间进入澄清或可见规则。用户说“周五前”不擅自推定精确截止小时，建议页允许只保留日期。

## 6. 一条提醒的执行链

1. 手机提交原话与幂等键，API 持久化 input event 并入队，返回 run ID。
2. worker 在预算内检索允许的上下文，Pi adapter 输出结构化 proposal 与 evidence ID。
3. 领域服务验证 owner、授权、指代、时间和来源。明确用户交代可以直接确认；歧义需追问；邮件只写 suggestion。
4. 同一事务写 task、reminder、revision、change log，以及近期物化 job；长远提醒由业务表与扫描器保证重建。
5. 手机同步并根据每个 occurrence 的投递归属安排本地通知，成功后回传具体 request ID + revision。UI 只对成功的排程显示就绪。
6. 用户完成 / 推迟后，业务版本递增，撤销本机待投递通知；延迟 job 检查旧 revision 后退出。通知动作允许离线记入本地 outbox，之后幂等同步。

领域写操作的 stable key 来自输入事件 + 目标 + 操作类型，不能依赖模型每次重新生成的 tool-call ID。

## 7. iOS 通知与自托管：最重要的架构边界

### 7.1 本地与远程各自负责什么

明确的时间提醒优先在设备安装本地通知；简单地点条件优先用 `UNLocationNotificationTrigger`。这是系统负责触发的通知，当前文档说明其只需 when-in-use 位置授权，不要混同于应用自己持续运行 Core Location 后台监控所需权限。[本地排程](https://developer.apple.com/documentation/usernotifications/scheduling-a-notification-locally-from-your-app)、[位置通知触发器](https://developer.apple.com/documentation/usernotifications/unlocationnotificationtrigger)

服务器产生的新建议、没有被分配给本地的远期 occurrence 等走可见 APNs 通知。静默推送只用于尽力同步，Apple 不保证它的后台到达，因此不能用静默推送准点唤醒 app，再临时生成通知。[Apple 后台推送说明](https://developer.apple.com/documentation/usernotifications/pushing-background-updates-to-your-app)

### 7.2 不要靠“两边都发”兜底

一个 occurrence 在某一设备上只能有一个主动投递归属。首版限定一台主要 iPhone，减少跨设备协调；数据模型保留 deviceId，为后续扩展准备。

- 手机交代时可预先认领本机路径：创建 occurrence 时指定 local(device)，安装后上报成功；没有 ack 就显示 pending，不由服务器超时自动改发。
- 已是 server 路径的 occurrence，转本机须先由 API 在事务中停用服务端投递并颁发版本，再由手机安装。安装失败且已确认不存在本地 request 后，可回到 server。网络中断造成归属不明时保持 pending 并在前台修复，不并发投递。
- 本地计划用稳定 request identifier 更新，完成和推迟移除旧 request。APNs collapse ID 不能撤回已展示通知，也不能跨 local/remote 去重。
- 本地容量是有限的。排程前查询 pending request，限制支持范围并留余量；未安装的远期 occurrence 保持 server 归属。无推送模式下超出本地容量的事项明确提示尚未安排，而不是假装日后后台一定会补齐。
- 离线改动已经由服务器投递的 occurrence，不能撤回未知在途推送。客户端完成后落本地 tombstone，恢复连接后同步；旧通知打开只显示最新状态。文档明确残余重复/陈旧窗口。

上述是推荐协议，需要真机与故障注入验证。不能承诺端到端 exactly-once。APNs accepted 也不代表设备展示，更不代表用户看见。[Apple 通知负载与交付说明](https://developer.apple.com/library/archive/documentation/NetworkingInternet/Conceptual/RemoteNotificationsPG/CreatingtheNotificationPayload.html)

投递账本区分 planned / sending / accepted / unknown / failed / expired。初始策略：明确的可重试错误采用指数退避并受 occurrence 过期时间限制；请求可能成功但未拿到结果时进入 unknown，不立即自动重复同一提醒。下次同步校验状态，并保留可诊断记录。这偏向避免重复打扰，代价是 unknown 情况可能漏一次远程提示；必须纳入真机验收，而不能把两者都许诺为零。

### 7.3 两种开源安装模式

**独立自签名模式：** 用户构建 SwiftUI app，使用自己的 Team / Bundle ID 和 APNs 凭据；backend 直接连接 APNs。无需 Nivli 官方中继，但需要 Apple 相关开发能力与配置。提供 Xcode 文档，Docker 只构建 backend，iOS 构建在 macOS CI 进行。

**官方 App + 自托管 backend 模式：** App 使用发行方 Team / Bundle ID，其 token 不能由任意用户自己的 APNs key 推送。发行方运行最小推送中继并保管自己的 key，不把这把 key 分发给每个自托管实例。中继本身也开源。[Apple APNs 身份与 Team/Bundle 映射](https://developer.apple.com/documentation/UserNotifications/establishing-a-token-based-connection-to-apns)

中继设计：设备安装后获得受限 capability，与用户的 backend 配对；backend 只能对已绑定设备、允许的 category 和频率发通知。限制 payload 大小、速率、过期时间，并可撤销绑定。默认只转发不透明 occurrence ID 和通用通知文案；中继仍能看到 device token、时间与流量元数据，不能称为无数据接触。

用户主动选择远程详情预览时，可在后续设计经审查的端到端加密 payload + Notification Service Extension，解密失败或超时时退回通用提示。首版默认通用内容，不依赖 extension 每次联网成功来展示核心提醒。

**建议发布路径：** 开发者 alpha 先支持独立自签名；面向更广泛自托管用户发布官方 App 时，中继必须同时可用。关闭中继仍可保留已安装的本地通知和前台同步，但不再完整兑现服务器主动发现的后台触达，安装页应说明这个降级。

## 8. 邮箱与长期记忆

首个 connector 建议 Gmail 只读 API。它有线程与增量 history，便于来源追溯；自托管先用轮询 history，避免默认引入 Pub/Sub 依赖。轮询间隔作为运营配置，初始可以 5 分钟并加入 jitter / backoff，属于待验证的成本取舍，不承诺即时发现。

Google 把 `gmail.readonly` 归为 restricted scope；公开分发与服务器处理可能有额外验证/评估要求。个人有限使用存在例外，但不能用自托管字样假定所有分发都豁免。Testing 状态下 refresh token 有生命周期限制，部署手册应明确重新授权路径。[Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)、[Google restricted verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)、[应用状态](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview)

同步流程：保存 cursor → 拉增量 → 先按消息 ID/hash 去重 → 将候选工作入队并提交 cursor → 模型提取 → 建议与线程合并。cursor 与待处理消息必须原子提交；history 失效返回 404 后，按用户授权范围重做同步并去重。只看已配置范围，不默认重读全邮箱历史。[Gmail 同步指南](https://developers.google.com/workspace/gmail/api/guides/sync)

首版不解析任意附件，不自动访问邮件链接，不申请发送权限。原始正文默认短期缓存，长期仅保存用户可理解的必要依据；建议默认 7 天原文缓存，可配置。这是拟定保留策略，不是现有功能。原文删除后显示“来源正文已清除”，保留任务所需引用摘要须在保留说明中说明。

记忆召回优先使用用户明确关联的人、事项和地点；有证据支持再补充语义检索。每次检索过滤 owner、授权版本、有效期和删除状态；推测不得作为确定事实进入提醒文案。

## 9. API、离线与安全边界

API 契约建议：

- `POST /v1/pairings/claim`：短时一次性配对，限制尝试次数；设备 token 可吊销，存 iOS Keychain。
- `POST /v1/inputs`、`GET /v1/runs/{id}`、`GET /v1/events?cursor=…`：自然输入与执行状态。提交成功响应不是任务已经生效。
- `GET /v1/changes?cursor=…`：增量同步含 tombstone；cursor 失效时做完整 snapshot。
- `POST /v1/tasks/{id}/actions`：complete / snooze / cancel，带 idempotency key 和 expectedRevision；冲突返回 409 与最新状态。
- `POST /v1/suggestions/{id}/accept`：事务性接受，重复请求返回同一 task。
- `POST /v1/devices/{id}/notification-plans`：认领、排程回执与取消回执，不相信客户端提供任意 owner。
- `GET /v1/memories`、`DELETE /v1/memories/{id}`、`POST /v1/exports`：可控的数据生命周期。

Swift 端用 SQLite 保存本地事项投影、request ID、tombstone 和待同步操作；服务端是已同步业务的权威。离线手动提醒可先安装并生成 client UUID；恢复后幂等合并。自然输入离线时保存草稿或提供手动表单，不伪装模型已理解。完成/取消是显式 terminal 状态，旧 edit 不能默默复活；恢复任务必须是新的显式 action。

工具权限由 handler 强制：owner 从认证上下文取得；时间、版本和来源由领域服务校验；邮件只能产生 suggestion；模型不能直接调用 SQL、shell、任意 URL、APNs 或读取凭据。token 保存在可信 connector，输入内容只携带所需证据。注册的工具先限于查任务、查确认记忆、读授权证据、提议修改、提议记忆。

取消 run 同时阻止新工具开始；晚到结果写入前再次检查 run/授权版本。删除来源时递增授权版本，阻止正在运行的任务把已删除内容重新写回。日志默认记录 ID、耗时、错误类型与使用量，不记录原始邮件、对话、token 或模型内部推理。

这是架构权限设计，不是声称 Pi 或 Docker 自带完整安全隔离。首版没有通用代码执行，因此不需要把用户输入交给“coding agent 的默认工具箱”。

## 10. Docker 与开源工程交付

### 仓库布局提案

```text
apps/
  ios/                    SwiftUI、通知扩展、设备同步
  server/                 api / worker / migrate 入口
packages/
  domain/                 事项、建议、提醒、授权
  agent/                  领域契约 + PiAdapter
  connectors/             Gmail、APNs、中继接口
  db/                     schema、migrations、queue adapter
  contracts/              OpenAPI、JSON Schema
infra/
  Dockerfile
  compose.yaml
  compose.production.yaml
  config.example.yaml
  backup / restore 文档
```

这是落地目录建议；本次只交付设计文件，尚未生成这些应用目录。

### 部署拓扑提案

```text
SwiftUI iPhone
    │ HTTPS / 前台 SSE / 增量同步
    ▼
可选 Caddy / 已有 HTTPS 代理
    │
API ───────────── PostgreSQL
                    ├─ 业务表与 change log
                    └─ pg-boss 队列
                          │
               ┌──────────┴──────────┐
          agent worker         delivery worker
          Pi + Gmail           确定性策略与状态检查
               │                  │
          配置的模型        APNs / 官方可选中继
                                  │
                                iPhone

iPhone 本地通知 ← 已同步、已认领的时间/地点计划
```

**Compose 服务清单：** `db`、一次性 `migrate`、`api`、`worker-agent`、`worker-delivery`；可选 `proxy`。后三者使用同一应用镜像，入口参数不同。DB 健康后执行迁移；迁移成功后启动应用。`depends_on` 的启动顺序不等于就绪，需要 `service_healthy` / `service_completed_successfully` 条件与应用连接重试。[Docker 启动顺序](https://docs.docker.com/compose/how-tos/startup-order)

**构建：** 多阶段 Dockerfile：已锁定 Node 24 LTS builder 安装 frozen lockfile、编译 TypeScript；运行阶段仅放 production 依赖和 dist；非 root 用户、只读根文件系统、受限 tmpfs。CI 用 buildx 产出 linux/amd64 与 linux/arm64，按版本 tag 与 digest 发布，生成 SBOM 并扫描依赖。不得把 node_modules 或秘钥从本机随意复制进镜像。

**配置：** 普通配置包括 public URL、timezone、provider/model、日志级别、轮询间隔；密码、模型 key、OAuth refresh token、APNs p8、应用加密主密钥通过文件 secret 注入。加密主密钥独立备份；数据库里的 token 加密不能抵御同时拿到主机和密钥的攻击。Compose 的 file secrets 是挂载机制，不是自动的云 KMS。[Docker secrets](https://docs.docker.com/compose/how-tos/use-secrets/)

**网络与卷：** PostgreSQL 不发布宿主公网端口，持久数据放 named volume；只有反向代理暴露 443。api/worker 需要到模型、邮箱与 APNs 的出站访问。支持 NAS/家用 Linux 与 VPS，远程 iPhone 必须能通过 TLS 或用户自选私有网络访问自己的 backend。

**升级：** 先备份 → 在恢复副本测试 migration → 拉固定镜像 → 单进程迁移 → 启动应用 → 健康检查与提醒重建。采用 expand/contract 迁移；旧镜像回滚不保证能读任意新 schema，明确兼容窗口。不得把 `docker compose down -v` 当升级或卸载默认步骤。

**备份：** 首版个人部署每日加密数据库备份、保留 7 日并允许配置，离机保存；每次发布做恢复演练。该策略目标 RPO ≤24h，RTO 目标 1h，均需实测。需要更小 RPO 再开启 WAL/PITR。[PostgreSQL PITR](https://www.postgresql.org/docs/current/continuous-archiving.html)

**开源：** 推荐项目采用 [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0)（包含明确的专利授权条款），用户可选择 MIT；最终由维护者决定。保留依赖 license 与 notice。Pi、dsh 和 pg-boss 的官方顶层许可均为 MIT，分发前仍检查传递依赖。发布 contribution、security policy、数据流与删除说明、配对和 APNs 两种模式的安装手册。模型权重和模型服务条款单独处理，代码许可不代表它们也免费开放。

## 11. 可观测性、成本与验收

健康指标：API readiness、worker 心跳、队列最老任务年龄、due lag、重试与死信、APNs rejected / unknown、邮箱 cursor age、模型预算消耗。只有运行元数据默认开启，不采集个人文本作为产品分析。OpenTelemetry 接口与结构化日志即可，复杂监控栈作为可选 profile。

初始预算策略：每次最多 3 次模型请求、6 次工具调用、20 秒交互目标；超限转异步或澄清。按日设置可配置花费上限，超限仍运行已确认提醒。具体模型用固定评估集选择；框架的成本估算与实际 provider 账单对账，不在设计稿里虚构每人月费。

容量起点可用 2 vCPU / 2–4 GB RAM 的外部模型实例作为实验配置，不包含本地推理，不是最低配置或测量结果。记录活跃任务、邮箱量、模型费用与队列 lag 后再给正式配置建议。

验收分三层：

1. **产品闭环**：时间、地点、邮件各一条从创建到处理；用户能说明为什么提醒、如何修改和如何停止信息读取。
2. **可靠性**：事务前后 kill worker、重复消费、网络断开、修改与完成竞态、版本过期、半年后提醒、DST 歧义、备份恢复。数据库业务副作用幂等；外部投递 unknown 窗口必须可观察。
3. **Agent 质量**：相同模型比较 Pi 与 dsh，用 50 条交代 + 50 条合成邮件起步，包含指代、冲突和提示注入。记录正确率、澄清率、p50/p95 延迟、token 与集成代码量。禁用工具不能靠 prompt 才保持安全。

建议的验收目标：测试集中不允许静默创建模糊承诺；重复输入不产生重复任务；取消后旧 revision 不发起新的服务端投递；邮箱内容不能扩大工具权限。API latency、真实到达率与建议接受率先测基线再设门槛，不能把本次架构讨论当成压测结果。

## 12. 最先实现什么

先做一个可以真机验证的纵向切片：SwiftUI 输入 → Fastify → Pi 结构化理解 → Postgres 事务 → iPhone 本地通知 → 完成并同步。顺便验证删除、离线和重复提交。这个切片通过后，再接地点和 Gmail。

与此同时做两项技术验证：APNs 自签名模式走通；Pi core 与 dsh SDK 使用相同模型跑同一批样本。这两项的结果决定正式发行方式与最终依赖版本。官方 App 中继、Gmail OAuth 上线要求是公开发布的前置条件，不要拖到界面全部写完才处理。

## 13. 资料与可复核性

官方链接已置于相关结论附近；完整比较、更多来源和未验证事项见 [Agent 研究附录](./nivli-agent-research.md)。

本次阅读快照：DeepSeek Harness `d743267388641bc76f17c45ce8b4c231aed1d32c`；Pi `ea448f454af474f3e2fe9733b331e17b0662f5d6`；pg-boss `aa3b4f3ccb68fa610caf62ba04985deb9bc801b1`。快照用于追溯文档结论，不直接当作已验证的安装版本。

本次未执行 backend 实现、容器构建、数据库迁移、真实模型 benchmark、Gmail 授权或真机推送。HTML 是离线阅读与交互评审产物；正式落地应以文中的 spike、故障注入与真机验收补齐证据。
