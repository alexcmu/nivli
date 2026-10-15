# Haiji APNs 技术参考

05 号任务提供自签名 App → 本人后端 → Apple APNs 的时间提醒路径。按用户 2026-10-15 的要求，时间提醒仅使用远程推送。手动、AI 创建和修改统一写远程 outbox；本地排程、回执接口与 DTO 已移除。

## Apple 侧准备

需要支持 Push Notifications 的 Apple Developer 身份。在 Apple Developer 的 Certificates, Identifiers & Profiles 中，为实际 Bundle ID 开启 Push Notifications，创建启用 APNs 的签名密钥，保存一次性下载的 `.p8` 文件并记录 Key ID、Team ID。密钥只放在服务器私有文件中，例如 `.secrets/apns-key.p8`，不放进 App、Git 或镜像。

当前开发 App 的 Bundle ID 为 `app.haiji.Haiji`。开发签名使用 `development` 与 sandbox APNs；发布签名使用 `production`。服务器 topic、环境、App entitlement 与签名描述文件必须一致。缺少密钥时可以保存事项，但不会发送远程提醒。

此次改名同时将工程改为 `ios/Haiji.xcodeproj`、scheme 改为 `Haiji`，Bundle ID 改为 `app.haiji.Haiji`。后续在 Apple Developer 中为这个新 Bundle ID 配置 Push Notifications，服务器 `APNS_TOPIC` 也使用相同值。旧 Bundle ID 的设备 token 不能直接用于新身份；安装新身份构建后，需要重新配对并在“我的 → 远程通知”重新注册。仅修改显示名称时无需变更推送身份，但本次工程确实修改了 Bundle ID。

Apple 文档：[注册设备](https://developer.apple.com/documentation/usernotifications/registering-your-app-with-apns)、[发送请求](https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns)、[处理响应](https://developer.apple.com/documentation/usernotifications/handling-notification-responses-from-apns)。

## 服务器配置

配置 `PUSH_MODE=self_signed`、`APNS_TEAM_ID`、`APNS_KEY_ID`、`APNS_TOPIC`、`APNS_ENVIRONMENT`、`APNS_KEY_FILE`。私钥必须是有效的 P-256 `.p8` 文件。API 和 delivery 进程读取同一身份；只要部分配置缺失或私钥格式错误，就给出静态配置错误，不打印密钥。

Railway 等托管环境也可使用私密变量 `APNS_PRIVATE_KEY` 保存 `.p8` 文件的完整 PEM 内容，此时不设置 `APNS_KEY_FILE`。两种来源只能选一个，解析失败只返回静态错误；不打印密钥。不需要把密钥打包进镜像。上传到托管平台前明确确认接收方与用途。

Compose 可叠加 `deploy/apns.compose.yaml`，在 `.env` 中设置 `APNS_KEY_PATH` 指向私钥文件，再运行：

```sh
docker compose -f compose.yaml -f deploy/apns.compose.yaml up -d
```

如同时使用模型配置，继续叠加已有 `deploy/model.compose.yaml`。Docker 的 `serve` 入口同进程启动 API、agent 和 delivery；独立 Compose 部署使用已有 delivery 进程。升级先运行迁移，数据库版本为 6；重复迁移保留远程提醒身份和投递结果。进程内定时器仅驱动持久 outbox 的恢复扫描，计划和投递资格都保存在 PostgreSQL。

## iPhone 配置与使用

默认构建使用 `ios/Haiji/HaijiPush.entitlements`。启用远程推送的签名构建显式使用 `CODE_SIGN_ENTITLEMENTS=Haiji/HaijiPush.entitlements APS_ENVIRONMENT=development`，并选择有 Push Notifications 能力的 Team 与对应描述文件。生产包改用 `APS_ENVIRONMENT=production`。`APNSEnvironment` Info.plist 值从同一构建设置生成，不依赖用户在手机上猜测环境。

App 中进入“我的 → 远程通知”，启用并允许系统通知。App 向 iOS 注册 token，再以当前已配对会话向后端登记；token 只绑定该 owner/device 和服务器指定 topic/environment，不出现在状态接口或日志中。前台恢复时重新注册并同步系统权限。设置页可关闭远程通知；关闭失败明确提示尚未得到服务器确认。App 启动时取消旧版本遗留的待发本地通知。

在“手动交代”设置具体时间后直接保存；自然语言创建也使用远程路径。修改、推迟、完成和撤销统一处理远程投递资格。安静时段 22:00–08:00 需要明确确认。权限关闭、token 失效或用户关闭远程时，发送前检查会阻止发送；不会据此启用另一条通知路径。

远程通知始终使用通用文案。打开只读取当前事项；完成和“30 分钟后”动作要求系统认证，并在业务层验证当前 occurrence、reminder revision、routing version。通知中的业务标识不赋予访问权限。

## 调度与结果含义

保存业务事项的事务同时写入远程 occurrence，作为可恢复 outbox。delivery 启动时扫描，默认每 60 秒滚动扫描未来 24 小时并创建 pg-boss job；更远的计划保留在数据库，不提前入队。job 仅含 occurrence ID、预期 reminder revision 和尝试序号。队列待执行及完成保留时间均显式设置为 7 天。扫描间隔和物化窗口由 worker 配置参数控制。

发送领取与事项变更、设备吊销和注册更新使用同一 owner 事务锁；领取时检查 active、当前版本、server 归属、有效设备、当前注册身份、通知许可、安静时段确认及有效窗口。同一尝试只能有一个发送者。领取后外部请求可能已经在途，随后完成/取消不能收回它；点开通知仍读取当前事项。

状态为 `planned/sending/accepted/unknown/failed/expired/cancelled`。`accepted` 仅表示 Apple 已受理，不表示手机已展示；断网、系统权限或 Focus 仍会影响到达和显示。明确的临时拒绝采用 5 秒、30 秒、120 秒的有界退避，最多 4 次请求；认证错误不自动重试。无效 token 停用，等待重新注册；410 的失效时间不会覆盖更新的注册。

网络中断、超时或崩溃后结果不明进入 `unknown`，扫描与重启均不会自动重发。用户选择新的提醒时间会创建新版本。正常发送不调用模型。

默认补发窗口为计划时刻之后 15 分钟；位于窗口内且晚于提醒时刻的精确截止时间会截短窗口。仅日期截止不虚构时刻，用户明确选择晚于截止时间的提醒保留完整窗口。超窗标记 expired，事项仍 active，不批量补发。

## 验收边界

本地自动化使用真实 PostgreSQL、pg-boss 和 HTTP/2 APNs 替代物；不需要付费模型或真实邮箱。真实 Apple 发送与锁屏接收必须在有密钥、Push Notifications 签名和通知权限的 iPhone 上另外验收。2026-10-15 已用私有 Sandbox 密钥和 USB 真机完成远程受理、通知中心展示、点开当前事项的验证。

## 远程专用升级

数据库迁移在锁内将现有 active 提醒转换为远程 occurrence，保留已有远程身份、结果与安静时段确认，删除旧本地计划/回执表。无有效设备注册时不发送；过期提醒由 worker 标记过期，不批量重放。发布时先停止旧版本 API/worker，再备份数据库并迁移。App 升级后启动会取消旧本地通知；旧 App 在升级前仍可能弹出此前安排的通知。

Portal `/portal` 提供管理员登录、配对、设备状态、独立测试通知与记录。登录会话仅保存随机 HttpOnly / SameSite=Strict cookie，12 小时过期，重启失效；浏览器不保存管理员密钥。测试发送记录先提交、再联系 Apple，重复测试标识不重复发送；超时或 30 秒后仍 sending 的记录显示 unknown，不自动重发。普通事项的重试规则保持不变。
