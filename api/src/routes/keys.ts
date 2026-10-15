// 服务端 Key 同步：仅用户明确同意（consent=true）才加密存储。
// 列表/创建响应永不返回 Key 原文；Key 只在代理请求瞬间解密使用。

import type { FastifyInstance } from "fastify";
import type { RowDataPacket } from "mysql2/promise";
import { requireUser } from "../auth/middleware.js";
import { badRequest } from "./auth.js";
import { uuid } from "../util/ids.js";
import { encryptKey, decryptKey, keyHint } from "../crypto/keybox.js";
import type { Pool } from "../db/pool.js";
import type { AppConfig } from "../config.js";

export async function keyRoutes(app: FastifyInstance) {
  const pool = app.pool;
  const cfg = app.appConfig;

  app.post("/", async (req, reply) => {
    const user = requireUser(req);
    const body = (req.body ?? {}) as {
      label?: string; model_config_id?: string; base_url?: string; api_key?: string; consent?: boolean;
    };
    if (body.consent !== true) {
      return reply.status(400).send({
        error: "bad_request",
        message: "需明确勾选同意，将 Key 加密同步到服务器（建议优先使用浏览器本地存储）",
      });
    }
    const label = (body.label ?? "").trim();
    const baseUrl = (body.base_url ?? "").trim().replace(/\/+$/, "");
    const apiKey = body.api_key ?? "";
    if (!label || label.length > 100) return badRequest(reply, "label 非法");
    if (!/^https?:\/\/.+/.test(baseUrl) || baseUrl.length > 512) return badRequest(reply, "base_url 非法");
    if (apiKey.length < 8 || apiKey.length > 4096) return badRequest(reply, "api_key 非法");
    if (!cfg.keyEncryptionKey) {
      return reply.status(500).send({ error: "server_misconfigured", message: "服务端未配置密钥加密，无法同步" });
    }
    let modelConfigId: string | null = null;
    if (body.model_config_id) {
      const [rows] = await pool.query<RowDataPacket[]>(
        "SELECT id FROM model_configs WHERE id = ? AND user_id = ?",
        [body.model_config_id, user.id]
      );
      if (rows.length === 0) return badRequest(reply, "模型配置不存在");
      modelConfigId = body.model_config_id;
    }
    const id = uuid();
    await pool.query(
      "INSERT INTO api_keys (id, user_id, model_config_id, label, base_url, key_encrypted, key_hint) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, user.id, modelConfigId, label, baseUrl, encryptKey(cfg.keyEncryptionKey, apiKey), keyHint(apiKey)]
    );
    return reply.status(201).send({
      id, label, base_url: baseUrl, key_hint: keyHint(apiKey),
      model_config_id: modelConfigId, created_at: new Date().toISOString(),
    });
  });

  app.get("/", async (req, reply) => {
    const user = requireUser(req);
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT id, label, base_url, key_hint, model_config_id, created_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC",
      [user.id]
    );
    return reply.send({ items: rows });
  });

  app.delete("/:id", async (req, reply) => {
    const user = requireUser(req);
    const id = (req.params as { id: string }).id;
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT id FROM api_keys WHERE id = ? AND user_id = ?",
      [id, user.id]
    );
    if (rows.length === 0) return reply.status(404).send({ error: "not_found", message: "Key 不存在" });
    await pool.query("DELETE FROM api_keys WHERE id = ?", [id]);
    return reply.status(204).send();
  });
}

/** 代理时解析服务端 Key：优先同 model_config 关联，其次同 base_url 最近一条。返回原文（仅请求内使用）。 */
export async function resolveServerKey(
  pool: Pool, cfg: AppConfig, userId: string, modelConfigId: string | null, baseUrl: string
): Promise<string | null> {
  if (!cfg.keyEncryptionKey) return null;
  let rows: RowDataPacket[];
  if (modelConfigId) {
    [rows] = await pool.query<RowDataPacket[]>(
      "SELECT key_encrypted FROM api_keys WHERE user_id = ? AND model_config_id = ? ORDER BY created_at DESC LIMIT 1",
      [userId, modelConfigId]
    );
    if (rows.length > 0) return decryptKey(cfg.keyEncryptionKey, rows[0].key_encrypted as Buffer);
  }
  [rows] = await pool.query<RowDataPacket[]>(
    "SELECT key_encrypted FROM api_keys WHERE user_id = ? AND base_url = ? ORDER BY created_at DESC LIMIT 1",
    [userId, baseUrl]
  );
  if (rows.length === 0) return null;
  return decryptKey(cfg.keyEncryptionKey, rows[0].key_encrypted as Buffer);
}
