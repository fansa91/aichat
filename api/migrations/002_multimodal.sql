-- 002_multimodal.sql — 多模态消息 + 多 API 格式支持
-- 兼容 MySQL 5.7+ / 8.x、MariaDB 10.6+
-- 依赖：001_init.sql

USE `aichat`;

-- 模型配置：上游 API 线路格式
ALTER TABLE `model_configs`
  ADD COLUMN `api_format` ENUM('openai','anthropic','gemini') NOT NULL DEFAULT 'openai'
  COMMENT 'openai={base_url}/chat/completions, anthropic={base_url}/v1/messages, gemini={base_url}/v1beta/models/{model}:streamGenerateContent';

-- 消息：多模态内容段
ALTER TABLE `messages`
  ADD COLUMN `content_type` ENUM('text','parts') NOT NULL DEFAULT 'text'
  COMMENT 'text=纯文本(Markdown原文), parts=多模态内容段JSON数组(见docs/API.md §8)',
  MODIFY COLUMN `content` MEDIUMTEXT NOT NULL
  COMMENT 'text: Markdown原文; parts: 内容段数组JSON';

INSERT IGNORE INTO `schema_migrations` (`version`) VALUES ('002');
