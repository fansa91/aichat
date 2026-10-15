# AI 对话面板（aichat）

React + TypeScript + Vite 前端（Tailwind CSS + shadcn/ui）|
Node.js + TypeScript + Fastify 后端 | MySQL 持久化 |
支持多轮对话、流式输出、Markdown/代码高亮、多模型扩展、BYOK（用户自带 Key）。

两种请求模式：**前端直连**模型 API（Key 默认只存浏览器本地）与**后端代理**（Key 随请求 transient 传递，不落库、不记日志；经用户明确同意才可加密同步到服务器）。

## 文档

- `docs/ARCHITECTURE.md` — 架构设计（含与 liuying 同构的部署方案）
- `docs/SCHEMA.md` — MySQL 表结构说明
- `docs/API.md` — API 契约

## 目录

- `web/` — 前端（React + TS + Vite + Tailwind v4 + shadcn 风格组件）
- `api/` — 后端（Fastify + TS，`src/` 源码，`migrations/` 数据库迁移）
- `deploy/` — 部署资产：`deploy.sh`、`aichat-api.service`（systemd 模板）、`Caddyfile`
- `.github/workflows/build.yml` — CI：构建前后端并发布 rolling `latest` Release

## 本地开发

```bash
# 后端（需 MySQL，先建库）
cd api && npm ci && npx tsx src/index.ts   # 环境变量见 src/config.ts

# 前端（/api 反代到 127.0.0.1:3002）
cd web && npm ci && npm run dev            # http://127.0.0.1:5173
```

## 部署（服务器）

```bash
# 拉取最新 Release 资产并部署
./deploy.sh --download --db-host 127.0.0.1 --db-port 3306 \
  --db-user aichat --db-pass <密码> --db-name aichat
# Caddy 按 deploy/Caddyfile 手工接入
```

首次部署会自动生成 `AICHAT_KEY_ENCRYPTION_KEY` 写入 `api/.env`（0600），请妥善保管。

## 阶段计划

| 阶段 | 内容 | 状态 |
|---|---|---|
| 一 | 架构设计、MySQL 表结构、API 契约 | ✅ 完成 |
| 二 | 后端：Fastify 路由、鉴权、迁移执行器、SSE 代理、密钥加解密 | ✅ 完成（44 项测试全过） |
| 三 | 前端：聊天 UI、会话管理、模型配置页、双模式切换、模型列表拉取 | ✅ 完成 |
| 四 | 部署：Caddyfile、deploy.sh、CI workflow；联调 | ✅ 完成 |

每个阶段完成后运行相关测试并报告：修改内容、测试结果、遗留问题。
