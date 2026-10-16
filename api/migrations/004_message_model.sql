-- 004: messages 增加 model 列（记录生成该消息的模型 ID），用于消息上展示模型与编辑重发。
ALTER TABLE `messages` ADD COLUMN `model` VARCHAR(255) NULL AFTER `content`;
