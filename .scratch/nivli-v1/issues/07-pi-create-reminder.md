# 07: 用 Pi 创建明确时间提醒

**What to build:** 用户在“交代”输入明确时间指令，Pi 解释后由业务服务保存事项，展示当前结果确认卡，并在手机安排提醒；失败时原话可恢复或转为手动设置。

**Blocked by:** [03: 安排本地时间提醒](03-local-time-reminder.md)

**Status:** ready-for-agent

**Parent:** [Nivli v1 Engineering Specification](../spec.md)

**规格定位：** US-02、US-07–US-08、US-11–US-13、US-19、US-25、US-51、US-57；D-03–D-07、D-10、D-13；AC-02–AC-05、AC-16。引用场景按本票范围验收，不要求提前实现其他票的功能。

**交付范围：** 自签名 v1 必需范围。 锁定 Pi 已发行版本，采用 pi-ai + pi-agent-core 的进程内 adapter。先完成单轮明确输入；歧义必须停在待澄清，不能等 08 才阻止错误承诺。

**界面依据：** [Nivli UI 设计](../../../archived/nivli-ui-design.md)。使用原生 SwiftUI，沿用父规格的可访问性与错误反馈要求。

**测试边界：** 沿用父规格 T-01/T-02：从公开 API 验证外部可见行为，使用真实 PostgreSQL/pg-boss，仅替代模型、邮箱和推送等外部服务；涉及系统通知、权限或离线的结果补充原生真机证据。新增或修改的 API 同步维护 OpenAPI 与 Swift DTO 契约。

## Acceptance criteria

- [x] 管理员可配置并测试模型提供方，客户端查看模型数据去向且不接收模型密钥。Pi 类型不泄露到领域接口，默认 shell、文件及任意网络工具不开启。
- [x] POST /v1/inputs 持久化 InputEvent 与 queued run 后返回 202；客户端查询 run 获取真实实体结果，普通模型回复不能作为保存成功证据。
- [x] adapter 接收服务端 owner、时区、允许证据、预算和取消信号，输出受 schema 校验的 proposal/clarification/回复/失败；业务服务校验归属、时间及授权后提交。
- [x] 明确交代可直接保存；日期或对象不足以确定时显示需补充信息，普通愿望和上下文推测不静默创建正式承诺。
- [x] 业务操作键来自输入身份、目标和操作种类，不能依赖模型 tool-call ID；重复输入提交或重试不复制任务。模型原文和隐藏推理不写常规日志。
- [ ] 前台提交保留草稿；支持中文输入法组合、Enter/Shift+Enter、处理中和失败重试。确认卡显示当前标题、日期/时区、deadline、来源与真实排程状态。
- [x] 实现初始每 run 3 次模型请求、6 次工具调用及硬超时上限的执行约束，模型不可用时仍可使用手动路径；09 扩展完整取消/预算和恢复体验。
- [x] 公开 API 测试用受控模型贯通输入→业务结果→本地排程回执，覆盖非法/越权 proposal；另对锁定 Pi 版本做一次显式配置的真实模型 schema/工具契约冒烟。

**完成条件：** 验收项全部通过并附可复核证据；需要外部凭据、真机或审核而尚未验证的项保持未完成。先满足所有 Blocked by，再开始实施；ready-for-agent 表示规格可实施，不表示依赖已经完成。

## Comments

- 2026-10-11 真实模型冒烟：用户提供服务端 key 文件后，`NIVLI_REAL_MODEL_SMOKE=1 npm run model:smoke` 使用官方 Anthropic endpoint 和实际 Claude Sonnet 5.5、Pi 1.1.0 成功。一次请求、一次工具调用，proposal 通过 schema 与独立业务时间/授权校验；未写业务实体。独立测试预算 0.5 USD，报告 usage 估价 0.0072955 USD（不是供应商账单）。密钥未输出、未复制到仓库或客户端；IME 及其他尚未观察的验收仍保持开放。

- 2026-10-11：按用户“AI agent 先走通、email connection 最后”及父规格顺序调整实现 07。服务端真实 Pi 1.1.0 adapter、Anthropic Claude Sonnet 5.5 受控 HTTP serializer/工具测试、InputEvent durable outbox、真实 pg-boss worker、独立业务验证及本地 occurrence 回执已实现。`npm test`：4 文件、34 测试通过（其中 07 为 9 个公开 HTTP 行为测试）；`npm run build` 通过；隔离 PostgreSQL 数据库导出/校验 OpenAPI 与共享 JSON fixture 通过。
- 原生交代已实现 Keychain 草稿、排队查询、幂等失败重试、真实事项确认与通知安装、原话手动回退；12 Swift contract 测试与模拟器构建通过。Enter/Shift+Enter/中文组合及 AI 新事项通知的完整真机操作尚未验收，因此该 UI 验收项保持未完成。
- 管理员可通过服务端 key 文件/显式环境变量及 Compose model override 配置，并使用管理 API 或显式 opt-in `npm run model:smoke` 测试。当前尚无管理员提供的模型 API key，未调用真实付费模型，也没有读取 Claude Code OAuth；真实模型 schema/工具契约冒烟验收保持未完成。
- 日期校验支持明确年月日、今天/明天/后天与数字时刻；其他表达安全停在澄清。原始工具调用计数含非法工具；超过 6 的整批中止，3 请求/1024 输出 token/60 秒上限、无 SDK 重试、attempt fencing 阻止已失效执行提交。普通模型文字不作为事项保存证据。
- 2026-10-11 合并 04 和最新 integration 后复核：服务端 39 测试通过，Swift 13 测试通过，隔离数据库重新导出共享契约通过；SCHEMA_VERSION=3 保留 04 行为和 agent 表验证。设备 AI 交代验收需新建隔离 HTTPS/受控 provider fixture，未用模拟器结果冒充真机验收。
- 2026-10-11 聚焦真机补充：临时独立 app bundle 与 HTTPS/数据库 fixture 已贯通生产交代 Enter 提交、处理中终止并重开恢复、真实 Pi/pg-boss 业务保存、当前确认卡、一次任务/一次请求、真实 OS pending=1 与通用隐私预览、重开与断开清理。正确构建测试通过，证据见 `docs/ticket-07-device-evidence.md`。中文输入法组合和 Shift+Enter 未由程序化 Unicode 测试代验，该 UI 项仍未勾选；真实 Claude 凭据冒烟项仍未完成。

- 2026-10-11 AI review fixes: 已修复否定/条件语句被模型误提为完成或取消、重试后再次取消沿用旧操作身份、明确 deadline 被遗漏的问题；按原始输入时刻和时区解析下一未来周五，提交时仍拒绝已过去的提醒。公开 HTTP/真实 PostgreSQL/pg-boss/Pi 全套 57 测试与最终否定语句专项、15 Swift 测试、通用 iOS Simulator 构建通过。证据见 [AI review fixes](../../../docs/ai-review-fixes-evidence.md)。新增至 51 条评估标注，真实 Claude 评估仍为 not_run，未关闭原有外部凭据或 IME 验收项。

- 2026-10-11 targeted review follow-up: create 与 edit/complete/cancel 共用保守的当前指令授权校验，英文 if/unless/when 与中文 假如/若/一旦 不再变成无条件提醒；gift 等含有 if 字母的词仍可提交。原生 Stop 意图先持久化，在首次提交或 retry 回执未明时保留并延后取消，确认后用新 attempt 操作身份发送；覆盖无 runId、重启、丢失回执与真实 HTTP 延迟 retry 回执/晚到模型输出。17 Swift 测试、通用 iOS 构建及最终 58 项公开 HTTP/PG/队列测试无未处理错误通过；隔离数据库 teardown 的 pg-pool 3.14.0 关闭竞态已通过共用有界连接 drain 修复，未隐藏连接泄漏。详见 [AI review fixes](../../../docs/ai-review-fixes-evidence.md)。真实 Claude 与既有未验收项保持开放。

- 2026-10-11 真实 Claude 评估：管理员配置官方 Anthropic API key 后，Pi 1.1.0/真实 PostgreSQL/pg-boss/公开 HTTP 的最终单版本 `ac9d741` 完成 51 中英文案例、69 步骤；50 案例/68 步骤通过。唯一 `eval-50` 凭据/shell 注入请求返回 failed/0 tools，未达标注 needs_clarification，保持失败。首次发现的修改操作 enum/英文 Make that 与 DST 唯一时刻过度澄清已修复，保留首次及聚焦结果。全部五次评估 usage 估价 0.785234 USD + 未知请求预留 0.282624 USD = 保守 1.067858 USD，不是供应商账单；最终构建及 59 项服务端测试通过。详见 [真实评估证据](../../../docs/evals/claude-sonnet-5-5-evidence.md)。真实模型记录部分已完成，中文 IME/Shift+Enter 仍未验收，因此组合验收项保持未勾选。

- 2026-10-11 refusal 跟进：锁定 Pi 将原始 refusal/sensitive 映射成 error，已用受控外部 SSE 公开 HTTP 红→绿验证并在 `344fb71` 修复为静态不支持结果、稳定 MODEL_REFUSED、已知 usage 结算；缺 usage 保留未知预留，取消/超时/真正传输故障不误分类。拒绝输入不能进入澄清授权链（replyTo 返回409），history/context 携带错误码。真实 eval-50 最终版本单例通过：1request/0tools，usage估价0.004093USD、unknown0；前次完整50/51结果仍原样保留，没有第三次全量付费重跑。七次评估保守累计1.076034USD，详见真实评估证据。IME/Shift+Enter仍未验收。
