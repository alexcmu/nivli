# 01: 部署个人环境并配对 iPhone

**What to build:** 用户从空环境启动 Nivli，在原生 iPhone App 中确认服务地址与数据去向，再用一次性配对码连接个人环境；重启后仍能看到连接状态。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

**Parent:** [Nivli v1 Engineering Specification](../spec.md)

**规格定位：** US-01、US-03–US-05、US-54、US-57；D-01、D-03、D-07、D-10、D-13–D-14；AC-01、AC-21。引用场景按本票范围验收，不要求提前实现其他票的功能。

**交付范围：** 自签名 v1 必需范围。 从零项目的第一条可运行路径。采用 SwiftUI/iOS 26、TypeScript/Node 24、Fastify、PostgreSQL 17、pg-boss 与 Compose；只建立此闭环需要的模块和 schema，不预建全部业务表。

**界面依据：** [Nivli UI 设计](../../../archived/nivli-ui-design.md)。使用原生 SwiftUI，沿用父规格的可访问性与错误反馈要求。

**测试边界：** 沿用父规格 T-01/T-02：从公开 API 验证外部可见行为，使用真实 PostgreSQL/pg-boss，仅替代模型、邮箱和推送等外部服务；涉及系统通知、权限或离线的结果补充原生真机证据。新增或修改的 API 同步维护 OpenAPI 与 Swift DTO 契约。

## Acceptance criteria

- [x] Compose 启动数据库、迁移和应用入口；API、agent worker、delivery worker 使用同一应用镜像的不同入口。数据库未就绪时可重试，迁移失败时不启动不兼容的服务。
- [x] 独立管理员凭据可生成短时一次性配对码；手机只能消费配对码，不能通过公开入口创建管理员。并发消费、过期、重复使用与过多尝试均有明确拒绝结果。
- [x] 手机支持手动地址/配对码和等价扫码输入；先展示并确认 HTTPS 主机、环境名称、推送模式与模型数据去向，再发送凭据。拒绝相机权限仍能手动配对。
- [x] 设备会话存入 Keychain；服务端可验证 owner/device/session。公开环境信息不包含私人数据，未认证业务请求被拒绝，凭据和正文不进入日志。
- [x] 建立原生“此刻 / 交代 / 我的”导航和环境状态页，未实现入口有准确空态；连接失败可重试，重启恢复已配对状态。此阶段不提前索取通知、位置或邮箱权限。
- [x] 为本闭环发布 OpenAPI 契约及 Swift DTO 校验；统一错误包含 code、message、requestId、retryable。访问凭据续期和吊销策略有可执行契约。
- [x] CI 从公开 API 完成一次真实 PostgreSQL 上的配对流程，验证码并发消费与未授权访问；原生界面验证连接成功/失败、深浅色、Dynamic Type 和可访问标签。

**完成条件：** 验收项全部通过并附可复核证据；需要外部凭据、真机或审核而尚未验证的项保持未完成。先满足所有 Blocked by，再开始实施；ready-for-agent 表示规格可实施，不表示依赖已经完成。


## Comments

### 2026-10-11 — ticket 01 实施验收

本票已按当前授权范围完成，Status 继续保留 ready-for-agent；本地 tracker 通过验收勾选与此证据评论记录完成，不引入额外 triage 标签。

- Compose：真实 PostgreSQL 17、Node 24 的同一应用镜像启动 migration/API/agent/delivery；数据库恢复后 readiness 成功；强制 migration 退出 73 时常驻服务未启动。生产部署脚本要求镜像 digest，基础镜像 digest 与 npm lockfile 已锁定。证据见 docs/deployment.md 与 docs/ticket-01-backend-evidence.md；本地详细日志 /tmp/nivli-compose-check.log。
- 后端：9 个真实 PostgreSQL 上的公开 HTTP 测试通过，覆盖管理员凭据、配对码一次消费/并发/过期、唯一主要设备、匿名拒绝、续期轮换、吊销、重试幂等/冲突、JSON 键顺序、限流跨重启、日志隐私及吊销后重新配对。strict TypeScript build、OpenAPI 再生成无漂移及共享 DTO 示例校验通过。
- 原生：4 个 Swift 公共契约测试通过；Alchemist 真机签名 App 完成真实 HTTPS 环境检查 → 明确确认 → 配对 → Keychain → 终止/重新启动后认证恢复 → 吊销闭环（1 test, 0 failures, 27.140 s）。最终真机手动失败、深/浅色导航及相机拒绝回到手动输入的 3 个功能测试通过（0 failures, 44.119 s）。iOS26.5 模拟器签名导航测试通过。证据见 ios/VALIDATION.md。QR 和手动输入共用验证/确认路径，扫码不提前发送凭据。
- 用户明确要求“我不在乎无障碍，直接推进”，本轮 Dynamic Type/无障碍正式验收不再是完成门槛。已完成的语义字体、可读颜色与热区改进保留，未宣称正式无障碍审计通过。
- CI 工作流已提供真实 PostgreSQL HTTP/契约/Compose 检查以及 macOS Swift/Xcode 测试，模拟器使用 ad-hoc signing 以验证 Keychain。没有远程仓库，未声称 GitHub Actions、多架构发布、扫描或发行镜像已在远程执行；这些发行证据属后续发布阶段，不把本票称为完整 v1。

本票无需模型、Gmail 或 APNs 凭据；提醒、通知、来源、备份等后续能力没有预建或伪装为已开放。临时 HTTPS/数据库仅用于合成验收，原始 xcresult 保持私有，不提交临时配对凭据。
