# API 契约（阶段一）

> Base URL：`/api`（Caddy 将 `/api/*` 反代到 Fastify 后端）。
> 认证：除 `GET /api/health` 与 `/api/auth/register|login` 外，全部接口需请求头
> `Authorization: Bearer <token>`。token 为登录/注册返回的不透明字符串，后端只存其 sha256。
> 所有用户数据按 token 归属的 `user_id` 隔离；跨用户访问返回 404（不暴露存在性）。
> Content-Type 均为 `application/json`，除 SSE 接口外。

## 通用错误体

```json
{ "error": "not_found", "message": "会话不存在" }
```

`error` 取值：`bad_request` / `unauthorized` / `forbidden` / `not_found` / `conflict` /
`upstream_error`（模型 API 异常） / `db_error` / `rate_limited` / `server_misconfigured`
（服务端未配置 `AICHAT_KEY_ENCRYPTION_KEY` 时 `/api/keys` 与服务端 Key 解密返回此码）。

## 0. 健康检查

`GET /api/health` → `200`

```json
{ "status": "ok", "db": "ok", "version": "0.1.0" }
```

`db` 为 `error` 时整体仍 200，由部署探针解读（避免 K8s/负载均衡误杀启动中的实例——本项目用 systemd，此处仅保留语义）。

## 1. 认证

### POST /api/auth/register
`{ "username": "yang", "password": "..." }`（username 3–64 字符，password ≥ 8 位）
→ `201` `{ "token": "…", "user": { "id": "…", "username": "yang" } }`
用户名已存在 → `409 { error: "conflict" }`。注册后自动登录（返回 token）。

### POST /api/auth/login
`{ "username", "password" }` → `200` 同上结构；失败 `401 { error: "unauthorized" }`。
登录接口有基础速率限制（同一 IP 10 次/分钟，超限 `429 { error: "rate_limited" }`）。

### POST /api/auth/logout（需认证）
→ `204`。使当前 token 失效。

### GET /api/auth/me（需认证）
→ `200 { "user": { "id", "username", "created_at" } }`。

## 2. 会话

### GET /api/conversations?page=1&per_page=20（需认证）
按 `updated_at DESC` 分页。
→ `200`
```json
{
  "items": [
    { "id": "…", "title": "…", "model_config_id": "…",
      "request_mode": "direct", "created_at": "…", "updated_at": "…",
      "message_count": 12 }
  ],
  "page": 1, "per_page": 20, "total": 35
}
```

### POST /api/conversations（需认证）
`{ "title": "新会话（可选）", "model_config_id": "…（可选）", "request_mode": "direct|proxy（可选，默认 direct）" }`
→ `201` 会话对象（含 `message_count: 0`）。

### GET /api/conversations/:id（需认证）
→ `200` 会话对象；非本人 → `404`。

### PATCH /api/conversations/:id（需认证）
`{ "title": "新标题" }` → `200` 更新后对象。

### DELETE /api/conversations/:id（需认证）
→ `204`。消息 CASCADE 删除。

## 3. 消息

### GET /api/conversations/:id/messages?limit=50&before_id=（需认证）
按会话查询、分页、时间排序：
- 不传 `before_id` 取最近 `limit` 条；传了取 `id < before_id` 的最近 `limit` 条；
- 一律按 `id ASC` 返回（id 单调递增即时间序）；
- `limit` 默认 50，最大 200。

→ `200`
```json
{
  "items": [
    { "id": 101, "role": "user", "content": "…", "content_type": "text", "created_at": "…" },
    { "id": 102, "role": "assistant", "content": "…",
      "content_type": "text", "tokens_in": 120, "tokens_out": 340, "created_at": "…" }
  ],
  "has_more": true
}
```
多模态消息的 `content_type` 为 `parts`，`content` 为内容段数组 JSON（格式见 §8）。

### POST /api/conversations/:id/messages（需认证）
**直连模式**用：前端流式结束后，把用户消息与助手回复分别落库（Key 不经过本接口）。
`{ "role": "user|assistant|system", "content": "…", "content_type": "text|parts（可选，默认 text）" }`
→ `201` 消息对象。同时刷新会话 `updated_at`（同一事务）。

### POST /api/conversations/:id/chat（需认证，SSE）
**代理模式**用：`{ "content": "用户本轮输入", "content_type": "text|parts（可选）" }`，
可选请求头 `X-Model-Api-Key: <key>`。
Key 来源优先级：请求头（transient，用完即弃）＞ 该会话 `model_config` 关联的服务端加密 Key。
两者都没有 → `400 { error: "bad_request", message: "缺少 API Key" }`。
后端按该会话模型配置的 `api_format` 把标准内容段翻译成对应上游线路格式（见 §8）。

- 成功：`Content-Type: text/event-stream`，后端把上游 SSE **归一化为 OpenAI 风格**后透传：
  `data: {"choices":[{"delta":{"content":"…"}}]}` … 结束时 `data: [DONE]`；
  流结束后落库用户消息 + 完整助手回复（含 usage 回填）。
- **标题自动生成**：当某会话完成首轮对话（第一条 assistant 消息落库）且标题仍为默认值
  `新会话` 时，后端用该会话的模型配置发起一次非流式请求
  （"用不超过20个字为这段对话生成标题，只返回标题本身"），将结果写入标题。
  直连模式下由前端在流结束后执行相同逻辑并 `PATCH` 标题。
- 上游建连失败 / 非 2xx：在流开始前直接返回 `502 { error: "upstream_error", message }`；
  流开始后上游出错：发送 `data: {"error":{"code":"upstream_error","message":"…"}}` 后关闭。
- 后端**不持久化**请求头带来的 Key，**不**将其写入任何日志（含访问日志与错误日志）。

## 4. 模型配置

Key 永不出现在此组接口的请求/响应中。

### GET /api/model-configs（需认证）
→ `200 { "items": [ { "id", "name", "base_url", "model", "api_format", "temperature", "max_tokens",
"system_prompt", "request_mode", "is_default", "created_at", "updated_at" } ] }`
按 `updated_at DESC`。`api_format` 取值 `openai`（默认）/`anthropic`/`gemini`。

### POST /api/model-configs（需认证）
`{ "name", "base_url", "model", "api_format?", "temperature?", "max_tokens?", "system_prompt?", "request_mode?", "is_default?" }`
→ `201` 配置对象。`is_default: true` 时应用层事务保证同用户之前的默认被取消。

### PATCH /api/model-configs/:id（需认证）
部分更新 → `200` 更新后对象。

### DELETE /api/model-configs/:id（需认证）
→ `204`。关联会话的 `model_config_id` 置 NULL（历史保留），关联的服务端 Key CASCADE 删除。

## 5. 服务端 Key（明确同意才同步）

前端直连模式的 Key 默认只在 localStorage，本组接口仅用于用户**主动勾选**“同步到服务器”。

### POST /api/keys（需认证）
```json
{ "label": "我的 OpenAI Key", "model_config_id": "…（可选）",
  "base_url": "https://api.openai.com/v1", "api_key": "sk-…",
  "consent": true }
```
- `consent` 必须为 `true`，否则 `400`；前端在勾选框旁必须展示风险告知文案：
  “Key 将经 AES-256-GCM 加密存储在服务器数据库中，仅你本人可用。仍建议优先使用浏览器本地存储。”。
- 后端加密后存 `api_keys`，→ `201 { "id", "label", "base_url", "key_hint": "…abcd",
  "model_config_id", "created_at" }`（**永不返回 Key 原文**）。

### GET /api/keys（需认证）
→ `200 { "items": [ { "id", "label", "base_url", "key_hint", "model_config_id", "created_at" } ] }`。

### DELETE /api/keys/:id（需认证）
→ `204`。

## 6. 前端直连模型 API（非自家后端，契约说明）

直连模式浏览器直接调用，前端 `model-client` 按模型配置的 `api_format` 组装请求并解析 SSE：

- `openai`：`POST {base_url}/chat/completions`，`Authorization: Bearer <Key>`，
  标准内容段原样发送；SSE 解析 `choices[0].delta.content`，`[DONE]` 结束。
- `anthropic`：`POST {base_url}/v1/messages`，请求头 `x-api-key: <Key>` +
  `anthropic-version: 2023-06-01`；system prompt 放顶层 `system`；SSE 解析
  `content_block_delta` 事件的 `delta.text`，`message_stop` 结束。
- `gemini`：`POST {base_url}/v1beta/models/{model}:streamGenerateContent?alt=sse`，
  请求头 `x-goog-api-key: <Key>`（Key 不进 URL）；`assistant` 角色映射为 `model`；
  SSE 解析各 chunk 的 `candidates[0].content.parts[*].text` 拼接。

```json
{
  "model": "gpt-4o", "stream": true,
  "messages": [ { "role": "system", "content": "…" }, { "role": "user", "content": "…" } ],
  "temperature": 0.7, "max_tokens": 4096, "stream_options": { "include_usage": true }
}
```
（以上为 openai 格式示例；另两种格式见 §8 的线路映射表。）

## 8. 多模态内容段规范（2026-10-15 用户确认）

支持 ChatGPT（OpenAI）、Claude（Anthropic）、Gemini 三家格式，以及支持这些格式的第三方中转。

### 8.1 标准内容段（库内唯一表示）

前后端内部统一用 OpenAI 风格的内容段数组；`messages.content_type='parts'` 时
`content` 列存其 JSON：

```json
[
  { "type": "text", "text": "描述这张图" },
  { "type": "image_url", "image_url": { "url": "https://example.com/a.jpg" } },
  { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,/9j/…" } }
]
```

- `url` 允许 `https?://` 或 `data:<mime>;base64,…`；`data:` 形式随消息原文入库
  （MEDIUMTEXT 上限 16MB，超大图片由前端压缩后再发——压缩策略待前端阶段定）。
- 第三方 OpenAI 兼容网关：按 `openai` 线路原样透传即可。

### 8.2 上游线路映射（后端代理 / 前端直连共用同一映射逻辑）

| | openai | anthropic | gemini |
|---|---|---|---|
| 地址 | `{base_url}/chat/completions` | `{base_url}/v1/messages` | `{base_url}/v1beta/models/{model}:streamGenerateContent?alt=sse` |
| 鉴权头 | `Authorization: Bearer <Key>` | `x-api-key: <Key>` + `anthropic-version: 2023-06-01` | `x-goog-api-key: <Key>` |
| text 段 | 原样 | `{"type":"text","text"}` | `{"text"}` |
| image 段（data:） | 原样 | `{"type":"image","source":{"type":"base64","media_type":"<mime>","data":"<b64>"}}` | `{"inline_data":{"mime_type":"<mime>","data":"<b64>"}}` |
| image 段（http） | 原样（上游拉取） | `{"type":"image","source":{"type":"url","url":"…"}}` | 建议走 OpenAI 兼容中转（原生 `file_data` 需 Files API URI，本项目不做上传） |
| system prompt | messages 首条 role=system | 顶层 `system` 字段 | `system_instruction: {"parts":[{"text"}]}` |
| 角色 | user/assistant | user/assistant | user/**model**（assistant→model） |
| 流式增量 | `choices[0].delta.content` | `content_block_delta` → `delta.text` | 各 chunk `candidates[0].content.parts[*].text` 拼接 |
| usage | `usage.{prompt_tokens,completion_tokens}` | `message_delta` → `usage.{input_tokens,output_tokens}` | `usageMetadata.{promptTokenCount,candidatesTokenCount}` |

代理模式下后端把三家 SSE **归一化为 OpenAI 风格**再推送给浏览器，前端只需一种渲染路径；
直连模式前端 `model-client` 按上表自行解析。

## 7. 待确认项归档（2026-10-15 已全部确认）

1. 会话标题自动生成 → **确认**：首轮对话完成后调模型按内容生成标题（见 §3）。
2. 系统级共享模型配置 → **确认**：不需要，每人自己配（BYOK）。
3. 多模态 → **确认**：支持 ChatGPT/Claude/Gemini 三家格式及兼容第三方（见 §8）。
4. 注册开放策略 → 默认**开放注册**（如需邀请码/关闭，后续再加，不在首版实现）。
