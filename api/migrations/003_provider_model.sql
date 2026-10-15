-- 003_provider_model.sql
-- 会话直接记录 provider + model（LobeChat 风格 provider 配置），
-- 不再强依赖 model_configs 表；旧数据的 model_config_id 保留兼容。

ALTER TABLE conversations
  ADD COLUMN provider VARCHAR(16) NULL COMMENT 'openai|anthropic|gemini' AFTER model_config_id,
  ADD COLUMN model VARCHAR(128) NULL COMMENT '模型 ID' AFTER provider;
