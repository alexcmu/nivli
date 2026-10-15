# 部署与配对（ticket 01）

Railway 从 GitHub 导入的步骤见 [根目录 README](../README.md)。镜像默认 `serve` 自动迁移并同时运行 API 与 AI worker；下述 Compose 继续显式使用独立进程角色。

本阶段提供 HTTPS 环境发现、管理员一次性配对码、设备会话与三个应用入口。agent/delivery 运行真实 PostgreSQL/pg-boss 并报告进程状态，尚未提供模型理解、Gmail、APNs 投递、提醒、备份自动化或完整 v1。`PUSH_MODE` 和模型数据去向是手机确认的信息，不是能力已可用的证明；当前推荐 `disabled` / `No model configured`。后续能力以对应 ticket 的验收为准。

## 安装

需要 Docker Engine、Compose v2、Python 3（部署脚本）和一个可以转发到本机 `127.0.0.1:3000` 的 HTTPS 代理。iPhone 必须信任服务器证书；不要绕过 TLS 校验。代理与证书由部署者管理；此 Compose 不自动获取证书。数据库不发布主机端口。应用根目录只读，UID/GID 为 1000，唯一可写临时目录为限额 `/tmp`。

1. 复制 `deploy/.env.example` 为 `deploy/.env`。设置实际 HTTPS `PUBLIC_URL`、环境名称和准确的数据去向。以 `openssl rand -hex 32` 生成数据库密码；使用 hex 避免 URL 编码问题。`.env` 含密码，请保存在仓库之外或确认它被 Git 忽略。
2. 在私有目录生成独立管理员凭据（不要复用数据库密码）：

   ```sh
   mkdir -m 700 /absolute/private/haiji-secrets
   openssl rand -hex 32 > /absolute/private/haiji-secrets/admin-secret
   chmod 0444 /absolute/private/haiji-secrets/admin-secret
   ```

   将绝对文件路径设置为 `ADMIN_SECRET_PATH`。本地 Compose secret 使用文件 bind mount，不能依赖 secret 的 `uid`/`mode` 自动重映射；文件必须能由容器 UID 1000 读取，私有父目录限制主机访问。运行时只收到 `ADMIN_SECRET_FILE=/run/secrets/admin_secret`，文件不写进镜像。
3. CI 发布镜像后，从 `image-evidence/image-digest.txt` 复制 `APP_IMAGE`。整个值形如 `ghcr.io/owner/repository@sha256:<64 hex>`。尚无发布时，使用下方开发构建。生产脚本会拒绝可变 tag。
4. 运行 `deploy/up.sh`。数据库健康后运行一次 migration；migration 成功后才启动 API、agent、delivery。四者使用同一镜像。迁移失败查看 `docker compose --env-file deploy/.env logs migration`，修正后再次运行部署脚本；不要删除数据卷。
5. 配置代理转发到 loopback 端口，再验证 `https://your-host/health/ready`。进程启动后数据库连接仍有有限重试；长时间数据库故障导致进程退出时 Compose 重启常驻进程。readiness 失败不能代表提醒已执行，worker 心跳也不证明尚未实现的投递能力。

## 配对与客户端

管理员通过受保护的 `/v1/admin/pairings` 创建短时一次性配对码。凭据放在 Authorization header，禁止放到 URL 或代理访问日志中；具体请求格式与过期策略见 OpenAPI。不要在手机输入管理员凭据。客户端先读取公开环境信息并展示 HTTPS 主机、环境名称、推送模式与模型去向，经用户确认后消费配对码。手动输入始终可用；扫码只输入同等信息。设备会话保存到 Keychain，重启恢复连接，过期/吊销按照 API 契约处理。

反向代理不得记录 Authorization、Cookie、请求正文或配对码。默认应用日志避免内容与凭据，代理和外部托管平台的日志策略仍由部署者配置。

## 开发与检查

开发构建无需已发布镜像，明确使用 local tag 与覆盖文件：

```sh
APP_IMAGE=haiji:local docker compose --env-file deploy/.env -f compose.yaml -f deploy/compose.build.yaml up -d --build --wait
```

`deploy/check-compose.sh` 构建当前源码并在独立随机项目/临时数据卷上验证 API readiness、数据库停机重连及迁移失败阻止常驻服务启动；退出时只删除该测试项目的数据卷。需要可用 Docker daemon。生产 Compose 的数据库数据卷不会被测试触及。

CI 在真实 PostgreSQL 17 上运行 `npm ci`、build、migration、API 测试和契约检查，再运行上述部署检查。原生构建测试在 macOS/Xcode 执行；Docker 只构建服务器，不构建或签名 iPhone App。实际签名与真机验收请按 iOS 文档执行。

镜像 workflow 在 tag/workflow_dispatch 时构建同一 commit 的 linux/amd64 与 linux/arm64，发布 SBOM/provenance，保存不可变引用、漏洞扫描和依赖许可证元数据。扫描报告是审阅证据，当前不按漏洞等级自动阻断发行。依赖声明缺失会标记 `UNDECLARED`。根项目许可证仍待维护者决定，未默认授予 Apache-2.0。

## 停止、数据与升级边界

停止：`docker compose --env-file deploy/.env down` 保留数据库卷。卸载容器后仍有数据库卷、secret、客户端 Keychain 和外部代理记录；只有明确决定永久删除数据时才手动删除相应文件/卷。不要将 `down --volumes` 用于重启或升级。

当前仅具备 ticket 01 初始迁移。完整升级、加密离机备份、恢复验证及提醒重建属于 ticket 25；尚未验收 RPO 24 小时/RTO 1 小时。生产升级前应在停止写入后独立备份数据库与配置/secret，在恢复副本验证迁移，保留旧镜像 digest 与原数据备份；不要把未经验证的升级当作无损承诺。备份包含配对与设备会话信息，应加密并限制访问。

## 本次验证证据

2026-10-11 在 Docker Desktop（linux/arm64）以本票真实后端源码运行 `BUILDX_BUILDER=desktop-linux deploy/check-compose.sh`，成功构建 Node 24 多阶段镜像、启动 PostgreSQL 17/迁移/API/两个 worker，API readiness 为 200；停止数据库并重启 API 后，恢复数据库再次达到 ready；替换 migration 为退出 73 的入口后，Compose 返回失败，API/agent/delivery 均未运行。测试退出已清理随机项目的数据卷。`deploy/up.sh` 另验证拒绝无 digest 的 local tag。当前证据不包含远程 GitHub Actions 执行、多架构发布、TLS 代理或真机结果。

## 更名后的已有部署

新建环境的默认 PostgreSQL 用户与数据库名为 `haiji`。使用已有持久卷升级时，在 `deploy/.env` 中将 `POSTGRES_USER` 与 `POSTGRES_DB` 设置为该卷原有的名称，并保持原密码和 Compose project 名称；仅更改初始化环境变量不会重命名已有数据库或角色。不要删除持久卷来完成更名。Railway 部署继续使用原有 `DATABASE_URL`。

iPhone 构建使用新的应用身份；重新配对、旧设备会话撤销与推送配置见 [iOS 说明](../ios/README.md)。旧环境中已保存的通知标识属于原设备的计划，不能当作新安装已安排的通知；切换前应取消旧设备的计划，再为新设备确认提醒。
