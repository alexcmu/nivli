# Haiji 云端部署选项

核实日期：2026-10-11；依据官方文档。已有功能和本轮原生验收改动已提交为 `0787a67`。云端尚未部署，手机尚未配对长期云端环境。

## 对现有服务的要求

现有 Dockerfile 运行 Node 24。需要 API、常驻 pg-boss worker 和持久化 PostgreSQL，以及供 iPhone 配对的固定 HTTPS 地址。平台兼容性是基于现有进程模型的判断，上线时仍需验证迁移、worker 和公开健康接口。

## 免费优先：Northflank Sandbox

官方免费方案包含两个 services、一个 database 和两个 jobs，明确 always-on、不休眠；可分别承载 API、worker、PostgreSQL。公共文档没有明确列出 Sandbox 的固定 CPU、内存和存储配额，应在实际创建页确认免费资源。所有计划创建资源前都需要添加付款方式进行身份验证。Sandbox 面向个人探索/测试，没有生产 SLA，官方不推荐用于生产应用。

[官方套餐](https://northflank.com/pricing)、[免费资源和账户要求](https://northflank.com/docs/v1/application/billing/pricing-on-northflank)、[PostgreSQL 部署](https://northflank.com/docs/v1/application/databases-and-persistence/deploy-databases-on-northflank/deploy-postgresql-on-northflank.md)、[网络与 HTTPS](https://northflank.com/docs/v1/application/network/networking-on-northflank)

## Docker 部署方便：Railway

Railway 支持从项目 Dockerfile 构建服务，可以复用当前镜像，为 API 和 worker 设置各自的启动命令，再创建 PostgreSQL 数据库。使用 Docker 不会免除计算、存储和网络费用。

新用户试用为一次性 $5/最多 30 天，之后 Free plan 每月提供 $1 credit。Hobby 最低 $5/月并包含 $5 用量，超额另计；不能承诺 API、worker 与数据库整套长期免费或总价不超过 $5。已有 Docker Compose 部署结构需映射成平台服务、运行时变量和数据库持久卷。

[Dockerfile 支持](https://docs.railway.com/builds/dockerfiles)、[定价](https://railway.com/pricing)、[免费试用和后续 Free plan](https://docs.railway.com/pricing/free-trial)

## Supabase

Supabase 可以托管 PostgreSQL 和 Deno Edge Functions。免费函数的 worker wall-clock 上限是 150 秒，因此不能直接替代现有常驻 Node API/pg-boss 进程；用其数据库时仍需另选 API/worker 托管，或改写执行架构。数据库免费计划有容量和闲置暂停限制。

[Edge Functions](https://supabase.com/docs/guides/functions)、[函数限制](https://supabase.com/docs/guides/functions/limits)、[定价与数据库限制](https://supabase.com/pricing)

## 其他选项

Render 免费 web 会休眠，免费 PostgreSQL 30 天到期，worker 无免费实例；不满足用户的长期免费常驻目标。[免费限制](https://render.com/docs/free)

Oracle Always Free VM 可以自运行现有 Compose/PostgreSQL；需要自行维护 HTTPS、数据库和备份，并接受区域容量不足、闲置 VM 回收限制，作为免费云主机备选。[官方免费资源](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)

## 后续执行

确定平台并完成账户登录后部署、验证迁移与实际 AI worker，再给保留的 iPhone app 生成一次性配对码，验证重开恢复与笔记本断线时云端仍可创建/读取事项。部署不代替尚未实现的 APNs、离线变更同步及数据导出/恢复；已有个人数据迁移需另行确认实际来源和范围。模型 API 调用费用不包含在基础设施免费额度中。
