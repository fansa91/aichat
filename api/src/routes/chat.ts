// 代理模式：POST /api/conversations/:id/chat -> 上游模型 API（SSE 归一化透传）。
// Key 优先级：请求头 X-Model-Api-Key（transient，用完即弃）> 服务端加密 Key。
// Key 永不落库、永不进日志（见 app.ts 的 logger redact）。

import type { FastifyInstance, FastifyReply } from "fastify";
import type { RowDataPacket } from "mysql2/promise";
import { requireUser } from "../auth/middleware.js";
import { badRequest } from "./auth.js";
import { resolveServerKey } from "./keys.js";
import type { Pool } from "../db/pool.js";
import type { AppConfig } from "../config.js";
import {
  buildUpstreamRequest, createSseNormalizer, extractText, parseCanonical,
  toOpenAiSseLine,
} from "../providers/translate.js";
import type { ApiFormat, HistoryItem, ModelCfg } from "../providers/translate.js";
import { trackBackground } from "../services/background.js";

const HISTORY_LIMIT = 50;

async function getModelConfig(pool: Pool, userId: string, conversationId: string): Promise<(ModelCfg & { id: string }) | null> {
  const [crows] = await pool.query<RowDataPacket[]>(
    "SELECT model_config_id FROM conversations WHERE id = ? AND user_id = ?",
    [conversationId, userId]
  );
  if (crows.length === 0) return null;
  const cfgId = crows[0].model_config_id as string | null;
  let rows: RowDataPacket[];
  if (cfgId) {
    [rows] = await pool.query<RowDataPacket[]>(
      "SELECT * FROM model_configs WHERE id = ? AND user_id = ?",
      [cfgId, userId]
    );
  } else {
    [rows] = await pool.query<RowDataPacket[]>(
      "SELECT * FROM model_configs WHERE user_id = ? AND is_default = 1 LIMIT 1",
      [userId]
    );
  }
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id, base_url: r.base_url, model: r.model, api_format: r.api_format as ApiFormat,
    temperature: r.temperature, max_tokens: r.max_tokens,
  };
}

async function loadHistory(pool: Pool, conversationId: string): Promise<HistoryItem[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT role, content_type, content FROM messages WHERE conversation_id = ?
     ORDER BY id DESC LIMIT ?`,
    [conversationId, HISTORY_LIMIT]
  );
  return (rows as RowDataPacket[]).reverse().map((r) => ({
    role: r.role as HistoryItem["role"],
    parts: parseCanonical(r.content_type as string, r.content as string),
  }));
}

async function persistAssistant(
  pool: Pool, conversationId: string, content: string,
  tokensIn: number | null, tokensOut: number | null, model: string | null
): Promise<number> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [r] = await conn.query<any>(
      "INSERT INTO messages (conversation_id, role, content_type, content, model, tokens_in, tokens_out) VALUES (?, 'assistant', 'text', ?, ?, ?, ?)",
      [conversationId, content, model, tokensIn, tokensOut]
    );
    await conn.query("UPDATE conversations SET updated_at = NOW() WHERE id = ?", [conversationId]);
    await conn.commit();
    const [nrows] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?",
      [conversationId]
    );
    return nrows[0].n as number;
  } catch (e) {
    try { await conn.rollback(); } catch { /* 连接已断则忽略，保证抛出原始错误 */ }
    throw e;
  } finally {
    conn.release();
  }
}

/** 首轮对话标题自动生成（fire-and-forget，不阻塞流式响应） */
async function maybeGenerateTitle(
  pool: Pool, cfg: AppConfig, userId: string, conversationId: string,
  modelCfg: ModelCfg, apiKey: string, messageCount: number
) {
  try {
    if (messageCount !== 2) return; // 仅首轮（1 问 1 答）触发
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT title FROM conversations WHERE id = ? AND user_id = ?",
      [conversationId, userId]
    );
    if (rows.length === 0 || rows[0].title !== "新会话") return;
    const history = await loadHistory(pool, conversationId);
    const summary = history
      .map((h) => h.parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join(""))
      .join("\n")
      .slice(0, 2000);
    const req = buildUpstreamRequest(
      modelCfg, apiKey, "你是一个标题生成器。",
      [{ role: "user", parts: [{ type: "text", text: `用不超过20个字为以下对话生成一个简短标题，只返回标题本身，不要引号和标点前缀：\n\n${summary}` }] }],
      false
    );
    const res = await fetch(req.url, {
      method: "POST",
      headers: req.headers,
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return;
    const text = extractText(modelCfg.api_format, await res.json()).trim().slice(0, 60);
    if (!text) return;
    await pool.query(
      "UPDATE conversations SET title = ?, updated_at = NOW() WHERE id = ? AND title = '新会话'",
      [text, conversationId]
    );
  } catch {
    // 标题生成失败不影响主流程
  }
}

export async function chatRoutes(app: FastifyInstance) {
  const pool = app.pool;
  const cfg = app.appConfig;

  app.post("/conversations/:id/chat", async (req, reply: FastifyReply) => {
    const user = requireUser(req);
    const conversationId = (req.params as { id: string }).id;
    const [crows] = await pool.query<RowDataPacket[]>(
      "SELECT id FROM conversations WHERE id = ? AND user_id = ?",
      [conversationId, user.id]
    );
    if (crows.length === 0) return reply.status(404).send({ error: "not_found", message: "会话不存在" });

    const body = (req.body ?? {}) as {
      content?: string; content_type?: string;
      // LobeChat 风格 provider 直传（新）：三者齐全时跳过 model_configs 查表
      api_format?: string; base_url?: string; model?: string; system_prompt?: string;
    };
    if (typeof body.content !== "string" || body.content.length === 0) {
      return badRequest(reply, "content 不能为空");
    }
    const contentType = body.content_type === "parts" ? "parts" : "text";
    if (contentType === "parts") {
      try {
        if (!Array.isArray(JSON.parse(body.content))) throw new Error();
      } catch {
        return badRequest(reply, "content_type=parts 时 content 须为内容段数组 JSON");
      }
    }

    // 模型配置：优先用请求体直传的 provider 参数，否则回退旧的 model_configs 查表
    let modelCfg: ModelCfg & { id: string | null };
    let systemPrompt = "";
    const direct = body.api_format && body.base_url && body.model
      && ["openai", "anthropic", "gemini"].includes(body.api_format);
    if (direct) {
      modelCfg = {
        id: null,
        base_url: (body.base_url as string).replace(/\/+$/, ""),
        model: body.model as string,
        api_format: body.api_format as ApiFormat,
        temperature: null,
        max_tokens: null,
      };
      systemPrompt = typeof body.system_prompt === "string" ? body.system_prompt : "";
    } else {
      const legacy = await getModelConfig(pool, user.id, conversationId);
      if (!legacy) {
        return reply.status(400).send({ error: "bad_request", message: "未选择模型配置" });
      }
      modelCfg = legacy;
      const [cfgRows] = await pool.query<RowDataPacket[]>(
        "SELECT system_prompt FROM model_configs WHERE id = ?",
        [modelCfg.id]
      );
      systemPrompt = (cfgRows[0]?.system_prompt as string) ?? "";
    }

    // Key：请求头 transient 优先，其次服务端加密 Key；全程不落库、不记日志
    const headerKey = req.headers["x-model-api-key"];
    const transientKey = Array.isArray(headerKey) ? headerKey[0] : headerKey;
    let apiKey: string | null = transientKey && transientKey.length >= 8 ? transientKey : null;
    if (!apiKey) {
      try {
        apiKey = await resolveServerKey(pool, cfg, user.id, modelCfg.id, modelCfg.base_url);
      } catch {
        return reply.status(500).send({ error: "server_misconfigured", message: "服务端 Key 解密失败" });
      }
    }
    if (!apiKey) {
      return reply.status(400).send({ error: "bad_request", message: "缺少 API Key" });
    }

    // 先落库用户消息
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(
        "INSERT INTO messages (conversation_id, role, content_type, content) VALUES (?, 'user', ?, ?)",
        [conversationId, contentType, body.content]
      );
      await conn.query("UPDATE conversations SET updated_at = NOW() WHERE id = ?", [conversationId]);
      await conn.commit();
    } catch (e) {
      try { await conn.rollback(); } catch { /* 连接已断则忽略，保证抛出原始错误 */ }
      throw e;
    } finally {
      conn.release();
    }

    const history = await loadHistory(pool, conversationId);
    let upstream: ReturnType<typeof buildUpstreamRequest>;
    try {
      upstream = buildUpstreamRequest(
        modelCfg, apiKey, systemPrompt, history, true
      );
    } catch (e: any) {
      return reply.status(400).send({ error: "bad_request", message: e.message });
    }

    let res: Response;
    try {
      res = await fetch(upstream.url, {
        method: "POST",
        headers: upstream.headers,
        body: JSON.stringify(upstream.body),
        signal: AbortSignal.timeout(300_000),
      });
    } catch (e: any) {
      return reply.status(502).send({ error: "upstream_error", message: `上游连接失败：${e.message}` });
    }
    if (!res.ok || !res.body) {
      let detail = `HTTP ${res.status}`;
      try {
        const j: any = await res.json();
        detail = j.error?.message ?? j.message ?? detail;
      } catch { /* 忽略解析失败 */ }
      // 注意：此处不记录 apiKey，只记状态与脱敏后的错误
      req.log.warn({ upstreamStatus: res.status }, "upstream chat failed");
      return reply.status(502).send({ error: "upstream_error", message: `上游返回异常：${String(detail).slice(0, 300)}` });
    }

    // SSE 归一化透传
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });

    const normalizer = createSseNormalizer(modelCfg.api_format);
    let assistantText = "";
    let tokensIn: number | null = null;
    let tokensOut: number | null = null;
    let streamError: string | null = null;
    const decoder = new TextDecoder();
    let buf = "";
    try {
      for await (const chunk of res.body as any) {
        buf += decoder.decode(chunk, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          for (const ev of normalizer.pushLine(line.trimEnd())) {
            if (ev.kind === "text") assistantText += ev.text;
            else if (ev.kind === "usage") { tokensIn = ev.input; tokensOut = ev.output; }
            else if (ev.kind === "error") streamError = ev.message;
            const sse = toOpenAiSseLine(ev);
            if (sse) raw.write(sse);
            if (ev.kind === "done") break;
          }
        }
      }
      // 处理残余行
      if (buf.trim()) {
        for (const ev of normalizer.pushLine(buf.trim())) {
          if (ev.kind === "text") assistantText += ev.text;
          const sse = toOpenAiSseLine(ev);
          if (sse) raw.write(sse);
        }
      }
      if (streamError) {
        raw.write(`data: ${JSON.stringify({ error: { code: "upstream_error", message: streamError } })}\n\n`);
      } else {
        raw.write("data: [DONE]\n\n");
      }
    } catch (e: any) {
      req.log.warn({ err: e.message }, "proxy stream interrupted");
      raw.write(`data: ${JSON.stringify({ error: { code: "upstream_error", message: "流式传输中断" } })}\n\n`);
    } finally {
      raw.end();
    }

    // 落库助手回复（即使流中断也保存已收到的部分）
    try {
      const count = await persistAssistant(pool, conversationId, assistantText, tokensIn, tokensOut, modelCfg.model);
      // 首轮标题自动生成（异步，不阻塞；测试可用 drainBackground 等待收敛）
      trackBackground(maybeGenerateTitle(pool, cfg, user.id, conversationId, modelCfg, apiKey, count));
    } catch (e: any) {
      req.log.error({ err: e.message, stack: e.stack }, "persist assistant message failed");
    }
    // 注意：apiKey 为局部变量，函数返回后即释放；从未写入 DB 或日志
  });
}
