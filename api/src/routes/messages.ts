import type { FastifyInstance } from "fastify";
import type { RowDataPacket } from "mysql2/promise";
import { requireUser } from "../auth/middleware.js";
import { badRequest } from "./auth.js";
import type { Pool } from "../db/pool.js";

const ROLES = new Set(["user", "assistant", "system"]);

export async function messageRoutes(app: FastifyInstance) {
  const pool = app.pool;

  async function ownedConversation(conversationId: string, userId: string): Promise<boolean> {
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT id FROM conversations WHERE id = ? AND user_id = ?",
      [conversationId, userId]
    );
    return rows.length > 0;
  }

  // 按会话查询 + 游标分页 + 时间排序：取 id < before_id 的最近 limit 条，按 id ASC 返回
  app.get("/conversations/:id/messages", async (req, reply) => {
    const user = requireUser(req);
    const id = (req.params as { id: string }).id;
    if (!(await ownedConversation(id, user.id))) {
      return reply.status(404).send({ error: "not_found", message: "会话不存在" });
    }
    const q = req.query as { limit?: string; before_id?: string };
    const limit = Math.min(200, Math.max(1, parseInt(q.limit ?? "50", 10) || 50));
    const beforeId = q.before_id ? parseInt(q.before_id, 10) : null;
    if (q.before_id && !Number.isSafeInteger(beforeId)) return badRequest(reply, "before_id 非法");
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, role, content_type, content, tokens_in, tokens_out, created_at FROM messages
       WHERE conversation_id = ? AND (? IS NULL OR id < ?) ORDER BY id DESC LIMIT ?`,
      [id, beforeId, beforeId, limit]
    );
    const items = (rows as RowDataPacket[]).reverse();
    return reply.send({ items, has_more: rows.length === limit });
  });

  // 直连模式落库：前端流式结束后分别写入用户/助手消息（不经过本接口传 Key）
  app.post("/conversations/:id/messages", async (req, reply) => {
    const user = requireUser(req);
    const id = (req.params as { id: string }).id;
    if (!(await ownedConversation(id, user.id))) {
      return reply.status(404).send({ error: "not_found", message: "会话不存在" });
    }
    const body = (req.body ?? {}) as { role?: string; content?: string; content_type?: string };
    if (!ROLES.has(body.role ?? "")) return badRequest(reply, "role 非法");
    if (typeof body.content !== "string" || body.content.length === 0) return badRequest(reply, "content 不能为空");
    const contentType = body.content_type === "parts" ? "parts" : "text";
    if (contentType === "parts") {
      try {
        const arr = JSON.parse(body.content);
        if (!Array.isArray(arr)) throw new Error();
      } catch {
        return badRequest(reply, "content_type=parts 时 content 须为内容段数组 JSON");
      }
    }
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [r] = await conn.query<any>(
        "INSERT INTO messages (conversation_id, role, content_type, content) VALUES (?, ?, ?, ?)",
        [id, body.role, contentType, body.content]
      );
      await conn.query("UPDATE conversations SET updated_at = NOW() WHERE id = ?", [id]);
      await conn.commit();
      const [rows] = await conn.query<RowDataPacket[]>(
        "SELECT id, role, content_type, content, tokens_in, tokens_out, created_at FROM messages WHERE id = ?",
        [r.insertId]
      );
      return reply.status(201).send(rows[0]);
    } catch (e) {
      try { await conn.rollback(); } catch { /* 连接已断则忽略，保证抛出原始错误 */ }
      throw e;
    } finally {
      conn.release();
    }
  });
}
