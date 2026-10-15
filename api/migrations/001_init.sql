-- 001_init.sql — AI 对话面板初始表结构
-- 兼容 MySQL 5.7+ / 8.x、MariaDB 10.6+
-- 规则：只增不改；后续变更用 002_*.sql 追加。

CREATE DATABASE IF NOT EXISTS `aichat`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `aichat`;

-- 用户
CREATE TABLE IF NOT EXISTS `users` (
  `id` CHAR(36) NOT NULL,
  `username` VARCHAR(64) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL COMMENT 'scrypt 哈希',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_users_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 登录会话（存 token 的 sha256，不存原文）
CREATE TABLE IF NOT EXISTS `sessions` (
  `id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `token_hash` CHAR(64) NOT NULL,
  `expires_at` DATETIME NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_sessions_token_hash` (`token_hash`),
  KEY `idx_sessions_user` (`user_id`),
  CONSTRAINT `fk_sessions_user` FOREIGN KEY (`user_id`)
    REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 模型配置（Base URL / 模型名 / 参数 / 请求模式；Key 不存这里）
CREATE TABLE IF NOT EXISTS `model_configs` (
  `id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `base_url` VARCHAR(512) NOT NULL,
  `model` VARCHAR(128) NOT NULL,
  `temperature` DECIMAL(3,2) NULL,
  `max_tokens` INT NULL,
  `system_prompt` TEXT NULL,
  `request_mode` ENUM('direct','proxy') NOT NULL DEFAULT 'direct',
  `is_default` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_model_configs_user` (`user_id`, `updated_at`),
  CONSTRAINT `fk_model_configs_user` FOREIGN KEY (`user_id`)
    REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 服务端同步的 Key（AES-256-GCM 加密，需用户明确同意；列表接口永不返回原文）
CREATE TABLE IF NOT EXISTS `api_keys` (
  `id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `model_config_id` CHAR(36) NULL,
  `label` VARCHAR(100) NOT NULL,
  `base_url` VARCHAR(512) NOT NULL,
  `key_encrypted` BLOB NOT NULL COMMENT 'AES-256-GCM: nonce(12B)+ciphertext',
  `key_hint` VARCHAR(8) NOT NULL COMMENT '末4位脱敏展示',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_api_keys_user` (`user_id`),
  CONSTRAINT `fk_api_keys_user` FOREIGN KEY (`user_id`)
    REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_api_keys_config` FOREIGN KEY (`model_config_id`)
    REFERENCES `model_configs` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 会话
CREATE TABLE IF NOT EXISTS `conversations` (
  `id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `title` VARCHAR(200) NOT NULL DEFAULT '新会话',
  `model_config_id` CHAR(36) NULL,
  `request_mode` ENUM('direct','proxy') NOT NULL DEFAULT 'direct',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_conversations_user` (`user_id`, `updated_at` DESC),
  CONSTRAINT `fk_conversations_user` FOREIGN KEY (`user_id`)
    REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_conversations_config` FOREIGN KEY (`model_config_id`)
    REFERENCES `model_configs` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 聊天消息（id 自增，天然支持游标分页与时间排序）
CREATE TABLE IF NOT EXISTS `messages` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `conversation_id` CHAR(36) NOT NULL,
  `role` ENUM('user','assistant','system') NOT NULL,
  `content` MEDIUMTEXT NOT NULL,
  `tokens_in` INT NULL,
  `tokens_out` INT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_messages_conv` (`conversation_id`, `id`),
  KEY `idx_messages_conv_created` (`conversation_id`, `created_at`),
  CONSTRAINT `fk_messages_conversation` FOREIGN KEY (`conversation_id`)
    REFERENCES `conversations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 迁移记录
CREATE TABLE IF NOT EXISTS `schema_migrations` (
  `version` VARCHAR(64) NOT NULL,
  `applied_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO `schema_migrations` (`version`) VALUES ('001');
