// 模型列表中转：POST /api/providers/models
// 浏览器直调某些第三方 /models 会被 CORS 预检（OPTIONS 405）拦截，
// 此接口由后端服务端直调上游，绕开浏览器 CORS 限制。
// Key 优先级：请求头 X-Model-Api-Key（transient）> 按 base_url 匹配的服务端加密 Key。

import type { FastifyInstance, FastifyReply } from "fastify";
import { requireUser } from "../auth/middleware.js";
import { badRequest } from "./auth.js";
import { resolveServerKey } from "./keys.js";
import type { ApiFormat } from "../providers/translate.js";

const FORMATS: ApiFormat[] = ["openai", "anthropic", "gemini"];

function modelsUrl(format: ApiFormat, baseUrl: string): { url: string; headers: Record<string, string> } {
  const base = baseUrl.replace(/\/+$/, "");
  if (format === "openai") return { url: `${base}/models`, headers: {} };
  if (format === "anthropic") return { url: `${base}/v1/models`, headers: { "anthropic-version": "2023-06-01" } };
  return { url: `${base}/v1beta/models`, headers: {} };
}

function authHeaders(format: ApiFormat, apiKey: string): Record<string, string> {
  if (format === "openai") return { authorization: `Bearer ${apiKey}` };
  if (format === "anthropic") return { "x-api-key": apiKey };
  return { "x-goog-api-key": apiKey };
}

export function parseModelList(format: ApiFormat, json: any): string[] {
  if (format === "gemini") {
    const models = json.models ?? [];
    return models
      .map((m: { name?: string }) => (m.name ?? "").replace(/^models\//, ""))
      .filter((s: string) => s.length > 0);
  }
  const data = json.data ?? [];
  return data.map((m: { id?: string }) => m.id ?? "").filter((s: string) => s.length > 0);
}

export async function providersRoutes(app: FastifyInstance) {
  const pool = app.pool;
  const cfg = app.appConfig;

  app.post("/providers/models", async (req, reply: FastifyReply) => {
    const user = requireUser(req);
    const body = (req.body ?? {}) as { api_format?: string; base_url?: string };
    const format = body.api_format as ApiFormat;
    if (!FORMATS.includes(format)) return badRequest(reply, "api_format 非法");
    const baseUrl = typeof body.base_url === "string" ? body.base_url.trim().replace(/\/+$/, "") : "";
    if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) return badRequest(reply, "base_url 非法");

    const headerKey = req.headers["x-model-api-key"];
    const transientKey = Array.isArray(headerKey) ? headerKey[0] : headerKey;
    let apiKey: string | null = transientKey && transientKey.length >= 8 ? transientKey : null;
    if (!apiKey) {
      try {
        apiKey = await resolveServerKey(pool, cfg, user.id, null, baseUrl);
      } catch {
        return reply.status(500).send({ error: "server_misconfigured", message: "服务端 Key 解密失败" });
      }
    }
    if (!apiKey) {
      return reply.status(400).send({ error: "bad_request", message: "缺少 API Key" });
    }

    const { url, headers } = modelsUrl(format, baseUrl);
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { ...headers, ...authHeaders(format, apiKey) },
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e: any) {
      return reply.status(502).send({ error: "upstream_error", message: `上游连接失败：${e.message}` });
    }
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try { detail = await res.text().then((t) => t.slice(0, 200)); } catch { /* 忽略 */ }
      return reply.status(502).send({ error: "upstream_error", message: `上游返回异常：${detail}` });
    }
    let json: any;
    try {
      json = await res.json();
    } catch {
      return reply.status(502).send({ error: "upstream_error", message: "上游返回非 JSON" });
    }
    // 注意：apiKey 为局部变量，函数返回后即释放；从未写入 DB 或日志
    return reply.send({ models: parseModelList(format, json) });
  });
}
