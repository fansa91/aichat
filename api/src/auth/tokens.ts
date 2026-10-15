// 不透明 Bearer Token：原文只返回给客户端一次，库里存 sha256。
// sessions.expires_at 默认 90 天。

import { createHash, randomBytes } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import type { Pool } from "../db/pool.js";
import { uuid } from "../util/ids.js";

export const SESSION_TTL_DAYS = 90;

export function newToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(pool: Pool, userId: string): Promise<string> {
  const token = newToken();
  await pool.query(
    "INSERT INTO `sessions` (`id`, `user_id`, `token_hash`, `expires_at`) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? DAY))",
    [uuid(), userId, hashToken(token), SESSION_TTL_DAYS]
  );
  return token;
}

export interface SessionUser { id: string; username: string }

export async function findSessionUser(pool: Pool, token: string): Promise<SessionUser | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > NOW()`,
    [hashToken(token)]
  );
  if (rows.length === 0) return null;
  return { id: rows[0].id as string, username: rows[0].username as string };
}

export async function deleteSession(pool: Pool, token: string): Promise<void> {
  await pool.query("DELETE FROM `sessions` WHERE `token_hash` = ?", [hashToken(token)]);
}
