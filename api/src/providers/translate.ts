// Provider 翻译层：标准内容段（OpenAI 风格）<-> 三家上游线路格式。
// 纯函数，便于单元测试；前后端共用同一规范（见 docs/API.md §8）。

export type ApiFormat = "openai" | "anthropic" | "gemini";

export type CanonicalPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface HistoryItem {
  role: "user" | "assistant" | "system";
  parts: CanonicalPart[];
}

/** DB 行 -> 标准内容段 */
export function parseCanonical(contentType: string, content: string): CanonicalPart[] {
  if (contentType === "parts") {
    const arr = JSON.parse(content) as CanonicalPart[];
    if (!Array.isArray(arr)) throw new Error("bad_parts");
    return arr;
  }
  return [{ type: "text", text: content }];
}

function parseDataUrl(url: string): { mime: string; b64: string } | null {
  const m = /^data:([^;,]+);base64,(.+)$/s.exec(url);
  return m ? { mime: m[1], b64: m[2] } : null;
}

function collapse(parts: CanonicalPart[]): CanonicalPart[] | string {
  // 纯文本单段时折叠为字符串，三家 API 都接受
  if (parts.length === 1 && parts[0].type === "text") return parts[0].text;
  return parts;
}

/** 标准内容段 -> 上游 parts */
export function toWireParts(format: ApiFormat, parts: CanonicalPart[]): any {
  const collapsed = collapse(parts);
  if (typeof collapsed === "string") return collapsed;
  return (collapsed as CanonicalPart[]).map((p) => {
    if (p.type === "text") {
      return format === "gemini" ? { text: p.text } : { type: "text", text: p.text };
    }
    const url = p.image_url.url;
    const data = parseDataUrl(url);
    if (format === "openai") return p;
    if (format === "anthropic") {
      return data
        ? { type: "image", source: { type: "base64", media_type: data.mime, data: data.b64 } }
        : { type: "image", source: { type: "url", url } };
    }
    // gemini
    if (!data) {
      throw new Error("gemini 原生线路不支持 http(s) 图片，请用 data: 内联或走 OpenAI 兼容中转");
    }
    return { inline_data: { mime_type: data.mime, data: data.b64 } };
  });
}

export interface ModelCfg {
  base_url: string;
  model: string;
  api_format: ApiFormat;
  temperature: number | null;
  max_tokens: number | null;
}

export interface UpstreamRequest {
  url: string;
  headers: Record<string, string>;
  body: any;
}

/**
 * 组装上游请求。base_url 约定不带路径后缀（见 API.md §8.2）。
 * stream=true 走各家的流式端点；anthropic/gemini 的 stream 参数在 body/路径上。
 */
export function buildUpstreamRequest(
  cfg: ModelCfg,
  apiKey: string,
  systemPrompt: string,
  history: HistoryItem[],
  stream: boolean
): UpstreamRequest {
  const base = cfg.base_url.replace(/\/+$/, "");
  const sysParts: CanonicalPart[] = systemPrompt ? [{ type: "text", text: systemPrompt }] : [];
  const msgs = history.filter((h) => h.role !== "system");
  const extraSystem = history.filter((h) => h.role === "system").flatMap((h) => h.parts);

  if (cfg.api_format === "openai") {
    const messages: any[] = [];
    const allSystem = [...sysParts, ...extraSystem];
    if (allSystem.length > 0) messages.push({ role: "system", content: toWireParts("openai", allSystem) });
    for (const h of msgs) messages.push({ role: h.role, content: toWireParts("openai", h.parts) });
    return {
      url: `${base}/chat/completions`,
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: {
        model: cfg.model,
        stream,
        messages,
        ...(cfg.temperature !== null ? { temperature: cfg.temperature } : {}),
        ...(cfg.max_tokens !== null ? { max_tokens: cfg.max_tokens } : {}),
        ...(stream ? { stream_options: { include_usage: true } } : {}),
      },
    };
  }

  if (cfg.api_format === "anthropic") {
    const sysText = [...sysParts, ...extraSystem]
      .filter((p) => p.type === "text")
      .map((p) => (p as { text: string }).text)
      .join("\n");
    const messages = msgs.map((h) => ({ role: h.role, content: toWireParts("anthropic", h.parts) }));
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
        ...(cfg.temperature !== null ? { temperature: cfg.temperature } : {}),
        messages,
        ...(stream ? { stream: true } : {}),
      },
    };
  }

  // gemini
  const contents = msgs.map((h) => ({
    role: h.role === "assistant" ? "model" : "user",
    parts: toWireParts("gemini", h.parts),
  }));
  const sysText = [...sysParts, ...extraSystem]
    .filter((p) => p.type === "text")
    .map((p) => (p as { text: string }).text)
    .join("\n");
  return {
    url: `${base}/v1beta/models/${encodeURIComponent(cfg.model)}:${stream ? "streamGenerateContent?alt=sse" : "generateContent"}`,
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: {
      ...(sysText ? { system_instruction: { parts: [{ text: sysText }] } } : {}),
      contents,
      generationConfig: {
        ...(cfg.temperature !== null ? { temperature: cfg.temperature } : {}),
        ...(cfg.max_tokens !== null ? { maxOutputTokens: cfg.max_tokens } : {}),
      },
    },
  };
}

// ---------- SSE 归一化：三家 -> OpenAI 风格事件 ----------

export type NormalizedEvent =
  | { kind: "text"; text: string }
  | { kind: "usage"; input: number; output: number }
  | { kind: "done" }
  | { kind: "error"; message: string };

/** 有状态解析器：逐行喂入，吐出归一化事件 */
export function createSseNormalizer(format: ApiFormat) {
  let pendingEvent = "";
  let anthropicInput = 0;

  function safeJson(line: string): any | null {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }

  return {
    pushLine(line: string): NormalizedEvent[] {
      const out: NormalizedEvent[] = [];
      if (line.startsWith("event:")) {
        pendingEvent = line.slice(6).trim();
        return out;
      }
      if (!line.startsWith("data:")) return out;
      const data = line.slice(5).trim();
      if (data === "[DONE]") {
        out.push({ kind: "done" });
        return out;
      }
      const json = safeJson(data);
      if (!json) return out;

      if (format === "openai") {
        const delta = json.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta) out.push({ kind: "text", text: delta });
        if (json.usage) {
          out.push({ kind: "usage", input: json.usage.prompt_tokens ?? 0, output: json.usage.completion_tokens ?? 0 });
        }
        if (json.choices?.[0]?.finish_reason) out.push({ kind: "done" });
      } else if (format === "anthropic") {
        if (pendingEvent === "message_start") {
          anthropicInput = json.message?.usage?.input_tokens ?? 0;
        } else if (pendingEvent === "content_block_delta") {
          const t = json.delta?.type === "text_delta" ? json.delta.text : null;
          if (typeof t === "string" && t) out.push({ kind: "text", text: t });
        } else if (pendingEvent === "message_delta") {
          out.push({ kind: "usage", input: anthropicInput, output: json.usage?.output_tokens ?? 0 });
        } else if (pendingEvent === "message_stop") {
          out.push({ kind: "done" });
        } else if (pendingEvent === "error") {
          out.push({ kind: "error", message: json.error?.message ?? "anthropic stream error" });
        }
        pendingEvent = "";
      } else {
        // gemini (alt=sse)：每 chunk 一个 JSON
        const parts = json.candidates?.[0]?.content?.parts;
        if (Array.isArray(parts)) {
          const text = parts.filter((p: any) => typeof p.text === "string").map((p: any) => p.text).join("");
          if (text) out.push({ kind: "text", text });
        }
        if (json.usageMetadata) {
          out.push({
            kind: "usage",
            input: json.usageMetadata.promptTokenCount ?? 0,
            output: json.usageMetadata.candidatesTokenCount ?? 0,
          });
        }
      }
      return out;
    },
  };
}

/** 非流式响应 -> 纯文本（用于标题生成等） */
export function extractText(format: ApiFormat, json: any): string {
  if (format === "openai") return json.choices?.[0]?.message?.content ?? "";
  if (format === "anthropic") {
    const blocks = json.content;
    if (Array.isArray(blocks)) return blocks.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    return "";
  }
  const parts = json.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) return parts.filter((p: any) => typeof p.text === "string").map((p: any) => p.text).join("");
  return "";
}

/** 归一化事件 -> 发往浏览器的 OpenAI 风格 SSE 行 */
export function toOpenAiSseLine(ev: NormalizedEvent): string | null {
  if (ev.kind === "text") {
    return `data: ${JSON.stringify({ choices: [{ delta: { content: ev.text } }] })}\n\n`;
  }
  if (ev.kind === "done") return "data: [DONE]\n\n";
  if (ev.kind === "error") {
    return `data: ${JSON.stringify({ error: { code: "upstream_error", message: ev.message } })}\n\n`;
  }
  return null; // usage 只落库，不下发
}
