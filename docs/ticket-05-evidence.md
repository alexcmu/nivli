# Ticket 05 — 自有 APNs 远程提醒

2026-10-14，基于 `integration/nivli-v1` / `c5198e8` 的当前工作区。实施开始前已有模型配置、相对时间提醒和本地通知内容等未提交改动，本轮没有清除或提交它们。

应用已更名为 Haiji。以上实施与下文测试发生在改名前；原始分支和日志文件仍使用 `nivli` 名称，保留真实路径。它们不构成改名后的重新验收记录。当前推送身份与构建路径以 [APNS.md](APNS.md) 为准。

## 已实现的软件路径

- 严格的服务器 APNs 身份/私钥配置；ES256 provider JWT、HTTP/2 TLS、sandbox/production、可见 alert、expiration 和真实 provider 结果分类。私钥与设备 token 不进入公开状态或日志。
- 当前已配对设备注册、身份匹配、显式启用/关闭与系统许可状态；注册幂等键重放不能覆盖之后的关闭，修改请求体会冲突。
- 手动创建显式 server-owned 时间提醒，在业务事务中写入持久投递 outbox；不生成本地通知计划、不自动切换归属。独立 `remote-delivery` pg-boss 队列与滚动扫描在 `serve` 和独立 delivery 入口接入。
- 发送前在与事项变更/吊销共用的 owner 锁下校验当前状态、版本、归属、注册、许可、安静时段及有效期；尝试身份和数据库状态阻止双 worker 重复发送。
- 明确临时拒绝有界重试；未知网络结果、过期 sending lease 均保留 unknown，重启/扫描不重发。无效 token 停用，旧失效时间不覆盖新的注册。超过补发窗口不会批量补发，事项仍 active。
- 原生远程通知设置、注册回调、显式远程事项创建、静态投递状态、安静时段确认、打开当前事项和需要系统认证的完成/推迟动作。动作经过当前远程 occurrence/revision 校验；修改和撤销保留远程归属。
- schema 5、可重复迁移、OpenAPI 与共享 Swift JSON 契约；独立远程 entitlement，默认本地签名路径保留。配置说明见 [APNS.md](APNS.md)。

## 自动化证据

APNs 专项 14 项通过：12 项真实 HTTP/PostgreSQL/pg-boss 行为测试，2 项配置与真实本地 HTTP/2 替代服务测试。覆盖 JWT 签名/缓存与发送头、受理/拒绝/连接中断、隐私 payload、重复领取、双 worker、未知/崩溃/重启、有限重试、无效 token、任务变更、旧通知动作、关闭/许可状态、安静时段、提交回滚、幂等与重复迁移、截止时间截短、过期及设备吊销。

测试时钟推进同时推进替代队列的到期时间；崩溃、提交失败和迁移使用测试数据库故障注入。没有调用真实 Apple APNs、付费模型或私人 Gmail。

本机 Docker daemon 未运行，本轮数据库为独立临时 PostgreSQL 16 实例和真实 pg-boss 12.37.1；未声称完成生产 PostgreSQL 17 或远程 CI 验证。既有 CI 的 PostgreSQL 17 配置保留。

Swift 21 项测试通过，包括新增远程 DTO、动作身份和显式远程创建命令契约。最终 iOS Simulator Debug 构建通过，未签名、未安装到用户手机，未将编译成功称为原生交互或系统通知认证验收。TypeScript build、契约导出及示例验证通过。

日志保存在本机 `/tmp/nivli-apns-focused.log`、`/tmp/nivli-apns-tests-final.log`、`/tmp/nivli-apns-swift-final.log`、`/tmp/nivli-apns-build-final.log`；不作为发行产物。最终全量回归结果在下文补记。

## 尚未验收

用户明确确认没有 APNs 密钥，因此真实 Team/Bundle/APNs key 配置、带 Push Notifications 描述文件的真机签名安装、Apple 受理、后台/锁屏接收、点按与系统动作认证尚未验证。配置静态校验与替代物不证明 Apple 接受实际身份。

云端部署、已有手机安装与配对配置未更改。自然语言创建继续使用既有本地路径；本地/远程切换、邮件建议摘要、官方推送中继分别属于后续任务。05 的整体验收未完成，工单保留未完成项。

## 最终回归

最终工作区全量 `npm test`：11 个文件、87 项全部通过，53.02 秒。最终 Swift：21 项全部通过；iOS Simulator Debug build 成功。APNs Compose 覆盖文件通过 `docker compose ... config --quiet`（使用合成配置，未启动容器）。`git diff --check` 通过。所有结果均为本机自动化证据，05 的真机部分仍未完成。


## 2026-10-15 — Apple 账号与 USB 签名准备

用户完成会员续费并创建、下载 Haiji Push Dev 密钥。Apple 页面确认它仅关联一个 topic，环境为 Sandbox；已为 `app.haiji.Haiji` 注册普通 Push Notifications 能力。本机私有副本以 600 权限保存在 Git 忽略目录；P-256 解析及本地签名校验通过，不记录密钥正文。

带 `aps-environment=development` 的真机签名构建成功，签名应用身份为 `Q974D4E3V6.app.haiji.Haiji`，并通过 USB 安装到现有同身份 App，未卸载。通过 USB/XCUITest 只读检查环境页面：新版 Haiji 尚未配对；测试 1 项、零失败、9.221 秒。临时检查测试已移除，重新安装了带推送权限的构建。未使用 iPhone 镜像操作。

现有 Railway 后端仍未启用推送。云端部署单独准备，不包含其他 session 的界面或模型行为改动。新增托管环境私密变量 `APNS_PRIVATE_KEY` 支持及 1 项配置测试通过；上传私钥、云端发布、手机配对、真实 Apple 受理及展示仍待完成，不据此勾选整票验收。

## 2026-10-15 — 本机真实 APNs 与远程专用调整

前述“无密钥 / 自然语言仍走本地”的记录为当时状态，已被后续用户操作与需求取代。私有 Sandbox 密钥已配置；此前本机后端、真实 PostgreSQL/pg-boss、USB iPhone 的测试通过：registered=true、accepted=true、visible=true、opened_current_task=true、attempts=1、local_plan=false。验收看到通知中心里的 Haiji 通知，不据此声称已验证锁屏提示音或系统动作认证。临时测试配对随后吊销，未卸载用户 App。

用户接着要求删除所有本地推送代码并增加 Portal。现已移除 iOS 本地 scheduler/journal、服务端本地计划/回执 API 与 DTO，手动与 AI 创建、编辑、推迟、恢复统一远程 outbox。数据库版本 6 迁移转换 active 计划并移除旧本地表；旧的到期提醒不会重放。App 启动保留一次旧待发通知清理，避免升级重复提醒。

本轮后端 90 项、Swift 17 项通过；Simulator app/UI test build 与 USB 签名构建通过。Portal 桌面与窄屏 UI、管理员权限、测试推送与幂等、未知结果、失效注册、升级行为验证见 [PORTAL.md](PORTAL.md)。本轮新 USB 安装与 Portal 真推送因设备锁屏待续，不能把之前的真实 APNs 证据算作新 Portal 的真实发送结果。云端未部署。

## 2026-10-15 12:54 — 新 Portal 真实推送补验完成

USB iPhone 已解锁。远程专用新版签名更新安装成功，生产环境连接 UI 配对本机 Portal 后端并注册远程通知；1 项测试通过，32.808 秒。浏览器 Portal 发起真实 Apple Sandbox 测试发送并显示 accepted。另 1 项 USB UI 测试通过（8.541 秒），从系统通知中心找到“Haiji 测试通知”，点按后 Haiji 进入前台：`HAIJI_PORTAL_REAL_APNS visible=true opens_app=true`。此次证据来自真实 Portal/API/APNs/iPhone，不使用推送替代物。数据库确认事项数量为 0。

保留当前手机配对、注册及 Portal 发送记录，方便用户继续测试；清理一次性 fixture、项目资源引用与 UI 测试 runner。服务和临时 HTTPS tunnel 仍在本机运行。未验证锁屏提示音或通知动作认证，不扩大本轮结论。
