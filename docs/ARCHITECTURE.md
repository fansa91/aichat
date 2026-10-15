# AI 对话面板 — 架构设计（阶段一）

> 状态：设计稿，待用户确认后进入阶段二（后端实现）。
> 技术栈锁定：前端 React + TypeScript + Vite，UI 为 Tailwind CSS + shadcn/ui；
> 后端 Node.js + TypeScript + Fastify；数据库 MySQL。不更换技术栈、不引入非必要依赖。

## 1. 总体架构

```
┌─────────────┐                                   ┌──────────────────┐
│  浏览器      │  ── 直连模式 ──────────────────▶ │ 模型 API          │
│  React SPA   │    fetch(OpenAI 兼容 /v1/chat/    │ (OpenAI 兼容)     │
│  (web/dist)  │    completions, stream:true, SSE) │                   │
└──────┬──────┘                                   └──────────────────┘
       │  代理模式 / 数据持久化
       │  /api/* (JSON / SSE)
       ▼
┌─────────────┐        ┌──────────────┐
│   Caddy      │ ─────▶ │ Node+Fastify │ ─────▶ ┌─────────┐
│ 静态托管+反代 │ /api/* │    (api/)    │        │  MySQL  │
└─────────────┘        └──────────────┘        └─────────┘
```

- 前后端分离：`web/` 与 `api/` 独立构建、独立部署、独立升级。
- 前端编译产物为 `web/dist/`，由 Caddy 直接托管；Caddy 将 `/api/*` 反向代理到 Node.js 后端。
- Monorepo 仅用于代码组织，不做构建期耦合（前端构建不依赖后端，后端构建不依赖前端）。

## 2. 目录结构

```
aichat/
├── web/                    # 前端：React + TS + Vite + Tailwind + shadcn/ui
│   ├── src/
│   │   ├── components/     # shadcn/ui 组件 + 业务组件（ChatMessage、SessionList…）
│   │   ├── lib/            # api-client.ts（调自家后端）、model-client.ts（调模型 API）
│   │   ├── pages/          # ChatPage、SettingsPage（模型配置/密钥管理）
│   │   └── store/          # 会话/消息本地状态（zustand 或 React context，二选一）
│   ├── index.html
│   ├── vite.config.ts
│   └── package.json
├── api/                    # 后端：Node.js + TS + Fastify
│   ├── src/
│   │   ├── routes/         # auth、conversations、messages、model-configs、keys、chat
│   │   ├── services/       # 业务逻辑（proxy 转发、密钥加解密）
│   │   ├── db/             # mysql2 连接池 + 迁移执行器
│   │   └── index.ts        # Fastify 入口
│   ├── migrations/         # 版本化 SQL：001_init.sql、002_….sql（只增不改）
│   └── package.json
├── deploy/
│   ├── Caddyfile           # 静态托管 web/dist + /api/* 反代
│   ├── deploy.sh           # 一键部署脚本（参考 liuying/shiyin 风格）
│   └── aichat-api.service  # systemd 单元模板
├── docs/
│   ├── ARCHITECTURE.md     # 本文件
│   ├── SCHEMA.md           # MySQL 表结构说明
│   └── API.md              # API 契约
└── .github/workflows/build.yml  # CI：构建 web+api，发布 rolling `latest` Release
```

## 3. 两种请求模式

### 3.1 前端直连模式（默认）

- 浏览器用 `fetch` 直接调用用户配置的 Base URL（OpenAI 兼容 `/v1/chat/completions`，`stream: true`），前端自行解析 SSE 并逐 token 渲染。
- API Key **默认只保存在浏览器 localStorage**，不上传到自家服务器；设置页提供新增 / 修改 / 删除。
- 消息持久化走自家后端 `POST /api/conversations/:id/messages`（只传 role + content，**不带 Key**）；流式结束后前端把用户消息与助手回复分别落库。
- 适用：用户信任自己的浏览器环境、希望 Key 完全不出本地。

### 3.2 后端代理模式

- 浏览器 `POST /api/conversations/:id/chat`（SSE），后端用 mysql2 取不到 Key 时，要求请求头 `X-Model-Api-Key` 随请求携带（前端从 localStorage 读出后放在 header 里，**URL 中不出现**）。
- 后端收到后即时转发给模型 API，把上游 SSE 原样透传给浏览器；**Key 只存活于本次请求上下文，响应结束后丢弃，不写入数据库、不写入日志**（日志对该 header 做脱敏/跳过）。
- 若用户**主动勾选**“将 Key 同步到服务器”，后端才把 Key 经 AES-256-GCM 加密后存入 `api_keys` 表；代理时按需解密使用。同步入口必须有明确的风险告知文案（见 §6）。

### 3.3 多模态与多线路格式（2026-10-15 用户确认）

- 库内统一用 OpenAI 风格内容段数组表示多模态消息（`messages.content_type='parts'`）。
- `model_configs.api_format` 决定上游线路：`openai` / `anthropic` / `gemini`（具体映射见 API.md §8）。
- 无论直连还是代理，标准内容段 → 上游线路格式的翻译逻辑只有一份规范（API.md §8.2）：
  代理模式由后端翻译并把 SSE 归一化为 OpenAI 风格推送；直连模式由前端 `model-client` 按规范翻译与解析。

## 4. 数据流与状态

- 会话列表、消息历史、模型配置：以 MySQL 为唯一真实来源，前端按需分页拉取。
- 流式进行中的 token：只存在前端内存，完成后一次性落库（避免高频写库）。
- 鉴权：自家后端用账号密码 + 不透明 Bearer Token（`sessions` 表，90 天有效期，sha256 存 token 哈希）；所有用户数据按 `user_id` 隔离。

## 5. 安全设计

1. API Key 永不编译进前端代码、永不出现在 URL（含 query string）中。
2. 数据库凭据只存在于后端环境变量 / `api/.env`（0600 权限），不进前端、不进仓库。
3. 后端代理日志：跳过 `X-Model-Api-Key` 请求头与请求体中的密钥字段；错误日志只记脱敏后的上游状态码与错误类型。
4. 服务端存 Key 必须同时满足：用户明确勾选同意 + AES-256-GCM 加密（密钥来自环境变量 `AICHAT_KEY_ENCRYPTION_KEY`）+ 严格按 `user_id` 访问控制 + 列表接口只返回脱敏 hint（末 4 位）。
5. 登录接口做基础速率限制（防爆破）；密码用 scrypt（node:crypto，无原生依赖）哈希存储。
6. CORS：后端只允许配置的前端域名；生产环境关闭 Fastify 请求体日志中的敏感字段。

## 6. 部署（与 liuying VOD 播放器同构）

部署流程完全沿用 liuying 的成熟链路，只是资产换成前端 `dist`：

- CI（`.github/workflows/build.yml`）：push 到 main 后构建 `web/dist` 与 `api/dist`，用 softprops/action-gh-release 发布到 rolling `latest` Release，资产包括：
  `aichat-web-dist.tar.gz`、`aichat-api-dist.tar.gz`、`deploy.sh`、`aichat-api.service`、`Caddyfile`、`.env.example`。
- 服务器：`curl` 从 `/releases/download/latest/` 拉取资产 → 解压 → 运行 `deploy.sh`。
- `deploy/deploy.sh`（与 liuying 同风格的参数）：
  - `--download` 自动从 GitHub Release 拉取资产；或用 `--web-dist/--api-dist` 指定本地包；
  - `--port` 指定后端端口（默认 3002，避免与 liuying 3000、shiyin 3001 冲突）；
  - `--db-host/--db-port/--db-user/--db-pass/--db-name` 写入 `<dir>/api/.env`（merge-only，不覆盖手工修改，chmod 600）；
  - `--key-encryption-key` 写入 `AICHAT_KEY_ENCRYPTION_KEY`（服务端 Key 加密用）；不传则自动生成 32 字节随机值写入 `.env` 并打印一次提示；
  - node 路径自动探测（`command -v node`，可用 `--node` 覆盖）；默认以 root 运行 systemd 服务（`--user` 可改）；
  - 从模板生成 systemd 单元并 `daemon-reload`。
- Caddy：`deploy/Caddyfile` 只给模板（`root * <dir>/web/dist` + `file_server`，`/api/*` 反代 `127.0.0.1:<port>`），由用户手工接入（与 liuying 一致，deploy.sh 不动 Caddy）。
- 数据库：MySQL 5.7+ / 8.x 或 MariaDB 10.6+；后端启动时自动按序执行 `api/migrations/*.sql` 中未应用的迁移（记录在 `schema_migrations` 表）。

## 7. 阶段划分

| 阶段 | 内容 | 交付与测试 |
|---|---|---|
| 一（本阶段） | 架构设计、MySQL 表结构、API 契约 | docs + `001_init.sql`；在真实 MySQL 上执行迁移并校验表/索引/外键 |
| 二 | 后端：Fastify 路由、鉴权、迁移执行器、SSE 代理、密钥加解密 | `tsc` 通过；路由级集成测试（supertest 风格，用真实 MySQL）；SSE 透传用本地 mock 上游验证 |
| 三 | 前端：聊天 UI（多轮/流式/Markdown/代码高亮）、会话管理、模型配置页、双模式切换 | `vite build` 通过；直连模式对 mock OpenAI 服务做端到端验证 |
| 四 | 部署：Caddyfile、deploy.sh、CI workflow；联调 | 一键部署脚本 dry-run；Caddy 反代路径验证 |
