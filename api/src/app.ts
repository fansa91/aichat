import Fastify, { type FastifyInstance } from "fastify";
import type { Pool } from "./db/pool.js";
import { createPool } from "./db/pool.js";
import type { AppConfig } from "./config.js";
import { authHook } from "./auth/middleware.js";
import { authRoutes } from "./routes/auth.js";
import { conversationRoutes } from "./routes/conversations.js";
import { messageRoutes } from "./routes/messages.js";
import { modelConfigRoutes } from "./routes/modelConfigs.js";
import { keyRoutes } from "./routes/keys.js";
import { chatRoutes } from "./routes/chat.js";
import { providersRoutes } from "./routes/providers.js";

declare module "fastify" {
  interface FastifyInstance {
    pool: Pool;
    appConfig: AppConfig;
  }
}

export async function buildApp(cfg: AppConfig): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      // 安全：Key 永不进日志。transient Key 走 X-Model-Api-Key 请求头；
      // /api/keys 的 api_key 字段同样脱敏。
      redact: {
        paths: ['req.headers["x-model-api-key"]', "req.body.api_key"],
        censor: "[REDACTED]",
      },
    },
  });
  const pool = createPool(cfg);
  app.decorate("pool", pool);
  app.decorate("appConfig", cfg);

  app.addHook("onRequest", authHook(pool));

  app.get("/api/health", async () => {
    try {
      await pool.query("SELECT 1");
      return { status: "ok", db: "ok", version: "0.1.0" };
    } catch {
      return { status: "ok", db: "error", version: "0.1.0" };
    }
  });

  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(conversationRoutes, { prefix: "/api/conversations" });
  await app.register(messageRoutes, { prefix: "/api" });
  await app.register(modelConfigRoutes, { prefix: "/api/model-configs" });
  await app.register(keyRoutes, { prefix: "/api/keys" });
  await app.register(chatRoutes, { prefix: "/api" });
  await app.register(providersRoutes, { prefix: "/api" });

  app.addHook("onClose", async () => {
    await pool.end();
  });

  return app;
}
