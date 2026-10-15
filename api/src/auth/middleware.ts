import type { FastifyRequest, FastifyReply } from "fastify";
import { findSessionUser } from "./tokens.js";
import type { Pool } from "../db/pool.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: { id: string; username: string };
  }
}

const PUBLIC = new Set(["/api/health", "/api/auth/register", "/api/auth/login"]);

/** 全局 onRequest 鉴权：公开路径放行，其余要求 Bearer Token */
export function authHook(pool: Pool) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (PUBLIC.has(req.url.split("?")[0])) return;
    const header = req.headers.authorization ?? "";
    const m = /^Bearer (.+)$/.exec(header);
    if (!m) {
      return reply.status(401).send({ error: "unauthorized", message: "缺少或无效的认证信息" });
    }
    const user = await findSessionUser(pool, m[1]);
    if (!user) {
      return reply.status(401).send({ error: "unauthorized", message: "登录已过期，请重新登录" });
    }
    req.user = user;
  };
}

export function requireUser(req: FastifyRequest) {
  if (!req.user) throw new Error("auth hook misconfigured");
  return req.user;
}
