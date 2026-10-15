# Haiji：其他语言的 Agent 框架补充

核查日期：2026-10-11。基于官方文档；下述选型是架构判断，尚无 Haiji 实测。本文补充原研究，不改动原推荐文件。

## 我的选择

**如果从零开始、没有语言偏好，我会优先验证 Python + FastAPI + PydanticAI，而不是先选 Pi。** Haiji 的主要工作是把交代和邮件变成有类型、可校验的事项或建议，并通过受限工具访问个人数据；PydanticAI 的默认抽象更贴近这种业务服务。优势是减少应用胶水代码，并不意味着模型更聪明或提醒更可靠。

如果已有 TypeScript 代码或团队更熟悉 Node，则保留 Pi core；需要复杂恢复时再比较 LangGraph JS。仅为框架换语言，通常抵不过迁移与双栈维护成本。SwiftUI 客户端也不要求服务端使用某种语言。

## Python：PydanticAI 最值得先试

**事实：** `output_type` 支持 Pydantic 模型等结构，并校验返回数据；依赖注入把数据库、授权上下文等服务交给工具和校验器。它适合表达“生成 ReminderProposal，校验后由业务服务提交”。但类型正确不代表日期、事实或授权正确，仍需领域校验。[结构化输出](https://pydantic.dev/docs/ai/core-concepts/output/)、[依赖注入](https://pydantic.dev/docs/ai/core-concepts/dependencies/)

Deferred tools 可等待用户批准或外部执行结果；跨进程场景由应用保存请求及历史，再用结果开启后续 run。它既不是自动持久化，也不替代身份与权限校验。跨崩溃继续单次运行需接入 Temporal、DBOS、Prefect 等 durable backend；普通会话保存又是另一层。[Deferred tools](https://pydantic.dev/docs/ai/tools-toolsets/deferred-tools/)、[耐久执行](https://pydantic.dev/docs/ai/capabilities/durable_execution/overview/)

**建议：** 首版用短任务、数据库记录与安全重试；确认建议通常只需状态转换，不必每条建议都维持一个暂停的 agent。只有出现昂贵长任务或复杂跨天流程，再增加 durable engine。

## Python：LangGraph 适合流程复杂后

**事实：** LangGraph 使用 checkpoint 保存图状态，以 `interrupt` 等待外部输入。恢复会重新执行中断所在节点，之前的副作用必须考虑幂等。JavaScript 也提供这套能力，不能把 checkpoint/审批说成 Python 专属。[Python interrupt](https://docs.langchain.com/oss/python/langgraph/interrupts)、[JS interrupt](https://docs.langchain.com/oss/javascript/langgraph/interrupts)

**建议：** 需要显式分支、多个等待点、人工接管和恢复时优先考虑；简单提取与建议生成，PydanticAI 更直接。无需为未来可能发生的复杂性预先画很大的 graph。

## Go 与 Google ADK

**事实：** CloudWeGo Eino 提供类型化组件、Chain/Graph/Workflow、ChatModelAgent，以及 checkpoint、interrupt/resume、多代理等能力。[Eino 官方概览](https://www.cloudwego.io/docs/eino/overview/)

**判断：** 熟悉 Go、重视单一可执行文件部署的团队可以选 Eino。Haiji 当前主要等待模型和外部 I/O，尚无数据证明改 Go 能显著改善用户体验。Google ADK 也覆盖多语言并提供 agent/API server 能力；有现成 ADK 生态需求时值得评估，首版无需因此扩展候选名单。[Google 官方入门](https://github.com/google/adk-docs/blob/main/docs/get-started/index.md)

## Python 后端的队列如何选

建议验证 **FastAPI + PydanticAI + PostgreSQL + Procrastinate worker**，保持 API/worker 分进程、共享镜像；队列替代需通过事务与重启测试再定。Procrastinate 是 PostgreSQL Python 队列，支持同步/异步接入、未来任务、周期任务与重试。[官方说明](https://procrastinate.readthedocs.io/en/stable/index.html)

其 stable 文档明确支持外部数据库连接：通过 `configure(connection=...)`，在支持的 connector 下让业务写入与入队使用同一事务，提交由应用负责。它不是只共享连接池就自动获得事务一致性。[事务接入](https://procrastinate.readthedocs.io/en/stable/howto/production/external_connection.html)

**无论框架为何，提醒仍须由业务表与调度 worker 执行。** 工作流恢复不等于明早九点可靠通知；保留 reminder revision、发送前复核、幂等 occurrence、重试与投递未知状态。Procrastinate 官方正在招募维护者，锁版及升级维护也应纳入评估。

下一步用同一模型、同一批时间歧义/邮件建议/提示注入案例比较 PydanticAI 与 Pi，检查正确率、成本、接入代码和崩溃重试。零起步优先 PydanticAI，是适配度判断；最终由这个小型验证确认。
