// 直连模式的模型客户端：浏览器直调三家上游 API。
// 规范与后端 src/providers/translate.ts 一致（见 docs/API.md §8），
// Key 只出现在发往上游的请求头里，永不进自家后端、不进 URL。

import type { ApiFormat, CanonicalPart, HistoryItem } from "./types";

export { type ApiFormat };

/** 直连调用参数（provider 中心配置拼装，不再依赖服务端的 ModelConfig） */
export interface DirectCallParams {
  api_format: ApiFormat;
  base_url: string;
  model: string;
  temperature?: number | null;
  max_tokens?: number | null;
}

interface WireRequest { url: string; headers: Record<string, string>; body: unknown; }

function parseDataUrl(url: string): { mime: string; b64: string } | null {
  const m = /^data:([^;,]+);base64,(.+)$/s.exec(url);
  return m ? { mime: m[1], b64: m[2] } : null;
}

function toWireParts(format: ApiFormat, parts: CanonicalPart[]): unknown {
  const collapsed = parts.length === 1 && parts[0].type === "text" ? parts[0].text : parts;
  if (typeof collapsed === "string") return collapsed;
  return (collapsed as CanonicalPart[]).map((p) => {
    if (p.type === "text") return format === "gemini" ? { text: p.text } : { type: "text", text: p.text };
    const url = p.image_url.url;
    const data = parseDataUrl(url);
    if (format === "openai") return p;
    if (format === "anthropic") {
      return data
        ? { type: "image", source: { type: "base64", media_type: data.mime, data: data.b64 } }
        : { type: "image", source: { type: "url", url } };
    }
    if (!data) throw new Error("gemini 原生线路不支持 http(s) 图片，请用 data: 内联或走 OpenAI 兼容中转");
    return { inline_data: { mime_type: data.mime, data: data.b64 } };
  });
}

function textOf(p: CanonicalPart): string {
  return p.type === "text" ? p.text : "";
}

export function buildDirectRequest(
  cfg: DirectCallParams, apiKey: string, systemPrompt: string,
  history: HistoryItem[], stream: boolean
): WireRequest {
  const base = cfg.base_url.replace(/\/+$/, "");
  const sysParts: CanonicalPart[] = systemPrompt ? [{ type: "text", text: systemPrompt }] : [];
  const msgs = history.filter((h) => h.role !== "system");
  const extraSystem = history.filter((h) => h.role === "system").flatMap((h) => h.parts);

  if (cfg.api_format === "openai") {
    const allSystem = [...sysParts, ...extraSystem];
    const messages: unknown[] = [];
    if (allSystem.length > 0) messages.push({ role: "system", content: toWireParts("openai", allSystem) });
    for (const h of msgs) messages.push({ role: h.role, content: toWireParts("openai", h.parts) });
    return {
      url: `${base}/chat/completions`,
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: {
        model: cfg.model, stream, messages,
        ...(cfg.temperature ? { temperature: cfg.temperature } : {}),
        ...(cfg.max_tokens !== null ? { max_tokens: cfg.max_tokens } : {}),
        ...(stream ? { stream_options: { include_usage: true } } : {}),
      },
    };
  }
  if (cfg.api_format === "anthropic") {
    const sysText = [...sysParts, ...extraSystem].map(textOf).join("\n");
    return {
      url: `${base}/v1/messages`,
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: {
        model: cfg.model,
        max_tokens: cfg.max_tokens ?? 4096,
        ...(sysText ? { system: sysText } : {}),
        ...(cfg.temperature ? { temperature: cfg.temperature } : {}),
        messages: msgs.map((h) => ({ role: h.role, content: toWireParts("anthropic", h.parts) })),
        ...(stream ? { stream: true } : {}),
      },
    };
  }
  // gemini
  const sysText = [...sysParts, ...extraSystem].map(textOf).join("\n");
  return {
    url: `${base}/v1beta/models/${encodeURIComponent(cfg.model)}:${stream ? "streamGenerateContent?alt=sse" : "generateContent"}`,
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: {
      ...(sysText ? { system_instruction: { parts: [{ text: sysText }] } } : {}),
      contents: msgs.map((h) => ({
        role: h.role === "assistant" ? "model" : "user",
        parts: toWireParts("gemini", h.parts),
      })),
      generationConfig: {
        ...(cfg.temperature ? { temperature: cfg.temperature } : {}),
        ...(cfg.max_tokens ? { maxOutputTokens: cfg.max_tokens } : {}),
      },
    },
  };
}

/** 拉取模型列表（浏览器直调上游，不经过自家后端） */
export async function listModels(format: ApiFormat, baseUrl: string, apiKey: string): Promise<string[]> {
  const base = baseUrl.replace(/\/+$/, "");
  let url: string;
  let headers: Record<string, string>;
  if (format === "openai") {
    url = `${base}/models`;
    headers = { authorization: `Bearer ${apiKey}` };
  } else if (format === "anthropic") {
    url = `${base}/v1/models`;
    headers = { "x-api-key": apiKey, "anthropic-version": "2023-06-01" };
  } else {
    url = `${base}/v1beta/models`;
    headers = { "x-goog-api-key": apiKey };
  }
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`拉取失败（HTTP ${res.status}）：${t.slice(0, 200)}`);
  }
  const json = await res.json();
  if (format === "gemini") {
    const models = json.models ?? [];
    return models
      .map((m: { name?: string }) => (m.name ?? "").replace(/^models\//, ""))
      .filter((s: string) => s.length > 0);
  }
  const data = json.data ?? [];
  return data.map((m: { id?: string }) => m.id ?? "").filter((s: string) => s.length > 0);
}

export interface StreamEvents {
  onText: (t: string) => void;
  onUsage?: (input: number | null, output: number | null) => void;
  signal?: AbortSignal;
}

/**
 * 直连流式对话。按 api_format 解析 SSE，回调吐纯文本增量。
 * 返回 { text, usage } 汇总。
 */
export async function streamDirect(
  cfg: DirectCallParams, apiKey: string, systemPrompt: string,
  history: HistoryItem[], ev: StreamEvents
): Promise<{ text: string; input: number | null; output: number | null }> {
  const req = buildDirectRequest(cfg, apiKey, systemPrompt, history, true);
  const res = await fetch(req.url, {
    method: "POST",
    headers: req.headers,
    body: JSON.stringify(req.body),
    signal: ev.signal,
  });
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => "");
    throw new Error(`上游返回异常（HTTP ${res.status}）：${t.slice(0, 300)}`);
  }
  let text = "";
  let input: number | null = null;
  let output: number | null = null;
  const decoder = new TextDecoder();
  let buf = "";
  let pendingEvent = "";
  let anthropicInput = 0;

  const handleLine = (line: string) => {
    if (cfg.api_format === "anthropic" && line.startsWith("event:")) {
      pendingEvent = line.slice(6).trim();
      return;
    }
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (data === "[DONE]") return;
    let json: any;
    try { json = JSON.parse(data); } catch { return; }
    if (cfg.api_format === "openai") {
      const delta = json.choices?.[0]?.delta?.content;
      if (typeof delta === "string" && delta) { text += delta; ev.onText(delta); }
      if (json.usage) { input = json.usage.prompt_tokens ?? 0; output = json.usage.completion_tokens ?? 0; ev.onUsage?.(input, output); }
    } else if (cfg.api_format === "anthropic") {
      if (pendingEvent === "message_start") anthropicInput = json.message?.usage?.input_tokens ?? 0;
      else if (pendingEvent === "content_block_delta") {
        const t = json.delta?.type === "text_delta" ? json.delta.text : null;
        if (typeof t === "string" && t) { text += t; ev.onText(t); }
      } else if (pendingEvent === "message_delta") {
        input = anthropicInput; output = json.usage?.output_tokens ?? 0; ev.onUsage?.(input, output);
      }
      pendingEvent = "";
    } else {
      const parts = json.candidates?.[0]?.content?.parts;
      if (Array.isArray(parts)) {
        const t = parts.filter((p: any) => typeof p.text === "string").map((p: any) => p.text).join("");
        if (t) { text += t; ev.onText(t); }
      }
      if (json.usageMetadata) {
        input = json.usageMetadata.promptTokenCount ?? 0;
        output = json.usageMetadata.candidatesTokenCount ?? 0;
        ev.onUsage?.(input, output);
      }
    }
  };

  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) handleLine(line.trimEnd());
  }
  if (buf.trim()) handleLine(buf.trim());
  return { text, input, output };
}

/** 直连非流式补全（用于标题生成等） */
export async function completeDirect(
  cfg: DirectCallParams, apiKey: string, systemPrompt: string, userText: string
): Promise<string> {
  const req = buildDirectRequest(
    cfg, apiKey, systemPrompt, [{ role: "user", parts: [{ type: "text", text: userText }] }], false
  );
  const res = await fetch(req.url, { method: "POST", headers: req.headers, body: JSON.stringify(req.body) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (cfg.api_format === "openai") return json.choices?.[0]?.message?.content ?? "";
  if (cfg.api_format === "anthropic") {
    const blocks = json.content;
    return Array.isArray(blocks) ? blocks.filter((b: any) => b.type === "text").map((b: any) => b.text).join("") : "";
  }
  const parts = json.candidates?.[0]?.content?.parts;
  return Array.isArray(parts) ? parts.filter((p: any) => typeof p.text === "string").map((p: any) => p.text).join("") : "";
}

/** 解析后端代理归一化后的 SSE（OpenAI 风格） */
export async function streamProxied(
  res: Response, ev: StreamEvents
): Promise<{ text: string }> {
  if (!res.ok || !res.body) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.message ?? `HTTP ${res.status}`);
  }
  let text = "";
  const decoder = new TextDecoder();
  let buf = "";
  const handleLine = (line: string) => {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (data === "[DONE]") return;
    try {
      const json = JSON.parse(data);
      if (json.error) throw new Error(json.error.message ?? "upstream_error");
      const delta = json.choices?.[0]?.delta?.content;
      if (typeof delta === "string" && delta) { text += delta; ev.onText(delta); }
    } catch (e) {
      if (e instanceof Error && e.message !== "upstream_error") return;
      throw e;
    }
  };
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) handleLine(line.trimEnd());
    if (ev.signal?.aborted) break;
  }
  if (buf.trim()) handleLine(buf.trim());
  return { text };
}
