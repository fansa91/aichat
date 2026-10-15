import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { runMigrations } from "../src/db/migrate.js";
import { drainBackground } from "../src/services/background.js";
import type { AppConfig } from "../src/config.js";

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 0,
    db: { host: "127.0.0.1", port: 3306, user: "aichat_test", password: "testpass", name: "aichat_test" },
    keyEncryptionKey: Buffer.alloc(32, 7).toString("hex"),
    corsOrigin: null,
    ...overrides,
  };
}

export async function setupApp(cfg?: AppConfig): Promise<FastifyInstance> {
  const c = cfg ?? testConfig();
  await runMigrations(c);
  return buildApp(c);
}

export async function teardownApp(app: FastifyInstance) {
  await app.close();
}

/** 清空业务表（保留 schema_migrations），保证用例隔离；先等待后台任务收敛 */
export async function cleanDb(app: FastifyInstance) {
  await drainBackground();
  await app.pool.query("SET FOREIGN_KEY_CHECKS=0");
  for (const t of ["messages", "conversations", "api_keys", "model_configs", "sessions", "users"]) {
    await app.pool.query(`TRUNCATE TABLE \`${t}\``);
  }
  await app.pool.query("SET FOREIGN_KEY_CHECKS=1");
}

export async function registerUser(app: FastifyInstance, username: string, password = "password123") {
  const res = await app.inject({ method: "POST", url: "/api/auth/register", payload: { username, password } });
  if (res.statusCode !== 201) throw new Error(`register failed: ${res.statusCode} ${res.body}`);
  return res.json() as { token: string; user: { id: string; username: string } };
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

export async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** 轮询直到条件成立（用于标题自动生成等异步副作用） */
export async function pollFor(fn: () => Promise<boolean>, timeoutMs = 8000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return true;
    await sleep(200);
  }
  return false;
}
