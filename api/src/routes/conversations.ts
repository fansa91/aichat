import type { FastifyInstance } from "fastify";
import type { RowDataPacket } from "mysql2/promise";
import { requireUser } from "../auth/middleware.js";
import { badRequest } from "./auth.js";
import { uuid } from "../util/ids.js";
import type { Pool } from "../db/pool.js";

export async function conversationRoutes(app: FastifyInstance) {
  const pool = app.pool;

  async function owned(conversationId: string, userId: string) {
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT * FROM conversations WHERE id = ? AND user_id = ?",
      [conversationId, userId]
    );
    return rows[0] as RowDataPacket | undefined;
  }

  app.get("/", async (req, reply) => {
    const user = requireUser(req);
    const q = req.query as { page?: string; per_page?: string };
    const page = Math.max(1, parseInt(q.page ?? "1", 10) || 1);
    const perPage = Math.min(100, Math.max(1, parseInt(q.per_page ?? "20", 10) || 20));
    const offset = (page - 1) * perPage;
    const [items] = await pool.query<RowDataPacket[]>(
      `SELECT c.*, (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
       FROM conversations c WHERE c.user_id = ? ORDER BY c.updated_at DESC LIMIT ? OFFSET ?`,
      [user.id, perPage, offset]
    );
    const [total] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM conversations WHERE user_id = ?",
      [user.id]
    );
    return reply.send({ items, page, per_page: perPage, total: total[0].total });
  });

  app.post("/", async (req, reply) => {
    const user = requireUser(req);
    const body = (req.body ?? {}) as { title?: string; model_config_id?: string; request_mode?: string };
    const requestMode = body.request_mode === "proxy" ? "proxy" : "direct";
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
    const title = (body.title ?? "").trim() || "新会话";
    await pool.query(
      "INSERT INTO conversations (id, user_id, title, model_config_id, request_mode) VALUES (?, ?, ?, ?, ?)",
      [id, user.id, title.slice(0, 200), modelConfigId, requestMode]
    );
    const [rows] = await pool.query<RowDataPacket[]>("SELECT *, 0 AS message_count FROM conversations WHERE id = ?", [id]);
    return reply.status(201).send(rows[0]);
  });

  app.get("/:id", async (req, reply) => {
    const user = requireUser(req);
    const conv = await owned((req.params as { id: string }).id, user.id);
    if (!conv) return reply.status(404).send({ error: "not_found", message: "会话不存在" });
    return reply.send(conv);
  });

  app.patch("/:id", async (req, reply) => {
    const user = requireUser(req);
    const id = (req.params as { id: string }).id;
    if (!(await owned(id, user.id))) return reply.status(404).send({ error: "not_found", message: "会话不存在" });
    const body = (req.body ?? {}) as { title?: string };
    const title = (body.title ?? "").trim();
    if (!title) return badRequest(reply, "标题不能为空");
    await pool.query("UPDATE conversations SET title = ?, updated_at = NOW() WHERE id = ?", [title.slice(0, 200), id]);
    const [rows] = await pool.query<RowDataPacket[]>("SELECT * FROM conversations WHERE id = ?", [id]);
    return reply.send(rows[0]);
  });

  app.delete("/:id", async (req, reply) => {
    const user = requireUser(req);
    const id = (req.params as { id: string }).id;
    if (!(await owned(id, user.id))) return reply.status(404).send({ error: "not_found", message: "会话不存在" });
    await pool.query("DELETE FROM conversations WHERE id = ?", [id]); // 消息 CASCADE
    return reply.status(204).send();
  });
}
