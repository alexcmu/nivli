# Haiji v1 Engineering Specification

Status: ready-for-agent

实施范围调整（2026-10-11）：用户明确要求“我不在乎无障碍，直接推进”。本轮实施与工单关闭不再以无障碍专项审计、VoiceOver、最大无障碍字号、对比度和热区专项验收为前置条件；保留已完成的改进，优先推进功能闭环。本文及子工单中对应的原验收要求由此调整覆盖。普通功能、深浅色、认证、数据安全与投递正确性要求继续执行。

初始模型选择（2026-10-11）：用户指定先使用 Claude Sonnet 5.5；Claude API 的模型 ID 为 `claude-sonnet-5-5`。沿用 Pi adapter 与可配置提供方边界，不将模型凭据写入手机或规格。真实模型契约冒烟仍需管理员提供服务端配置。

实施顺序调整（2026-10-11）：用户要求“先把 email 的 connection 放到最后，先把 AI agent 这步完全走通”。保留已实现的 Gmail 代码，将真实邮箱连接配置及后续邮件工单排到 AI 闭环之后。03 的软件基础和后台通知已验证后，AI 闭环所需的 04/07 可先实施；03 剩余设备验收并行继续，未验证项目仍保持未完成。随后优先完成 08/09 的多轮修改、失败恢复、取消和预算控制，不用调整执行顺序宣称原验收已通过。

依赖验收补充（2026-10-11）：04/07 的软件接口、真实数据库与队列测试合入后，08/09 可继续实现；04 剩余通知交互观察及 07 的真实 Claude 凭据冒烟、原生输入验证并行补齐。此调整仅允许推进不依赖外部配置的实现，不关闭未验证的验收项，也不将受控模型测试称为真实 Claude 验证。

版本：1.0 · 2026-10-11 · 目标：可交付给工程师或实施 agent 的功能规格

依据：UI 设计 v1、架构方案 v1、PRD v0.3，以及随后确定继续使用 Pi 的对话决策。本文包含为消除实现歧义而确定的工程默认值；这些值是待验收的实现要求，不是已有能力或测量结果。

发布状态：已发布到本地 Markdown issue tracker；测试边界已获用户确认。本文为 Haiji v1 工程规格的唯一维护入口，triage 状态见顶部 `Status:`。

## Problem Statement

用户把任务、时间和背景散落在对话、邮件与日常生活中，在需要行动时容易忘记。现有工具通常要求用户手动整理事项、持续查看列表，并自己判断何时处理。用户希望自然交代一次，之后在合适的时间或地点收到可直接处理的提醒，并知道提醒依据。

Haiji 还需要解决信任问题：AI 发现不应自动成为用户承诺；记录成功不等于通知就绪；忽略不等于完成或同意；自托管不等于所有数据不会经过模型服务或 Apple。用户必须能检查和修改记忆、撤回来源、导出和删除数据，并在离线、授权失效和模型不可用时理解当前状态。

当前项目仅有需求、设计、研究资料与 HTML 原型，没有应用源码、既有测试、领域词汇文件或 ADR；当前目录已初始化 Git，尚无远程仓库。因此这是从零实现的规格，不是已有系统的增量改造。原型的规则解析、演示配对和页面状态不能复用为生产逻辑。

## Solution

交付一个可自托管的个人提醒产品：原生 SwiftUI iPhone 客户端提供“此刻”“交代”“我的”三个入口；TypeScript 后端使用 Pi 理解自然交代和授权信息；确定性业务服务保存事项并管理提醒；iOS 本地通知与服务端远程推送按明确归属分别执行。

用户明确交代后，应用展示事项、具体提醒条件、截止时间与实际排程状态；AI 从邮件或记忆关联中发现的内容先成为待确认建议。通知支持低成本处理，事项详情展示来源与当前状态。个人记忆、邮箱读取范围、安静时段和隐私预览均由用户控制。

完整 v1 必须覆盖时间提醒、单次地点提醒、一个 Gmail 来源、确认记忆、通知处理、离线同步、个人数据控制与自托管部署。时间闭环和地点闭环是可独立发布的内测里程碑，不能将仅完成时间提醒称为完整 v1。首个完整交付采用用户自签名 iOS App + 自有 APNs 的模式；官方 App 分发另外要求发行方推送中继就绪。

## User Stories

以下编号同时是需求引用 ID，例如第 1 条记为 US-01。保留技能指定的英文句式；后续实现和验收说明使用中文。

1. As a self-hosting user, I want to deploy my personal Haiji environment with Docker Compose, so that I can control where my information is stored.
2. As a self-hosting user, I want to configure and test my chosen model provider, so that I know where AI processing happens before sharing content.
3. As a self-hosting user, I want to pair my iPhone using a server address and a one-time code, so that I can connect without copying long-lived administrator credentials.
4. As an iPhone user, I want to confirm the server identity and data destinations before pairing, so that I do not unintentionally share data with the wrong environment.
5. As an iPhone user, I want to grant notification, location, and mailbox access when I need each capability, so that I can begin with minimal permissions.
6. As an iPhone user, I want to create my first reminder without connecting an email account or sharing my location, so that I can experience the basic value immediately.
7. As an iPhone user, I want to describe a task in natural language, so that I do not need to fill out a complex form.
8. As an iPhone user, I want to see the interpreted task, date, time, and time zone, so that I can verify what Haiji understood.
9. As an iPhone user, I want Haiji to ask about ambiguous dates or references, so that it does not silently make the wrong commitment.
10. As an iPhone user, I want to modify an existing task through conversation, so that I can update an earlier instruction naturally.
11. As an iPhone user, I want to set a deadline independently from the reminder time, so that postponing a reminder does not change my actual obligation.
12. As an iPhone user, I want to enter a task and time manually when AI processing is unavailable, so that basic reminders remain usable.
13. As an iPhone user, I want to distinguish a saved task from a scheduled notification, so that I know whether a reminder is actually ready.
14. As an iPhone user, I want to know when my requested reminder falls within quiet hours, so that I can explicitly retain or change that time.
15. As a traveling user, I want to see how time zones affect an existing reminder, so that travel does not silently change the agreed time.
16. As an iPhone user, I want to see the next relevant task on the home screen, so that I can quickly understand what needs attention.
17. As an iPhone user, I want pending suggestions to be separate from confirmed tasks, so that I can tell what I have actually agreed to do.
18. As an iPhone user, I want to find all active, completed, and cancelled tasks, so that the home screen can stay focused without hiding my history.
19. As an iPhone user, I want to view the source and reason for a reminder, so that I can understand and correct Haiji's interpretation.
20. As an iPhone user, I want to complete a task from the app or an authenticated notification action, so that processing a reminder takes little effort.
21. As an iPhone user, I want to undo an accidental completion or dismissal, so that a simple mistake does not lose my intent.
22. As an iPhone user, I want to snooze a reminder or choose a different time, so that I can adjust my plan without changing its deadline.
23. As an iPhone user, I want to cancel a task and stop future reminders, so that Haiji respects a changed decision.
24. As an iPhone user, I want an old notification to open the latest task state, so that an outdated notification cannot recreate or overwrite a task.
25. As an iPhone user, I want repeated taps and network retries to produce one logical action, so that I do not receive duplicate tasks or changes.
26. As an iPhone user, I want important places to have names I recognize, so that I can request location reminders naturally.
27. As an iPhone user, I want a one-time reminder when entering or leaving a chosen area, so that I can remember an action in a useful context.
28. As an iPhone user, I want to understand that location triggers may be delayed, so that I can use a time reminder when I need an earlier prompt.
29. As an iPhone user, I want a time-based alternative when location access is denied or unavailable, so that I can still receive useful help.
30. As an iPhone user, I want to know which reminders are affected when a place is changed or removed, so that none silently depend on invalid location data.
31. As an email user, I want to connect one Gmail account with read-only access, so that Haiji can identify possible actions without sending or modifying mail.
32. As an email user, I want to select the mailbox range and initial history window, so that I control which messages are processed.
33. As an email user, I want suggestions to include the sender, date, and supporting excerpt, so that I can judge whether they apply to me.
34. As an email user, I want to edit and accept a suggestion before it becomes a task, so that the resulting reminder reflects my decision.
35. As an email user, I want to dismiss a suggestion without changing my long-term preferences, so that one exception is not treated as a permanent rule.
36. As an email user, I want related messages to update or supersede an existing suggestion, so that a thread does not generate repeated commitments.
37. As an email user, I want changed email deadlines to be proposed explicitly, so that Haiji does not overwrite my confirmed arrangement.
38. As an email user, I want to see when mailbox authorization or synchronization fails, so that I understand why new suggestions may be missing.
39. As an email user, I want to stop mailbox reading independently from deleting derived information, so that I can choose what to keep.
40. As an iPhone user, I want Haiji to connect confirmed memories with a new instruction, so that I do not need to repeat relevant background.
41. As an iPhone user, I want confirmed facts and inferred memories to be distinguishable, so that I can correct an assumption before it influences a commitment.
42. As an iPhone user, I want to edit or forget a memory and its derived retrieval data, so that an outdated fact does not keep resurfacing.
43. As an iPhone user, I want to mark context as not for long-term memory, so that I can share information for the current interaction only.
44. As an iPhone user, I want private task details hidden in lock-screen notifications by default, so that nearby people cannot read my personal content.
45. As an iPhone user, I want to opt into detailed previews for supported notification channels, so that I can balance convenience and privacy knowingly.
46. As an iPhone user, I want to control quiet hours and AI suggestion frequency, so that proactive help respects my attention.
47. As an iPhone user, I want ignored suggestions to remain quiet, so that silence is not treated as permission to escalate.
48. As an offline user, I want already scheduled local reminders to remain available, so that a backend outage does not remove existing plans.
49. As an offline user, I want manual changes to be saved locally and marked as pending synchronization, so that I know what has and has not reached the server.
50. As an offline user, I want conflicting edits to be shown before they overwrite a newer task state, so that reconnecting does not undo a later decision.
51. As an iPhone user, I want clear recovery actions when notifications, location, email, or the model are unavailable, so that I can continue with supported functionality.
52. As an iPhone user, I want a quiet empty state with an obvious way to add a task, so that the app does not manufacture work for me.
53. As a user of accessibility features, I want readable dynamic text, VoiceOver labels, sufficient contrast, and usable controls, so that I can complete the same flows independently.
54. As an iPhone user, I want native navigation and consistent light and dark appearances, so that the app behaves like a familiar iOS application.
55. As a privacy-conscious user, I want to export my tasks, memories, and source references in a documented format, so that I can take my information elsewhere.
56. As a privacy-conscious user, I want deletion to describe its server, device, derived-data, and backup scope, so that I understand what has actually been removed.
57. As a privacy-conscious user, I want credentials and private content excluded from routine logs and telemetry, so that operating the service does not create another copy of my information.
58. As a self-hosting user, I want backups, recovery instructions, and versioned upgrades, so that a restart or upgrade does not silently lose future reminders.
59. As a self-hosting user, I want model budgets and worker health to be visible, so that I can control costs and diagnose failures without reading private message content.
60. As a self-hosting user, I want confirmed reminders to continue when the model budget is exhausted, so that optional AI processing does not disable existing commitments.
61. As a developer using a self-signed iOS app, I want to configure my own APNs identity, so that remote notifications work without an official Haiji relay.
62. As a user of an official Haiji app build, I want to understand and revoke its push-relay binding, so that I can control this additional data path.
63. As a self-hosting user, I want invalid device credentials and push tokens to be revocable, so that an old installation cannot retain access indefinitely.
64. As a user recovering from an outage, I want stale reminders to be reconciled instead of replayed in a burst, so that recovery does not overwhelm me with obsolete notifications.

## Implementation Decisions

### D-01. 范围、优先级与需求解释

1. 本规格中的“必须”是验收要求；“后续”不属于当前交付。新增的默认窗口、预算和重试参数集中配置并验证范围，不在不同模块重复硬编码。
2. 确定使用 Swift/SwiftUI、TypeScript/Node、Pi、PostgreSQL、pg-boss、Docker Compose。此前 Python/PydanticAI 的讨论保留为研究资料，不进入本次实现依赖，也不启动新一轮框架选型。
3. 首版单个人环境、一个 owner、一个主要 iPhone、一个 Gmail 账户。所有实体仍有 ownerId 与设备身份，禁止把单用户等同于无需鉴权。多设备同时提醒与跨设备一致性不在范围内。
4. 最低 iOS 26 作为本轮实施基线；使用 SwiftUI 系统组件适配。降低系统版本需单独修改兼容性范围，不由实现者静默引入自绘兼容层。
5. 英文故事中的“official build”属于官方分发阶段的条件需求。自签名完整 v1 仍必须实现自己的 APNs 路径，不能以没有中继为由遗漏邮件主动触达能力。
6. 规范优先级：本规格中的已收敛决策 → 用户最后确认的 Pi 路线 → UI/架构来源 → HTML 示例。原型中的时间、配对码、模型模拟、账户和屏幕状态是演示数据。

### D-02. 领域术语与不变量

1. **Task / 事项**：用户已经确认的行动，具有 active、completed、cancelled 状态。它不等于聊天消息，也不等于一条通知。
2. **Reminder / 提醒计划**：某事项的单次触发条件，类型为 time 或 location。提醒时刻与事项截止时间独立。v1 每事项最多一个当前有效提醒计划；修改创建新 revision。
3. **Suggestion / 建议**：AI 尚未获得用户确认的候选行动或变更，状态为 pending、accepted、dismissed、superseded。它没有完成按钮；未经用户接受，不能写成正式承诺。
4. **Memory / 记忆**：有来源、有效期和确认状态的事实或偏好。confirmed 与 inferred 分开；聊天历史或模型摘要不自动成为已确认记忆。
5. **Evidence / 依据**：来自用户交代或授权信息的可引用片段及其来源身份。引用可以保留而正文已清除，界面必须能表达这个差异。
6. **Occurrence / 本次提醒实例**：一个提醒 revision 针对某设备的一次触发。它拥有固定身份、有效窗口和唯一主动投递归属；队列 job 只是执行载体。
7. **Delivery owner / 投递归属**：local(deviceId) 或 server。某 occurrence 的服务端发送和本地安装必须受这一归属约束。
8. **Agent run / 理解执行**：对一个输入事件进行的有预算的模型/工具执行，不承担定时器职责；一次 run 可以产出结果、澄清请求或失败。
9. **Revision / 版本**：服务端对实体变更的单调递增版本，用于并发校验与旧 job 失效。客户端不能自行指定一个更大的服务端版本。
10. **已保存**仅表示持久化成功；**本机已安排**表示系统接受了当前有效请求；**推送已受理**仅表示 APNs 接受；**已完成**只能来自显式用户操作。授权关闭时，不能仅凭排程 API 成功显示可提醒。
11. 提醒执行不调用 LLM。AI 建议不改变已确认事项。打开通知不完成事项。未响应不授权追加提醒、改偏好或升级打扰。

### D-03. 模块和进程边界

1. SwiftUI 客户端负责导航、输入、任务投影、权限交互、本地排程、通知动作、Keychain 凭据与离线操作记录。View 通过 repository 使用本地/远程状态，不直接调用模型。
2. 后端采用模块化单体：identity、tasks/reminders、suggestions、memory/evidence、sources、sync、agent、notifications、data lifecycle。模块内部可以拆分，外部只有版本化 API 和明确事件契约。
3. 同一应用镜像提供 API、agent worker、delivery worker、一次性 migration 四种入口；常驻的是前三者和 PostgreSQL，HTTPS 代理可复用已有部署。
4. API 负责认证、schema 校验、读写命令与投递输入事件；agent worker 负责 Pi run、Gmail 拉取和建议生成；delivery worker 负责提醒物化、确定性投递与恢复扫描。
5. 队列分为理解执行、邮箱同步、提醒投递和维护任务。模型任务与通知投递不共享运行并发配额；单用户会话变更有串行化边界。
6. Node 24 LTS、PostgreSQL 17 为主版本基线，依赖使用已验证的发行版本和 lockfile，镜像锁定 digest。实现前核实 Pi 发行物实际包含所依赖 API；研究 commit 不是依赖锁定版本。
7. API 使用 Fastify、TypeScript strict、受信任的 JSON Schema/TypeBox 与 OpenAPI；数据库使用 Drizzle + pg。不同时引入第二套 ORM、Node/Python 双栈或第二个业务数据库。

### D-04. Pi 集成、上下文和执行结果

1. 第一实现采用 pi-ai + pi-agent-core 的进程内 adapter。领域服务只认识 Haiji 的输入、结果和工具契约，不依赖 Pi message、session 或 provider 类型。
2. 不承诺 core 自动提供完整 coding SDK 的会话文件、压缩、插件运行时。v1 会话消息、关联 taskId、检索证据、run 和业务操作账本由 Postgres 保存；不启用默认 shell、文件工具或任意插件。
3. Adapter 输入包含 runId、输入事件身份、服务端生成的 owner 上下文、conversationId、允许的证据引用、timezone、预算及取消信号。输出种类为 task proposal、task change proposal、memory proposal、clarification、普通回复或明确失败；同时返回证据引用和实际 usage。
4. 工具只开放检索相关事项、检索已确认记忆、读取授权依据、提议事项变更、提议记忆、解释提醒。所有写入由领域服务再次校验来源类型、对象归属、revision、授权版本和时间解释后提交。
5. 明确用户交代可以直接保存并回显结果；模糊时间、多个候选指代、普通愿望不能自动提交。邮件或推测上下文只产生 suggestion。已确认事实与模型推测在模型输入中标注来源，不能由 prompt 内容改变权限。
6. 首版上下文策略为：当前指令、近期相关对话、明确关联事项、经权限过滤的确认记忆和必要来源片段。为每类输入设上限；截断时保留实体 ID、时间、当前状态与直接证据。历史不足以确定意图时追问，不把缺失上下文伪装成记忆。
7. 会话修订由 conversation revision 串行提交；后来的输入默认排队，显式取消阻止新的模型请求和工具开始。中途“改成九点半”作为下一输入，针对最近有效结果重新校验，不依赖跨 run 未保存的内存。
8. 初始 run 上限为 3 次模型请求、6 次工具调用；20 秒为前台等待体验目标。超过前台目标继续显示“处理中”并允许离开，不视为成功。另设可配置执行硬超时，默认 60 秒；超限 run 进入 timed_out，不再提交晚到 proposal。
9. 每日模型预算由管理员配置。每次模型请求前检查剩余额度和保守的最大输出预算，限制输出 token；估算与 usage/账单区分。预算耗尽仍允许手动创建和已确认提醒执行。
10. run 状态为 queued、running、needs_clarification、succeeded、failed、cancelled、timed_out。澄清回答创建有关联的新输入/run；失败重试保留原始输入身份与稳定业务操作键，避免再次写任务。
11. worker 崩溃后允许重做尚未确认完成的模型请求，因此可能重复模型费用；已经提交的业务副作用必须幂等。operation key 基于输入事件、目标与操作类型，不采用模型重生成的 tool-call ID。
12. 错误结果必须让用户区分等待、缺信息、服务不可用和预算耗尽；保留原话并给重试/手动设置入口，不用模型生成的“好的”证明写入成功。

### D-05. 持久数据与唯一性

1. Owner、Device、Session 保存个人环境身份、设备能力、吊销状态和凭据验证数据；APNs token 绑定设备、topic 和环境，不能由请求传入任意 owner。
2. Task 保存 owner、UUID、标题、必要背景、status、来源引用、deadline、revision、createdAt、updatedAt。deadline 支持 date-only 或 instant，date-only 不转换成虚构的 23:59。
3. Reminder 保存 taskId、类型、已确认的时间/地点条件、timezone、原始时间表达、timeSemantics、revision 和 active 状态。地点条件包含已确认 placeId、enter/exit 和区域参数。
4. Occurrence 保存 owner、deviceId、reminderId、reminderRevision、逻辑触发键、deliveryOwner、routingVersion、计划安装状态、投递状态、有效窗口和错误。唯一约束覆盖设备、提醒版本和逻辑触发键。地点的一次触发使用稳定实例 ID，不依赖服务器知道实际进入区域的时刻。
5. Suggestion 保存 action kind、候选字段、targetTaskId（如有）、expectedTaskRevision、来源线程/消息集合、证据、revision、状态和 acceptedTaskId。重复接受由建议 ID 唯一关联同一结果。
6. Memory 保存 owner、事实类别和值、confirmed/inferred、来源、有效时间、revision 和遗忘标记；Place 是有明确地理字段的确认记忆，关系由业务约束维护。
7. Source、SourceItem、Evidence 保存授权版本、同步范围、cursor、外部消息/线程 ID、content hash、必要片段、保留到期时间。相同账户下消息 ID 唯一；同消息同内容版本不得重复提取。
8. InputEvent、Conversation、Message、AgentRun、ToolOperation 保存输入和结果关联、状态、预算、usage、稳定操作键。模型隐藏推理不持久化，面向用户的解释只来自证据与确定的业务动作。
9. ChangeLog、ClientMutation、IdempotencyRecord、Tombstone 保存有序同步变更、命令身份与删除信息。业务事务同时写变更记录，不能产生业务已变而客户端永远无法发现的状态。
10. 所有读取、唯一性判断和外键关系包含 owner 约束。禁止从模型给出的主键绕过 owner 或来源有效性检查。

### D-06. 事项、建议、时间和冲突语义

1. Task 的正常转换为 active → completed 或 cancelled。恢复是显式 restore 操作，产生新 revision；旧 edit 或旧通知动作不能恢复 terminal task。
2. complete/cancel 重试应返回已经达到的目标状态，不产生额外变更；对已取消事项执行 complete 返回冲突。restore 时保留历史，但提醒已过去则要求用户重新选择时间，不自动补发。
3. snooze 更新提醒条件与 reminder revision，不修改 deadline。选择晚于截止时间的提醒允许保存，但确认界面必须显示仍保留的截止时间。
4. Undo 是有因果关系的新命令，带被撤销的 mutationId 和 expectedRevision；只在目标仍是该操作结果时恢复。后续已有修改时返回冲突，不能用旧快照覆盖新状态。UI 立即提供撤销入口，历史页提供显式恢复路径。
5. Suggestion 的接受事务必须校验 pending 状态、revision、目标任务版本和来源有效性，再创建任务或更新已确认任务、标记 accepted、写 change log 和必要 job。重复接受返回已有结果；对 dismissed/superseded 建议不能无提示接受。
6. dismiss 只影响这一建议。undo-dismiss 在来源仍可用且未被更新替代时恢复 pending。接受后的撤销只有未发生后续事项修改时可自动执行：新增任务转 cancelled；变更建议恢复被替换的业务字段并产生新 revision。
7. 不同用户输入不因标题相同就自动合并；同一输入重试必须幂等。邮箱重复检测先用外部稳定 ID，再用同线程、动作及目标关联；不确定是否同一事项时展示建议而不静默合并。
8. 单次时间提醒以明确 timezone 解析并存 UTC instant；保留原始本地表达。旅行不自动移动已确认的固定时间。用户请求随当地时间变化时，v1 要求选定时区或明确新时间。
9. DST 不存在/重复时刻、只有“晚点”或无上下文的“周五”等不足以确定具体提醒的表达，需要澄清。只有截止日期的事项可以保存，但具体提醒必须得到用户确认。
10. 安静时段默认 22:00–08:00，作用于 AI 建议。明确时间落在安静时段时，创建/修改结果先进入需确认状态；用户选择继续后按约定排程。该确认不更改 iOS Focus 和系统通知设置。
11. 开启 AI 建议推送后默认每日最多一条摘要，默认当地 09:00；遇安静时段推迟到其后第一个允许时段，无未读有效建议不发。默认设置为仅应用内建议。无响应不重发同一摘要、不提高紧急程度。

### D-07. HTTP 契约与同步

1. 所有业务 API 使用版本化 HTTPS、JSON、认证上下文和一致错误结构。错误包含稳定 code、可读 message、requestId、retryable；冲突附最新实体或可读取的引用。HTTP 401 表示身份无效，403 表示当前身份无权执行，404 不泄露他人对象，409 表示状态/版本冲突，422 表示字段或时间无法接受，429 表示限流。
2. 每个 mutation 必须带 clientMutationId 或 Idempotency-Key；幂等范围为 owner + 设备 + 操作种类 + key。相同 key/body 返回原结果，相同 key/不同 body 返回 409。expectedRevision 用于已有实体操作，不用客户端 wall clock 判断新旧。
3. 初始幂等响应记录保留至少 90 天；创建操作身份与已存在业务实体的唯一关系随实体保留。超过有效窗口的旧客户端操作返回明确过期错误并要求用户核对，不能当成全新命令重放。
4. `GET /v1/environment` 提供配对前必需的环境名称、服务能力、推送模式和模型数据去向说明，不返回密钥、私人事项或内部数据库信息。私有网络和公网均须校验证书；不允许生产客户端跳过 TLS 校验。
5. `POST /v1/pairings/claim` 消费地址确认后的有效一次性配对码，返回设备身份、可撤销会话凭据、能力和初始同步信息。配对码由受保护的部署管理入口生成；公开接口不能创建管理员身份。
6. `POST /v1/inputs` 接受原话、conversationId、客户端时间/时区与关联对象提示，持久化输入和 run 后返回 202 与 inputId/runId。这里只代表已接收；任务生效来自后续 run 结果与业务变更。
7. `GET /v1/runs/{id}` 返回状态、澄清字段、实际结果实体引用与可重试错误；`POST /v1/runs/{id}/cancel` 取消后续执行，不能撤销此前已经成功的用户业务命令。普通对话历史通过分页读取接口返回，旧确认卡关联当前实体版本。
8. `GET /v1/tasks` 支持 active/completed/cancelled 分页；`GET /v1/tasks/{id}` 返回当前事项、提醒、来源摘要、异常和 revision。首页通过同一公开查询契约获取任务与单独的 pending 建议，排序不依赖模型运行。
9. `POST /v1/tasks` 用于用户手动创建；必须带客户端稳定 task UUID、明确时间或可解释的未排程状态。`POST /v1/tasks/{id}/actions` 支持 edit、complete、cancel、snooze、restore、undo，返回更新后的实体与同步 cursor。edit 的变更字段必须受白名单约束。
10. `GET /v1/suggestions`、`POST /v1/suggestions/{id}/accept`、`POST /v1/suggestions/{id}/dismiss` 及显式 undo 接口实现建议流程；accept 必须提供最终提醒条件和所接受的 suggestion revision。
11. `GET /v1/memories`、创建/修改记忆接口、`DELETE /v1/memories/{id}` 和地点接口覆盖确认、纠正与遗忘；默认不把 inferred 数据混入 confirmed 结果。删除响应说明受影响对象和设备清理状态。
12. 来源接口覆盖 Gmail OAuth 开始/回调、当前授权与最近同步状态、范围更新、断开及独立的数据删除。偏好接口覆盖安静时段、时区、建议节奏与隐私模式，均使用 revision。
13. `POST /v1/devices/{id}/notification-plans` 使用明确 operation 区分认领、安装回执、取消回执和路径切换；携带 occurrenceId、routingVersion、requestId 和结果。服务端检查设备归属和当前状态，拒绝旧 routingVersion。
14. `GET /v1/changes?cursor=…` 返回有序变更、删除 tombstone、nextCursor、hasMore。opaque cursor 只用于服务端排序，不向客户端暴露数据库实现。初始变更保留窗口为 90 天，过期 cursor 返回 410 与完整同步指引。
15. 完整 snapshot 返回在一致读边界生成的快照及 high-water cursor；客户端替换服务端投影后继续拉该 cursor 之后的变化，再逐条重放仍有效的本地命令。不能把服务端缺失对象直接当成待上传的新实体。
16. `GET /v1/events` 为前台可选 SSE，事件有稳定 eventId 和 runId/实体引用；断线可恢复，事件丢失时以 run 查询与 changes 为准。持久业务正确性不依赖 SSE 连接存活。
17. `POST /v1/exports` 与读取结果接口提供有权限的异步导出；删除接口返回可查询的 deletion job，明确应用数据、设备清理和备份三个范围。管理健康检查和管理员配置不暴露给未配对设备。
18. OpenAPI 必须覆盖上述能力、枚举、日期语义、冲突及错误案例；Swift DTO 与响应契约在 CI 验证。API 路径代表对外契约，内部代码布局由实现确定。

### D-08. 调度、队列与本次提醒实例

1. Reminder 业务记录是长期计划事实来源。delivery worker 默认每 60 秒扫描一次，并在启动时执行恢复扫描，滚动物化未来 24 小时的服务端时间 occurrence。这个窗口只限制服务端预建 job，不限制本机提前安排：用户创建/修改并认领本地计划时，即使时间在窗口外，也要立即生成稳定 occurrence 并安装；后续扫描复用同一身份与归属。扫描参数可配置，不能用进程内 timer 代替持久计划。
2. 同一事务提交业务变更、change log 和必要的 pg-boss job。通过同一个数据库事务 adapter 实现；禁止先提交任务再以无保护的第二次调用入队。跨模块异步动作采用事务性 outbox 或同事务入队，不混用有丢失窗口的方案。
3. Job 只携带稳定业务引用和 expected revision，不把邮件、任务正文或访问凭据复制进队列。重试、重复领取和扫描重建必须命中 occurrence/operation 唯一约束。
4. 队列 retention 必须覆盖已物化窗口、最大执行重试和维护延迟；长远计划不受队列清理影响。每次依赖升级验证保留语义，不能依赖框架的隐含默认值。
5. 发起服务端推送前在事务中检查 task active、reminder 当前 revision、occurrence server 归属、设备有效、通知偏好和有效窗口，再领取唯一发送资格。完成/取消与发送领取使用同一并发控制边界。
6. 已领取发送资格的请求属于在途操作；数据库变更不能原子撤销外部网络请求。领取前完成/取消必须阻止发送；领取后竞态必须记录并在客户端打开时校验当前状态，不承诺绝无陈旧通知。
7. 远程投递状态为 planned、sending、accepted、unknown、failed、expired、cancelled。accepted 不转化为“已展示”。sending 在 worker 崩溃后没有明确结果时转 unknown；不能把租约过期直接解释为没有发送。
8. 对明确可重试的 provider 拒绝使用有上限的指数退避；初始间隔 5 秒、30 秒、2 分钟，受有效窗口限制。明确无效 token 停用该 token，等待设备重新注册；错误凭据向管理员报可行动的错误，不无限重试。
9. 网络超时或连接中断导致发送结果不明时，unknown 默认不自动重发同一 occurrence。UI/运维可看到状态；状态刷新或重启不能把它重新变成 planned。用户显式选择再次提醒会创建新的提醒版本，而非悄悄重试旧实例。
10. 初始时间提醒的远程补发窗口为原定时刻后 15 分钟。若精确 deadline 在原定提醒时刻之后、补发窗口结束之前，则截短到 deadline；用户已明确选择晚于 deadline 的提醒仍按其选择执行，不能据此生成空窗口。这是可配置的工程默认值，不是交付 SLA。超窗仍未投递则 expired，任务仍为 active，在“此刻”展示未处理状态，恢复服务时不成批补发旧通知。
11. 地点 occurrence 由设备本地系统触发，服务端不虚构已触发/已展示状态。安装成功、用户处理回执和设备查询是分别记录的证据；没有回执不推定用户从未收到。
12. AI 建议摘要使用独立 SummaryDelivery，不伪造 Task 或 Reminder。其唯一身份包含 owner、设备、当地日期和摘要批次，保留所含 suggestion ID/revision；发送前再次检查 pending、通知偏好与安静时段。无响应不重复推送已纳入摘要的同一建议版本，新建议可进入之后的摘要。投递复用同一受理/未知/过期语义；摘要采用独立通知 category，只打开待确认建议列表，不提供“完成”或“30 分钟后”。

### D-09. 本地/远程归属协议与通知内容

1. 首次手动或自然交代在主要 iPhone 完成时，对可安装的本地时间/地点计划预先认领 local(device)。保存成功后设备安装，回传 requestId、当前 reminder revision 与 routingVersion；得到成功回执后才标记本机已安排。
2. 如果系统通知授权关闭、位置条件不可用或容量不足，则明确显示未就绪原因。未安装的时间计划在用户已配置远程能力且路由明确时可保留 server 归属；位置计划必须提供时间替代，不能交给服务器猜位置。
3. 服务端 planned → local 的转换只能在尚未取得发送资格、且没有 accepted/unknown 在途结果时执行。事务中先停用服务端路径并递增 routingVersion，之后设备安装；旧 job 和旧回执失效。
4. Local → server 转换必须先让设备取消并确认当前 request 不再存在，再由服务端接收对应 routingVersion 的取消回执。设备不可达或取消结果不明时，不启用 server 兜底。安装失败且确认没有 request 后也遵循此路径。
5. 安装成功但 ack 丢失时，客户端通过当前 request 查询与相同身份重传 ack 修复。服务端保持 local pending，不能通过超时偷偷换 server。允许用户看见待确认状态并重试连接。
6. 修改本地计划使用稳定 request identity 更新；取消旧 revision、安装新 revision 与记录本地操作之间保持可恢复日志。崩溃后对比本地数据库、服务端投影和系统 pending requests，补齐或取消差异。
7. 设备排程使用已验证的容量预算并留余量；初始化、前台恢复和计划变化时重算。达到容量必须显示哪些计划尚未安装；不能依靠不保证执行的后台刷新承诺以后一定补齐。首个真机验证记录当前支持范围，后续不把未经验证的系统上限写死成产品承诺。
8. 本地时间/区域通知由系统触发；静默推送只做尽力同步。所有需要主动触达的服务端消息走可见推送，不能等到期时才静默唤醒 App 生成通知。
9. 普通提醒默认 active；Time Sensitive 只用于明确符合即时性且用户允许的场景，首版不依赖它通过基本验收。不得申请或模拟 Critical/来电能力绕过用户偏好。
10. 通知点按打开当前事项；只读打开不改变业务状态。操作 category 默认包含“完成”和“30 分钟后”，实际折叠/展开由系统决定。两类操作都要求系统认证，且携带 occurrence 身份和版本。
11. 默认通用标题/正文不能包含任务标题、发件人、邮件片段、地点或敏感参数。需要查明是哪件事时先解锁进入应用，后台不能在没有上下文时误完成任意事项。
12. 本地提醒在用户选择详细预览后可显示事项。远程路径 v1 始终使用通用内容；设置明确写出这个范围，不以一个开关暗示远程也支持。远程加密详情预览与 Notification Service Extension 属后续工作。
13. 隐私设置从详细转保守时，重建本机待发请求并清理应用可移除的已投递通知。已显示在屏幕上、缓存或其他设备上的内容无法保证收回，不能把设置变更描述为追溯删除。
14. 对旧通知执行动作时，若事项已完成/取消则返回当前状态；若 reminder revision 已改变则不应用旧 snooze，提示进入最新详情。APNs collapse ID 仅为传输优化，不是跨本地/远程去重机制。

### D-10. SwiftUI 屏幕与可访问行为

1. 使用系统 TabView 与独立 NavigationStack 保留“此刻”“交代”“我的”导航状态；列表和设置采用原生分组，修改时间与来源解释使用 sheet。玻璃材质限于系统导航和瞬时控件，内容保持可读实色面。
2. “此刻”先显示已到提醒时刻但未处理的事项，再显示最近有效时间计划，地点计划作为条件事项展示；同优先级使用稳定时间与 ID 排序，刷新不能任意跳动。没有确定触发时间的地点计划不显示伪造的“今天到期”。
3. 建议独立分组“待你确认”，只显示用户可判断的来源和行动。正式事项有独立完成按钮；点击标题进入详情。没有事项和建议时显示安静空状态；“全部”可查 active/completed/cancelled 历史。
4. “交代”支持文本、多轮补充、澄清、处理中、失败与重试。发送后清空输入前先保留本地草稿；失败不丢原文。中文输入法组合期间 Enter 不发送；硬件键盘 Enter 发送、Shift+Enter 换行。
5. 确认卡展示 taskId 对应的当前标题、完整日期/时间、timezone、deadline（如有）与排程状态；“已更新”“已完成”“已取消”从业务状态渲染，旧消息不得继续显示过时的成功状态。
6. 详情以动作和状态为主，依次提供提醒条件、deadline、来源和提醒理由；主操作为完成/稍后，取消位于更多操作。所有修改结果更新列表、聊天确认卡和本地计划。
7. 邮件建议展示发件人、日期、简短引文、推测动作和待确认标记。接受先进入可编辑表单；冲突建议明确呈现旧值/新值，用户选择保留或更新，不提供未经解释的默认覆盖。
8. “我的”包含确认记忆/待确认推测、地点、Gmail 状态与范围、安静时段、建议频率、预览、环境状态、导出/删除。正常首页不展示队列、API key、token 或模型步数。
9. 初次连接支持输入 HTTPS 地址与一次性配对码；扫码是等价输入方式且保留主机确认。拒绝摄像头仍可手动配对。环境说明与后续服务器配置变化要可查看，不在手机请求模型密钥。
10. 请求通知权限由用户创建第一条提醒时触发；地点权限随地点提醒需求触发；Gmail 连接由用户主动选择。拒绝后说明替代方式，重新请求只能来自用户操作，不循环弹窗。系统设置状态不能用应用开关伪造。
11. UI 使用系统语义字体和颜色，动作蓝为主要 accent；基准大标题 34 pt、正文 17 pt、两侧约 20 pt，按 Dynamic Type 和设备宽度调整。点击热区至少 44×44 pt，正文对比目标至少 4.5:1，不能只用颜色编码状态。
12. VoiceOver 有可理解的事项、时间、状态与操作标签；列表完成控件和详情入口可分别访问；sheet 出入恢复焦点。最大无障碍字号下操作纵向排列，底栏、键盘和 safe area 不遮挡内容。
13. 深色、Reduce Motion、Reduce Transparency 分别验收。动画只反馈用户操作，不用持续动效制造陪伴感。原型中的模拟锁屏和浏览器按钮不作为 iOS 控件结构要求。
14. 错误采用原位状态加可执行下一步：网络重试、手动设置、去系统设置、重新授权或修改条件。正常可撤销操作不使用阻断式确认；不可恢复删除明确说明范围后确认。

### D-11. 离线同步和设备恢复

1. 本地 SQLite 同时保存服务端投影、本机 request 身份、待同步命令及 UI 状态。用户离线 complete/snooze/manual create 时，先原子写本地业务变化与 outbox，再更新系统通知；崩溃后通过日志恢复差异。
2. 本地未同步记录使用客户端 UUID 与 mutationId；服务端接受后映射到相同逻辑身份，不能另建重复任务。未配对状态不可使用虚构 owner 发起同步。
3. 自然语言在离线或模型不可用时只保存原话/草稿，或让用户用明确表单确认；不能将未解释的原话直接标为已设提醒。
4. 恢复网络时先读取最新服务端状态，再按每实体因果顺序发送 outbox。相同设备的连续操作保留前驱关系，在前驱成功后更新其后续 expectedRevision；不把自有前驱变更当作冲突。
5. 任一操作遇到真正的版本冲突，暂停该实体后续操作并保留用户输入，展示差异；其他实体同步继续。不得全局 last-write-wins，也不得用设备时间覆盖服务器版本。
6. completed/cancelled 阻止旧 edit/snooze 生效，完成回执不依赖先看到通知。离线修改 server-owned 提醒可能仍出现旧远程通知；界面应显示当前任务状态和待同步，而不声称服务端已取消。
7. 全量恢复、重装或替换主要设备后，应重新确认通知权限和推送身份，再安排当前计划。原设备未确认清理的 local 计划不能据此宣称已被撤回；更换设备流程列出这种限制。
8. 离线删除先在当前设备隐藏/清理相应内容并停止本机相关计划，显示待同步。只有服务端执行完成后才表示服务器已删除；远程服务和离线设备的清理状态分别报告。
9. 离线创建和修改本地计划可立即在本机安装，使用持久 clientMutationId/requestId 关联，界面标注待同步。同步接受命令时必须同时提交本机投递意图，由同一业务事务建立 local pending 归属，随后绑定服务器 reminder revision 并确认安装回执；不能先默认建立 server 路径再补报本机安装。存在真实版本冲突时取消或替换冲突本机请求，再由用户决定新计划。

### D-12. Gmail、上下文关联与个人记忆

1. 首个来源为一个 Gmail 只读账户。OAuth scope 为读取所需的最少范围；产品内 label/时间过滤不是 OAuth 本身更细的授权，连接说明必须区分二者。令牌只保存在可信服务端 connector。
2. 连接时展示将访问哪些范围、会发送给哪家模型和保留多久。初始同步默认最近 7 天，用户可选择更小窗口或仅新邮件；label 范围由用户确认。扩大范围需要明确确认。
3. 使用 history 增量轮询，默认 5 分钟并加入 jitter/backoff。首次授权、前台手动刷新可发起受限同步；不承诺实时发现。lastSuccessfulSync 与 syncError 分开显示。
4. SourceItem 去重、提取任务入队和 cursor 推进在一个事务内完成。history 不可用时仅在已授权范围内重建；凭据失效暂停该来源，不清除已确认任务。
5. 提取只消费必要正文片段和允许字段，不抓取邮件链接、不解析任意附件、不执行正文中的指令。营销邮件、转发引文、重复提醒和“已读”都不能直接转成用户承诺。
6. 同线程同动作的未确认建议可更新并提升 revision；已确认事项遇新邮件则新建关联变更建议。不同动作可以产生不同建议；存在歧义时保留证据请求确认，不仅凭线程 ID 丢弃合法事项。
7. 正文缓存默认 7 天，可配置更短。长期保留的必要依据摘要与已确认任务分别说明；原文清理后来源页明确标注，不把保留的摘要显示成仍可取得的完整邮件。
8. 记忆创建来自用户明确表达或用户确认的 proposal。推测只进入待确认区；一次忽略、推迟或例外不能自动变成长期偏好。系统可用确认的归还书籍信息关联新的见面安排，但最终只提出建议。
9. “这次不要记住”禁止新增长期 memory 和相关派生摘要；原话是否仍保存在对话历史中必须清楚说明。用户可另外删除对话，不能把“不记住”误呈现为所有存储立即消失。
10. 读取和写回均检查 owner、source authorization revision、遗忘与有效时间；撤回或删除后，已在运行的 job 不能把旧结果回灌。去重/遗忘可保留不含正文的最小抑制标记，避免重同步同一外部消息再次生成已删除记忆。
11. 首版采用结构化关联和受控文本检索；中文查询必须包含验收样本。pgvector 不属于首版必备依赖；若后续增加，向量索引必须可重建、可删除并受同一授权过滤。
12. 删除/修改地点时列出受影响提醒；取消旧本机条件并标记需重新配置。首版只保存用户指定的区域信息，不采集轨迹，不以连续坐标上传维持主动能力。

### D-13. 配对、凭据、导出和删除

1. 个人环境需要独立管理员凭据来配置模型和创建配对码；管理员密钥与设备会话分离。配对码短时有效、单次使用，服务端原子消费并限制尝试次数，失败不返回账户存在性线索。
2. 配对码、设备 token、OAuth token 和模型 key 不写入 URL query、日志、截图或错误响应。扫码携带的配对信息按一次性凭据处理；用户确认地址前不发送凭据。
3. Device session 存 Keychain，服务端保存可验证且可撤销的凭据记录；访问凭据与续期/吊销策略必须纳入 API 契约测试。设备吊销后拒绝同步、导出和提醒动作，并失效对应推送绑定。
4. 模型与 OAuth 秘密使用文件 secret 注入或加密持久化，加密主密钥独立于数据库备份保存。应用日志不记录原始对话、邮件、凭据和模型内部推理；诊断需用户显式授权且限定期限/范围。
5. 导出格式为带 schemaVersion 的 JSON 及必要附件清单，包含用户事项、提醒、记忆、偏好、来源引用和授权保留的依据；不包含私钥、token、密钥、模型隐藏推理或第三方账户登录信息。
6. 导出运行在用户授权的范围内，下载链接短时有效且要求认证；过期自动删除生成物。导出过程中发生删除时，不允许之后返回已经删除的数据：结果发布和下载时检查 data revision/deletion epoch，失效则重做或终止。
7. “停止读取来源”和“删除来源衍生数据”是独立动作。前者撤销 connector 能力并取消新同步；后者列明是否保留用户确认的任务。保留任务时可保留用户选择的行动内容，但清除选定范围内的邮箱原文、摘要、索引和生成关联。
8. 删除流程先禁止新的读取和写回，再异步清理当前库、检索数据、会话派生摘要、队列关联和临时导出。响应提供 scope、状态、失败和重试信息，不能仅隐藏 UI。
9. 数据遗忘完成前必须使检索不可访问，晚到模型结果因版本不符被拒绝；对话历史仍含相同内容时，遗忘抑制规则阻止自动重新提取，除非用户重新明确授权记忆。
10. 已有离线设备本地副本不能由服务端保证立即抹除；状态分为服务器完成、当前设备完成、其他设备清理待确认。整环境删除要求清理当前设备通知并吊销会话，不声称可以撤回所有既有系统展示。
11. 默认备份保留 7 日，不进行逐条原地改写；UI 说明删除数据在备份中的最长残留窗口。恢复流程在重新开放服务前应用独立保存的最小删除清单/删除 epoch，避免较旧备份复活已删除数据；该清单只保留必要对象身份，不保存被删正文。

### D-14. APNs 分发与开源部署

1. 自签名模式必须能配置自己的 Team、Bundle ID、APNs key、环境和 device token。后端直接连接 APNs；配置验证区分开发/生产身份，失败反馈给管理员。首次真机验证必须同时检查一条本地通知和一条可见远程通知。
2. 官方 App 的发行方 key 不分发给用户 backend。官方分发前必须具备独立中继、受限设备 capability、绑定/吊销、频率/大小限制与最小审计信息；用户只可给已配对设备发允许类型的通知。
3. 中继仅转发通用文案和不透明 occurrence 标识；不接收明文任务标题、邮件或位置。仍披露中继可见设备 token、时间和流量元数据。关闭中继清楚显示服务器主动触达不可用，本机已有计划继续保留。
4. 核心 Compose 服务包括数据库、一次性迁移、API、agent worker、delivery worker，代理可选。数据库就绪后迁移，迁移成功后应用启动；运行时仍实现连接重试，不能只依赖启动顺序。
5. 应用镜像多阶段构建，只携带生产运行所需产物，使用非 root、受限临时写入目录和只读根文件系统。数据库数据卷持久化且不发布公网端口；服务入口只经 TLS 或用户明确配置的私有网络。
6. CI 构建 linux/amd64 与 linux/arm64 的同版本镜像，锁定依赖与 digest，产出 SBOM、许可证信息和扫描结果。iOS 构建/签名在 macOS 工具链执行，不宣传 Docker 可以构建签名的 iPhone App。
7. 提供示例配置、安装配对、模型测试、Gmail 授权、APNs 两种模式、健康检查、升级、备份、恢复和卸载文档。示例不得含真实 secret；失败退出必须保留可理解的诊断。
8. 升级采用备份、恢复副本迁移验证、单次迁移、应用启动与提醒重建流程；迁移版本互斥，失败不启动与 schema 不兼容的 worker。不把删除数据卷作为升级步骤。
9. 每日加密离机备份默认保留 7 日；目标 RPO 不超过 24 小时、RTO 1 小时，必须用指定测试环境恢复验证后才可宣称达到。加密主密钥、最小删除清单和 DB 备份有一致恢复说明。
10. API readiness、worker 心跳、队列最老任务年龄、due lag、重试/死信、APNs unknown/拒绝、邮箱同步年龄、模型预算作为运营指标。必须能区分“进程活着”和“提醒无法执行”。
11. 代码保持完整可自托管；正式开源前由维护者确认根许可证，当前保留 Apache-2.0 建议而不将其当作已授权的法律选择。依赖与模型服务的许可/计费范围单独记录。

### D-15. 实施阶段、依赖与退出条件

1. **M0：可运行基础与真实边界验证。** 建立 SwiftUI 工程、后端模块与 schema、Compose、迁移、公开 API 测试入口和可替代外部服务。选定 Pi 已发布版本，验证自定义工具、取消、预算和 schema；真机验证本地/APNs 能力。退出条件：空环境可启动、配对与认证成功、CI 跑通一条公开 API 流程，真机证据已记录。这里不重复比较所有框架。
2. **M1：时间提醒完整闭环。** 先实现手动创建、读取、完成、推迟、同步和本地排程，再接 Pi 自然输入、澄清、确认卡与修改；同时交付偏好、隐私、基础确认记忆和来源解释。退出条件：用户交代 → 已保存 → 本机就绪 → 通知处理 → 当前状态同步全部通过，重复提交、取消、重启和离线恢复用例通过。对应 US-05–25、US-40–47、US-48–54 的时间场景。
3. **M2：地点提醒。** 在 M1 状态、权限和归属协议上增加 Place、单次 enter/exit、本地系统 trigger、异常与时间替代。退出条件：真机完成一条实际区域提醒，拒绝/撤销权限和地点修改均有正确降级，不上传轨迹。对应 US-26–30。
4. **M3：Gmail 与主动建议。** 在输入/证据/建议模型上增加授权、范围选择、增量同步、去重、冲突变更、记忆关联、摘要节奏和断开清理。退出条件：一封合成邮件到建议、确认、提醒、完成全流程；重同步不重复，提示注入不能改业务权限。对应 US-31–43、US-46–47。
5. **M4：完整自签名 v1 发布。** M1–M3 完成后验证数据导出/删除、备份恢复、依赖锁定、多架构镜像、安装文档和真实设备异常矩阵。退出条件：所有必需验收与用户任务测试通过，已知投递限制有可见说明。对应 US-01–04、US-55–61、US-63–64。
6. **M5：官方 App 分发门槛。** 只在发布发行方签名 App 时执行：中继部署与限权、绑定吊销、Gmail 公开分发要求、隐私与数据流说明和官方包真机验证全部通过。US-62 在此阶段验收；未通过时不能以官方 App 模式宣布完整远程通知能力。
7. 每阶段交付包含可运行增量、API 契约、迁移、可观察失败状态、自动化结果和需要真机的证据。没有负责人和实际速度基线，不在本规格中虚构人天或发布日期。

## Testing Decisions

### T-01. 已确认的主要测试边界

用户已确认：**以公开 API 驱动完整业务流程，使用真实 PostgreSQL/pg-boss，替代外部模型、邮箱和推送服务；补充少量 SwiftUI 真机测试验证通知、权限与离线行为。**

主测试入口为客户端使用的公开 API；测试同时运行真正的 API、worker、领域服务、数据库和队列。只在进程外部依赖边界提供可控制的 provider/connector 替代物、时钟与故障开关。数据库、事务、队列领取和 revision 检查不 mock。

iOS 到系统 UserNotifications/Core Location 的边界不能由服务器测试覆盖，因此单独保留少量原生 UI/设备验收。这是平台边界补充，不为每个内部模块再建立独立 mock 层。

### T-02. 什么是好测试

1. 给定用户输入、授权和初始数据，从公开入口执行操作，断言 API 可见结果、同步投影、可观察的外部调用以及没有越权副作用；不断言私有函数调用顺序、ORM 语句或具体类结构。
2. 用可控制 provider 返回合法、歧义、非法、慢响应、取消后晚到和恶意工具请求，验证 Haiji 行为。正常 CI 不依赖随机真实模型输出，不把完整 prompt 快照当功能保证。
3. 用真实数据库和队列验证 rollback、唯一性、并发与重启。通过外部服务替代物记录实际发起的推送/模型/邮件调用，不能把 job 标记成功当作用户收到通知。
4. 用受控时钟推进 due、quiet hours、DST、缓存过期和长远提醒窗口，避免测试实际睡眠数分钟或数天。时钟为运行环境边界，业务内部不随处注入多个独立时间源。
5. 取消/完成与已在途推送竞态的期望分开：领取发送资格前必须不发；领取后可能产生已在途通知，但不得创建新计划或错误恢复任务。不能编写一个现实中无法兑现的“外部恰好一次”测试。
6. 测试结果要能证明关键不变量，只有失败、新功能或修复影响边界时增加必要用例，不为简单 UI 样式建立实现镜像测试。

### T-03. 主要验收场景

1. **AC-01 配对与权限（US-01–06、63）：** 空环境安装后配对成功；过期/已使用配对码被拒；并发消费只有一次成功；吊销设备后读取和写入均失败，日志无凭据。
2. **AC-02 明确时间交代（US-07–08、11、13）：** 固定时区/时钟输入“明天九点提醒提交材料，周五截止”，得到正确 reminder 和独立 deadline；保存、安装 pending 与 local scheduled 状态能分别观察。
3. **AC-03 歧义澄清（US-09–10、15）：** 模糊时间、多对象指代和 DST 缺失/重复时间不生成确定计划；回答后只生成一次正确变更，保留原输入关联。
4. **AC-04 手动降级（US-12、51、60）：** provider 失败/超时/额度耗尽时保留原话，手动创建可成功；已确认提醒无需模型请求即可触发。
5. **AC-05 幂等与事务（US-25）：** 重复同命令、并发接受同建议、业务提交前后 kill worker，均不产生重复业务实体；rollback 后不会出现可执行孤立 job。队列重建仍能找到未来计划。
6. **AC-06 修改、推迟和撤销（US-10–11、20–23）：** 修改使旧 revision 失效；snooze 保留 deadline；撤销仅恢复对应操作，后续已有变更时正确冲突；terminal task 不被旧 edit 复活。
7. **AC-07 投递归属（US-13、24–25、48）：** local ack 丢失、安装失败、server→local 竞争发送领取和 local→server 取消不明均不启用两个主动路径；恢复后可重传/重查修复 pending。窗口外的本机提醒立即可安装，之后服务端扫描不新增第二条投递路径。
8. **AC-08 服务端投递结果（US-24、59、64）：** 确认临时错误重试有界、无效 token 停用、APNs 接受状态准确、超时进入 unknown 且不自动重复；超过有效窗口的旧提醒不批量补发。
9. **AC-09 旧通知（US-20、24）：** 打开旧通知显示新时间/完成/取消状态；点开不完成；旧 snooze 不改最新提醒，通知动作重复提交不重复变更。
10. **AC-10 离线队列（US-48–50）：** 离线手动创建/完成/推迟、应用重启后恢复 outbox，在线合并不重复；离线已安装计划同步时原子建立 local 归属，不经过可发送的 server 状态。自己连续两次操作正确顺序提交，真实远程冲突保留双方信息。
11. **AC-11 同步缺口（US-49–50、58）：** 游标过期触发一致 snapshot，再继续 changes；离线未同步操作不被丢弃，删除对象不因旧投影复活，超过操作窗口的命令要求用户核对。
12. **AC-12 地点（US-26–30）：** 已确认地点的 enter/exit 单次计划正确安装；拒绝位置提供时间替代；修改/删除地点使受影响计划失效且 UI 可解释。真实区域触发结果单独记录，不用模拟触发宣称延迟指标。
13. **AC-13 Gmail 增量（US-31–32、36、38）：** 重复消息、分页中断、cursor 失效、授权过期和重复同步不漏已提交工作、不重复生成同候选；范围外正文不进入 provider。
14. **AC-14 建议与冲突（US-17、33–37）：** 邮件生成 pending 建议且没有正式任务；接受产生一个结果；后续邮件只提出变更；旧 suggestion revision 接受失败；忽略不改变长期偏好。
15. **AC-15 记忆关联（US-40–43）：** 先记录确认的借书信息，再输入见面计划，允许生成有来源的归还建议；inferred 数据不被呈现为已确认事实；“这次不要记住”不创建 memory/长期摘要。
16. **AC-16 授权撤回与注入（US-31、39、42、57）：** 恶意邮件要求执行 shell/读取密钥/完成任务时，无对应能力或副作用；执行中撤销来源后，晚到工具/模型结果不能写回被删内容。
17. **AC-17 隐私与节奏（US-14、44–47）：** 通用通知 payload 不含私人字段；详细→保守重建本机待发内容；安静时段与摘要去重生效；忽略不会自动重发或升级。摘要打开建议列表，不能执行任务通知动作；已经接受/撤销的建议不出现在待发送摘要中。
18. **AC-18 导出与遗忘（US-55–57）：** 导出 schema 完整且不含凭据；删除阻止访问与回灌，包含派生数据；删除时已生成的导出失效；设备清理未完成和备份残留有准确状态。
19. **AC-19 备份恢复（US-58、64）：** 从备份恢复到空环境，应用删除清单后启动，未来计划可重新物化、被删除信息不重新出现，过期推送不成批发送；记录实际 RPO/RTO。
20. **AC-20 资源隔离（US-59–60）：** agent worker 堵塞/预算耗尽不阻止 delivery worker 消费已确认提醒；相关健康状态变差可被检测，正常消息正文不进入监控。
21. **AC-21 SwiftUI 可用性（US-16–19、21、51–54）：** 三入口导航、空态、失败恢复、确认卡更新、来源查看、深浅色、最大无障碍字号、VoiceOver 焦点和 44 pt 操作热区在支持设备验证。
22. **AC-22 发布路径（US-61–62）：** 自签名身份真机远程推送通过；官方包发布前验证中继绑定/吊销/限额、通用内容及隐私说明。自签名结果不能替代官方包身份验证。

### T-04. 自动化、模型评估和真机证据

1. 后端采用 Vitest 驱动 HTTP 集成测试，测试环境启动真实 PostgreSQL 与 worker。数据库可由临时容器提供；每用例隔离命名空间或数据，不依赖执行顺序。
2. 需要覆盖的业务模块是事项/提醒、建议、记忆/来源、同步、权限、agent 结果提交、通知与数据生命周期；通过 AC 场景跨模块覆盖，避免每层重复同一个断言。
3. Pi adapter 另保留最小官方模型契约冒烟：工具 schema、usage、取消和结构化结果确实兼容所锁版本。真实模型调用在显式配置的评估任务运行，不在默认 PR 检查中无上限消费。
4. 模型质量集以 50 条自然交代和 50 条合成邮件起步，标注正确结果、必须澄清和禁止动作，包含中英文、日期歧义、上下文关联、重复/冲突与提示注入。记录模型/框架版本、预算、正确提案率、澄清率、token、费用和 p50/p95。
5. 评估门槛首先是禁止静默创建标注为必须澄清的承诺、禁止越权业务副作用，以及幂等不变量全部通过。整体质量和延迟目标在首轮基线报告中确定，再冻结发布门槛；文档不伪造未经测量的准确率。
6. Swift 使用 XCTest/XCUITest 覆盖主要用户动作与无障碍检查，设备测试覆盖锁屏、后台、离线、通知关闭、位置拒绝、Focus、设备重启与旧通知打开。模拟器可做回归，无法替代真实 APNs 和地理环境结果。
7. 5–8 位目标用户完成时间、地点、邮件三个闭环，记录理解错误、误操作、是否能找到来源及是否知道当前就绪状态；原型阶段通过不等于原生产品通过。
8. 项目暂无现成测试范例。已有 HTML 原型检查仅验证浏览器内点击、脚本与布局，是交互参考，不是后端正确性、iOS 权限、真实通知或 Compose 的先例。实施从公开 API 测试夹具建立第一份可复用范例。

## Out of Scope

1. 多人协作、企业权限层级、付费套餐与多租户托管；首版只服务一个 owner 的个人环境。
2. 多台主要设备同时接收提醒、复杂跨设备投递去重；支持数据中的设备身份与旧设备吊销，不承诺无条件撤回离线设备计划。
3. 周期/重复提醒、任意复杂条件组合、连续位置轨迹、保证“跨出家门之前”触发；首版为单次明确时间或区域条件。
4. 自主发送邮件、付款、下单、对外承诺、调用任意 URL、执行通用 shell/代码、安装不受信任用户插件或自主扩大权限。
5. 全部邮箱供应商、日历聚合、任意附件解析、完整个人知识库、默认语义向量数据库和无限历史邮箱扫描。
6. 默认持续运行或主动分派多个 agent、复杂跨天工作流引擎、逐 token 崩溃恢复；首版为受限短 run 与数据库幂等恢复。
7. 用 Python/PydanticAI、DeepSeek Harness 或其他框架重写当前技术路线；这些属于未来有证据时的单独变更。
8. 来电、Critical Alert、灵动岛、Apple Watch、语音、富媒体通知、官方中继的远程加密详情预览。
9. 强制 Redis、Kafka、Temporal、Kubernetes 或托管商业平台；核心自托管不依赖这些组件。
10. 把“APNs accepted”“本机排程成功”或“用户打开”当成“用户看见/已完成”的推断，以及端到端 exactly-once/绝对准点承诺。
11. 本次规格编写不包含实际应用实现、真实 Gmail 授权、发布镜像、推送中继上线或 App Store 提交；它定义后续实施应完成的工作。

## Further Notes

### 来源与决策记录

- 主要 UI 来源：[Haiji UI 设计方案](../../archived/haiji-ui-design.md)。
- 主要架构来源：[Haiji 技术选型 HTML](../../archived/haiji-architecture.html)；可搜索正文为[架构 Markdown](../../archived/haiji-architecture.md)。
- 产品边界：[PRD v0.3](../../archived/proactive-ai-project-prd.md)。
- Agent 官方研究：[核查附录](../../archived/haiji-agent-research.md)。其他语言研究不覆盖用户后来接受的 Pi 路线。
- 本轮用户已明确接受公开 API + 真实数据库/队列 + 外部服务替代物为主要测试边界，并补充少量 iOS 真机测试。

### 从方案到工程规格时补齐的决定

1. 采用 Pi core 的边界已固定：应用拥有业务会话与状态，完整 coding SDK 的便利能力不被默认为自动可用。
2. 来源中的隐私开关与远程通知方案已消除歧义：v1 详细预览仅适用于本地内容，远程默认通用；设置必须说明支持范围。
3. 归属切换加入 sending/unknown 的禁转条件，取消后的在途请求作为真实限制纳入测试，不再写成无法兑现的绝对取消承诺。
4. 单次提醒、单主设备、一个 Gmail 来源作为实施边界；完整 v1 仍覆盖时间、地点、邮箱与记忆，并未把内测切片替代完整产品。
5. 60 秒扫描、24 小时物化窗口、15 分钟过期补发窗口、90 天同步/幂等记录、60 秒 run 硬超时等是本规格确定的初始工程默认值。实现需可配置、测试边界并记录实际运行表现。
6. API 命令与错误、离线命令顺序、删除期间导出失效、备份恢复防止遗忘数据复活均是实现必须补齐的契约，不能仅靠原型 UI 推断。
7. 正式依赖版本、具体模型、实测容量、质量/延迟门槛，以及根开源许可证在对应里程碑收敛；不阻止先实现明确的接口与用例。根许可证须由维护者决定，开发者不得凭本文擅自声明既有代码授权。

### Issue 发布状态

本规格已发布到本地 Markdown issue tracker，标题：**Haiji v1 — 原生 iOS 主动提醒、Pi 后端与自托管完整闭环**。当前 triage 状态为 `ready-for-agent`。

维护入口为 `.scratch/haiji-v1/spec.md`；原根目录规格已迁移至此，后续更新直接修改本文。实施任务按需拆分到同目录的 `issues/<NN>-<slug>.md`，本次尚未创建实施任务。

项目约定见 [issue tracker](../../docs/agents/issue-tracker.md)、[triage 标签](../../docs/agents/triage-labels.md)与[领域文档规则](../../docs/agents/domain.md)。本地发布不创建 GitHub、GitLab 或其他外部平台 issue。
