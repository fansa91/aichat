# MySQL 表结构设计（阶段一）

> 迁移脚本：`api/migrations/001_init.sql`、`002_multimodal.sql`（只增不改，后续变更用 `003_*.sql` 追加）。
> 字符集统一 `utf8mb4` / `utf8mb4_unicode_ci`，引擎 `InnoDB`。
> 兼容 MySQL 5.7+ / 8.x、MariaDB 10.6+。

## 实体关系

```
users 1───* sessions          （登录态，token 哈希存储）
users 1───* model_configs     （模型配置：Base URL / 模型名 / 参数 / 请求模式）
users 1───* api_keys          （服务端同步的 Key，AES-256-GCM 加密，需用户明确同意）
users 1───* conversations     （会话）
conversations 1───* messages  （聊天消息，CASCADE 删除）
model_configs 1───* conversations （SET NULL：删配置不删会话）
model_configs 1───* api_keys       （CASCADE：删配置连带删其 Key）
```

## 表定义

### users — 用户

| 列 | 类型 | 说明 |
|---|---|---|
| id | CHAR(36) PK | UUID，应用层生成 |
| username | VARCHAR(64) UNIQUE NOT NULL | 登录名 |
| password_hash | VARCHAR(255) NOT NULL | scrypt 哈希（node:crypto，无原生依赖） |
| created_at | DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP | |
| updated_at | DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP | 应用层更新 |

### sessions — 登录会话

| 列 | 类型 | 说明 |
|---|---|---|
| id | CHAR(36) PK | UUID |
| user_id | CHAR(36) NOT NULL, FK → users(id) ON DELETE CASCADE | |
| token_hash | CHAR(64) UNIQUE NOT NULL | Bearer token 的 sha256（库里不存原文） |
| expires_at | DATETIME NOT NULL | 默认 90 天 |
| created_at | DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP | |

索引：`idx_sessions_user (user_id)`。

### model_configs — 模型配置

用户可配多个（OpenAI 兼容 API：Base URL + 模型名 + 可选参数）。

| 列 | 类型 | 说明 |
|---|---|---|
| id | CHAR(36) PK | UUID |
| user_id | CHAR(36) NOT NULL, FK → users(id) ON DELETE CASCADE | |
| name | VARCHAR(100) NOT NULL | 用户起的别名，如 "GPT-4o（直连）" |
| base_url | VARCHAR(512) NOT NULL | 如 https://api.openai.com/v1（不带 /chat/completions） |
| model | VARCHAR(128) NOT NULL | 模型名，如 gpt-4o |
| temperature | DECIMAL(3,2) NULL | 可选 |
| max_tokens | INT NULL | 可选 |
| system_prompt | TEXT NULL | 可选，系统提示词 |
| request_mode | ENUM('direct','proxy') NOT NULL DEFAULT 'direct' | 前端直连 / 后端代理 |
| api_format | ENUM('openai','anthropic','gemini') NOT NULL DEFAULT 'openai' | 上游 API 线路格式（002 新增） |
| is_default | TINYINT(1) NOT NULL DEFAULT 0 | 默认配置（每用户至多一个由应用层保证） |
| created_at / updated_at | DATETIME | |

索引：`idx_model_configs_user (user_id, updated_at)`。

> 注意：API Key **不**存在此表。直连模式的 Key 只在浏览器 localStorage；代理模式的 Key 随请求头 transient 传递；
> 只有用户明确同意同步到服务器时，才加密存入 `api_keys` 表。

### api_keys — 服务端同步的 Key（加密存储）

| 列 | 类型 | 说明 |
|---|---|---|
| id | CHAR(36) PK | UUID |
| user_id | CHAR(36) NOT NULL, FK → users(id) ON DELETE CASCADE | 严格按 user_id 访问控制 |
| model_config_id | CHAR(36) NULL, FK → model_configs(id) ON DELETE CASCADE | 关联的模型配置 |
| label | VARCHAR(100) NOT NULL | 用户备注，如 "我的 OpenAI Key" |
| base_url | VARCHAR(512) NOT NULL | 冗余，方便展示 |
| key_encrypted | BLOB NOT NULL | AES-256-GCM：nonce(12B) + ciphertext；密钥来自环境变量 `AICHAT_KEY_ENCRYPTION_KEY` |
| key_hint | VARCHAR(8) NOT NULL | 末 4 位脱敏展示，如 `…abcd` |
| created_at / updated_at | DATETIME | |

索引：`idx_api_keys_user (user_id)`。列表接口永不返回 `key_encrypted` 解密结果。

### conversations — 会话

| 列 | 类型 | 说明 |
|---|---|---|
| id | CHAR(36) PK | UUID |
| user_id | CHAR(36) NOT NULL, FK → users(id) ON DELETE CASCADE | |
| title | VARCHAR(200) NOT NULL DEFAULT '新会话' | 可 PATCH 修改 |
| model_config_id | CHAR(36) NULL, FK → model_configs(id) ON DELETE SET NULL | |
| request_mode | ENUM('direct','proxy') NOT NULL DEFAULT 'direct' | 建会话时的模式快照 |
| created_at | DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP | |
| updated_at | DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP | 有新消息时应用层刷新，用于列表排序 |

索引：`idx_conversations_user (user_id, updated_at DESC)` —— 会话列表查询。

### messages — 聊天消息

| 列 | 类型 | 说明 |
|---|---|---|
| id | BIGINT UNSIGNED AUTO_INCREMENT PK | 单调递增，天然适合游标分页 |
| conversation_id | CHAR(36) NOT NULL, FK → conversations(id) ON DELETE CASCADE | |
| role | ENUM('user','assistant','system') NOT NULL | |
| content_type | ENUM('text','parts') NOT NULL DEFAULT 'text' | 002 新增：`text`=纯文本(Markdown)，`parts`=多模态内容段 JSON 数组（格式见 API.md §8） |
| content | MEDIUMTEXT NOT NULL | `text` 时为 Markdown 原文；`parts` 时为内容段数组 JSON |
| tokens_in | INT NULL | 上游 usage（流式完成后回填，可空） |
| tokens_out | INT NULL | 同上 |
| created_at | DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) | 毫秒精度，保证时间排序稳定 |

索引：
- `idx_messages_conv (conversation_id, id)` —— 按会话查 + 游标分页 + 时间排序（id 单调即时间序）；
- `idx_messages_conv_created (conversation_id, created_at)` —— 显式时间排序查询备用。

分页契约：`GET /messages?limit=N&before_id=X` 取 `id < X` 的最近 N 条，按 id ASC 返回；`has_more` 由是否取满判断。

### schema_migrations — 迁移记录

| 列 | 类型 | 说明 |
|---|---|---|
| version | VARCHAR(64) PK | 如 `001` |
| applied_at | DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP | |

## 设计取舍

1. messages 用自增 BIGINT 而非 UUID：游标分页（`before_id`）和排序天然稳定；所有查询都经会话归属鉴权，不存在枚举风险。
2. 会话删除 CASCADE 到消息；模型配置删除对会话 SET NULL（保留历史）；Key 随配置/用户 CASCADE 删除。
3. `is_default` 的“每用户至多一个”由应用层事务保证，不在 DB 加偏函数唯一索引（兼顾 MySQL 5.7）。
4. token 用量字段可空：直连模式下浏览器拿不到服务端 usage（OpenAI SSE 的 usage 块可解析，尽量填，拿不到则空）。
