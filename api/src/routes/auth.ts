import type { FastifyInstance, FastifyReply } from "fastify";
import type { RowDataPacket } from "mysql2/promise";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { createSession, deleteSession } from "../auth/tokens.js";
import { createRateLimiter } from "../auth/rateLimit.js";
import { requireUser } from "../auth/middleware.js";
import { uuid } from "../util/ids.js";
import type { Pool } from "../db/pool.js";

const authLimiter = createRateLimiter({ windowMs: 60_000, max: 10 });

export function badRequest(reply: FastifyReply, message: string) {
  return reply.status(400).send({ error: "bad_request", message });
}

export async function authRoutes(app: FastifyInstance) {
  const pool = app.pool;

  app.post("/register", async (req, reply) => {
    const body = (req.body ?? {}) as { username?: string; password?: string };
    const username = (body.username ?? "").trim();
    const password = body.password ?? "";
    if (!/^[A-Za-z0-9_\-\u4e00-\u9fa5]{3,64}$/.test(username)) {
      return badRequest(reply, "用户名需为 3–64 位字母/数字/下划线/中文");
    }
    if (password.length < 8) return badRequest(reply, "密码至少 8 位");
    if (!authLimiter.check(`reg:${req.ip}`)) {
      return reply.status(429).send({ error: "rate_limited", message: "操作过于频繁，请稍后再试" });
    }
    const [exists] = await pool.query<RowDataPacket[]>("SELECT id FROM users WHERE username = ?", [username]);
    if (exists.length > 0) {
      return reply.status(409).send({ error: "conflict", message: "用户名已存在" });
    }
    const id = uuid();
    await pool.query("INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)", [
      id,
      username,
      await hashPassword(password),
    ]);
    const token = await createSession(pool, id);
    return reply.status(201).send({ token, user: { id, username } });
  });

  app.post("/login", async (req, reply) => {
    if (!authLimiter.check(`login:${req.ip}`)) {
      return reply.status(429).send({ error: "rate_limited", message: "尝试过于频繁，请稍后再试" });
    }
    const body = (req.body ?? {}) as { username?: string; password?: string };
    const [rows] = await pool.query<RowDataPacket[]>("SELECT id, username, password_hash FROM users WHERE username = ?", [
      body.username ?? "",
    ]);
    if (rows.length === 0 || !(await verifyPassword(body.password ?? "", rows[0].password_hash as string))) {
      return reply.status(401).send({ error: "unauthorized", message: "用户名或密码错误" });
    }
    const token = await createSession(pool, rows[0].id as string);
    return reply.send({ token, user: { id: rows[0].id, username: rows[0].username } });
  });

  app.post("/logout", async (req, reply) => {
    const header = req.headers.authorization ?? "";
    const m = /^Bearer (.+)$/.exec(header);
    if (m) await deleteSession(pool, m[1]);
    return reply.status(204).send();
  });

  app.get("/me", async (req, reply) => {
    const user = requireUser(req);
    const [rows] = await pool.query<RowDataPacket[]>("SELECT id, username, created_at FROM users WHERE id = ?", [user.id]);
    if (rows.length === 0) return reply.status(404).send({ error: "not_found", message: "用户不存在" });
    return reply.send({ user: rows[0] });
  });
}
