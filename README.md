# Haiji

原生 iPhone AI 时间提醒应用。后端使用 Node 24、Fastify、PostgreSQL 与 pg-boss；本地通知由 iPhone 安排。

## 在 Railway 导入

1. 在 Railway 选择 **Deploy from GitHub repo**，选择本项目仓库，分支选 `main`。仓库的 Dockerfile 默认启动 `serve`：自动迁移数据库，同时运行 API 和 AI worker。
2. 在同一项目添加 **PostgreSQL**。打开 Haiji 服务的 **Variables**，设置：
   - `DATABASE_URL=${{Postgres.DATABASE_URL}}`，数据库服务名称不同时使用对应名称。
   - `ADMIN_SECRET`：在本机运行 `openssl rand -hex 32` 生成，保存为服务端密钥，之后保持不变。
   - `ANTHROPIC_API_KEY`：你的服务端 Anthropic API key。
   - 其余可采用根目录 [.env.example](.env.example) 的默认值。密钥填在 Railway Variables，不提交到 GitHub。
3. 在 **Settings → Networking** 生成公网域名，目标端口填 `PORT` 的值（示例为 `3000`）；服务读取 Railway 的 `RAILWAY_PUBLIC_DOMAIN`。然后部署；建议把健康检查路径设为 `/health/ready`。若使用自定义域名，设置 `PUBLIC_URL=https://你的域名`。

默认镜像已包含 worker，不需要再部署第二个 worker 服务。数据库保存在 Railway PostgreSQL 的持久卷中，应用容器可重建。迁移失败会阻止服务启动。保持服务常驻，不启用 Serverless 休眠。

GitHub 的 `main` 更新后，Railway 连接该分支的服务可自动部署。当前 Railway 已停用新服务的 `railway.json` 配置读取，因此这里直接使用 Docker 默认启动和运行时变量，无需设置自定义 Start Command。详见 [自动部署](https://docs.railway.com/deployments/github-autodeploys) 和 [配置支持现状](https://docs.railway.com/infrastructure-as-code)。

## 部署后连接 iPhone

先检查 `https://你的域名/health/ready`。用管理员密钥请求 `POST /v1/admin/pairings` 生成一次性配对码，在 App 的“我的 → 环境连接”输入 HTTPS 地址和配对码。管理员密钥和模型 key 都不输入手机；配对成功后连接凭据保存在钥匙串中，重开 App 自动恢复。

Railway 的账单和 Anthropic 的模型调用费用分别计算。模型每日预算默认为 USD 1，可通过 `MODEL_DAILY_BUDGET_USD` 调整。Gmail 真实连接仍按当前验收范围延后。

## 本地开发与现有部署

- `npm ci && npm test`：编译并运行真实 PostgreSQL HTTP/worker 测试，默认测试数据库为本机端口 55432。
- `npm run build`：编译后端。
- `swift test --package-path ios`：原生公共契约测试。
- [现有 Docker Compose 部署](docs/deployment.md)仍使用显式 `api` / `agent` / `delivery` 角色，支持 `ADMIN_SECRET_FILE`；文件密钥优先于环境变量。
- [iPhone 构建与使用](ios/README.md)。

当前实现范围以 `.scratch/haiji-v1/issues/` 的验收记录为准，完整 v1 尚未完成。
