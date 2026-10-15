import type { FastifyInstance } from "fastify";
import type { RowDataPacket } from "mysql2/promise";
import { requireUser } from "../auth/middleware.js";
import { badRequest } from "./auth.js";
import { uuid } from "../util/ids.js";
import type { Pool } from "../db/pool.js";
import type { ApiFormat } from "../providers/translate.js";

const FORMATS: ApiFormat[] = ["openai", "anthropic", "gemini"];

export interface ModelConfigRow extends RowDataPacket {
  id: string;
  user_id: string;
  name: string;
  base_url: string;
  model: string;
  api_format: ApiFormat;
  temperature: number | null;
  max_tokens: number | null;
  system_prompt: string | null;
  request_mode: "direct" | "proxy";
  is_default: number;
}

function sanitize(body: any) {
  const name = (body.name ?? "").trim();
  const baseUrl = (body.base_url ?? "").trim().replace(/\/+$/, "");
  const model = (body.model ?? "").trim();
  if (!name || name.length > 100) throw new Error("name 非法");
  if (!/^https?:\/\/.+/.test(baseUrl) || baseUrl.length > 512) throw new Error("base_url 非法");
  if (!model || model.length > 128) throw new Error("model 非法");
  const apiFormat: ApiFormat = FORMATS.includes(body.api_format) ? body.api_format : "openai";
  const temperature = body.temperature === null || body.temperature === undefined ? null : Number(body.temperature);
  if (temperature !== null && !(temperature >= 0 && temperature <= 2)) throw new Error("temperature 非法");
  const maxTokens = body.max_tokens === null || body.max_tokens === undefined ? null : parseInt(body.max_tokens, 10);
  if (maxTokens !== null && !(maxTokens > 0 && maxTokens <= 1000000)) throw new Error("max_tokens 非法");
  const requestMode = body.request_mode === "proxy" ? "proxy" : "direct";
  return {
    name, base_url: baseUrl, model, api_format: apiFormat, temperature, max_tokens: maxTokens,
    system_prompt: typeof body.system_prompt === "string" ? body.system_prompt : null,
    request_mode: requestMode, is_default: body.is_default === true ? 1 : 0,
  };
}

export async function modelConfigRoutes(app: FastifyInstance) {
  const pool = app.pool;

  app.get("/", async (req, reply) => {
    const user = requireUser(req);
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT * FROM model_configs WHERE user_id = ? ORDER BY updated_at DESC",
      [user.id]
    );
    return reply.send({ items: rows });
  });

  app.post("/", async (req, reply) => {
    const user = requireUser(req);
    let v;
    try {
      v = sanitize(req.body ?? {});
    } catch (e: any) {
      return badRequest(reply, e.message);
    }
    const id = uuid();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      if (v.is_default) {
        await conn.query("UPDATE model_configs SET is_default = 0 WHERE user_id = ?", [user.id]);
      }
      await conn.query(
        `INSERT INTO model_configs (id, user_id, name, base_url, model, api_format, temperature, max_tokens, system_prompt, request_mode, is_default)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, user.id, v.name, v.base_url, v.model, v.api_format, v.temperature, v.max_tokens, v.system_prompt, v.request_mode, v.is_default]
      );
      await conn.commit();
    } catch (e) {
      try { await conn.rollback(); } catch { /* 连接已断则忽略，保证抛出原始错误 */ }
      throw e;
    } finally {
      conn.release();
    }
    const [rows] = await pool.query<RowDataPacket[]>("SELECT * FROM model_configs WHERE id = ?", [id]);
    return reply.status(201).send(rows[0]);
  });

  app.patch("/:id", async (req, reply) => {
    const user = requireUser(req);
    const id = (req.params as { id: string }).id;
    const [exists] = await pool.query<RowDataPacket[]>(
      "SELECT id FROM model_configs WHERE id = ? AND user_id = ?",
      [id, user.id]
    );
    if (exists.length === 0) return reply.status(404).send({ error: "not_found", message: "模型配置不存在" });
    const body = (req.body ?? {}) as Record<string, any>;
    const sets: string[] = [];
    const vals: any[] = [];
    // PATCH 只允许部分字段；Key 永不出现在此接口
    for (const k of ["name", "base_url", "model", "temperature", "max_tokens", "system_prompt", "request_mode", "api_format"]) {
      if (body[k] !== undefined) {
        if (k === "api_format" && !FORMATS.includes(body[k])) return badRequest(reply, "api_format 非法");
        if (k === "request_mode" && !["direct", "proxy"].includes(body[k])) return badRequest(reply, "request_mode 非法");
        sets.push(`\`${k}\` = ?`);
        vals.push(k === "base_url" ? String(body[k]).trim().replace(/\/+$/, "") : body[k]);
      }
    }
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      if (body.is_default === true) {
        await conn.query("UPDATE model_configs SET is_default = 0 WHERE user_id = ?", [user.id]);
        sets.push("`is_default` = 1");
      } else if (body.is_default === false) {
        sets.push("`is_default` = 0");
      }
      if (sets.length > 0) {
        sets.push("`updated_at` = NOW()");
        await conn.query(`UPDATE model_configs SET ${sets.join(", ")} WHERE id = ?`, [...vals, id]);
      }
      await conn.commit();
    } catch (e) {
      try { await conn.rollback(); } catch { /* 连接已断则忽略，保证抛出原始错误 */ }
      throw e;
    } finally {
      conn.release();
    }
    const [rows] = await pool.query<RowDataPacket[]>("SELECT * FROM model_configs WHERE id = ?", [id]);
    return reply.send(rows[0]);
  });

  app.delete("/:id", async (req, reply) => {
    const user = requireUser(req);
    const id = (req.params as { id: string }).id;
    const [exists] = await pool.query<RowDataPacket[]>(
      "SELECT id FROM model_configs WHERE id = ? AND user_id = ?",
      [id, user.id]
    );
    if (exists.length === 0) return reply.status(404).send({ error: "not_found", message: "模型配置不存在" });
    await pool.query("DELETE FROM model_configs WHERE id = ?", [id]); // 会话 SET NULL，Key CASCADE
    return reply.status(204).send();
  });
}
