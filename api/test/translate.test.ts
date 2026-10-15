import test from "node:test";
import assert from "node:assert/strict";
import {
  buildUpstreamRequest, createSseNormalizer, extractText, parseCanonical,
  toOpenAiSseLine, toWireParts,
} from "../src/providers/translate.js";

const IMG_DATA = "data:image/jpeg;base64,/9j/abc";
const parts = [
  { type: "text", text: "看图" },
  { type: "image_url", image_url: { url: IMG_DATA } },
  { type: "image_url", image_url: { url: "https://example.com/a.png" } },
] as any;

test("parseCanonical: text 折叠为单 text 段", () => {
  assert.deepEqual(parseCanonical("text", "hello"), [{ type: "text", text: "hello" }]);
});

test("parseCanonical: parts 解析 JSON 数组", () => {
  assert.deepEqual(parseCanonical("parts", JSON.stringify(parts)), parts);
});

test("toWireParts: openai 原样透传", () => {
  assert.deepEqual(toWireParts("openai", parts), parts);
});

test("toWireParts: 纯文本折叠为字符串", () => {
  assert.equal(toWireParts("openai", [{ type: "text", text: "hi" }]), "hi");
  assert.equal(toWireParts("anthropic", [{ type: "text", text: "hi" }]), "hi");
  assert.equal(toWireParts("gemini", [{ type: "text", text: "hi" }]), "hi");
});

test("toWireParts: anthropic 图片映射", () => {
  const w = toWireParts("anthropic", parts) as any[];
  assert.equal(w[0].type, "text");
  assert.deepEqual(w[1], { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "/9j/abc" } });
  assert.deepEqual(w[2], { type: "image", source: { type: "url", url: "https://example.com/a.png" } });
});

test("toWireParts: gemini 图片映射与 http 限制", () => {
  const w = toWireParts("gemini", parts.slice(0, 2)) as any[];
  assert.deepEqual(w[0], { text: "看图" });
  assert.deepEqual(w[1], { inline_data: { mime_type: "image/jpeg", data: "/9j/abc" } });
  assert.throws(() => toWireParts("gemini", parts), /gemini 原生线路不支持 http/);
});

test("buildUpstreamRequest: openai", () => {
  const r = buildUpstreamRequest(
    { base_url: "https://api.example.com/v1/", model: "gpt-4o", api_format: "openai", temperature: 0.7, max_tokens: null },
    "sk-x", "sys", [{ role: "user", parts: [{ type: "text", text: "hi" }] }], true
  );
  assert.equal(r.url, "https://api.example.com/v1/chat/completions");
  assert.equal(r.headers.authorization, "Bearer sk-x");
  assert.equal(r.body.model, "gpt-4o");
  assert.equal(r.body.stream, true);
  assert.deepEqual(r.body.messages[0], { role: "system", content: "sys" });
  assert.deepEqual(r.body.messages[1], { role: "user", content: "hi" });
  assert.equal(r.body.temperature, 0.7);
  assert.deepEqual(r.body.stream_options, { include_usage: true });
});

test("buildUpstreamRequest: anthropic", () => {
  const r = buildUpstreamRequest(
    { base_url: "https://api.anthropic.com", model: "claude-x", api_format: "anthropic", temperature: null, max_tokens: 100 },
    "sk-ant", "sys",
    [
      { role: "system", parts: [{ type: "text", text: "extra" }] },
      { role: "assistant", parts: [{ type: "text", text: "ok" }] },
    ],
    false
  );
  assert.equal(r.url, "https://api.anthropic.com/v1/messages");
  assert.equal(r.headers["x-api-key"], "sk-ant");
  assert.equal(r.headers["anthropic-version"], "2023-06-01");
  assert.equal(r.body.system, "sys\nextra");
  assert.equal(r.body.max_tokens, 100);
  assert.equal(r.body.stream, undefined);
  assert.deepEqual(r.body.messages[0], { role: "assistant", content: "ok" });
});

test("buildUpstreamRequest: gemini", () => {
  const r = buildUpstreamRequest(
    { base_url: "https://gen.example.com", model: "gemini-2.0-flash", api_format: "gemini", temperature: null, max_tokens: 50 },
    "gk", "",
    [{ role: "assistant", parts: [{ type: "text", text: "hi" }] }], true
  );
  assert.ok(r.url.includes("/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse"));
  assert.equal(r.headers["x-goog-api-key"], "gk");
  assert.deepEqual(r.body.contents[0], { role: "model", parts: "hi" });
  assert.equal(r.body.generationConfig.maxOutputTokens, 50);
});

test("SSE normalizer: openai", () => {
  const n = createSseNormalizer("openai");
  const evs = [
    ...n.pushLine('data: {"choices":[{"delta":{"content":"Hello"}}]}'),
    ...n.pushLine('data: {"choices":[{"delta":{"content":" world"}}]}'),
    ...n.pushLine('data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":3}}'),
    ...n.pushLine("data: [DONE]"),
  ];
  assert.deepEqual(evs, [
    { kind: "text", text: "Hello" },
    { kind: "text", text: " world" },
    { kind: "usage", input: 5, output: 3 },
    { kind: "done" },
  ]);
});

test("SSE normalizer: anthropic 事件流", () => {
  const n = createSseNormalizer("anthropic");
  const lines = [
    "event: message_start",
    'data: {"type":"message_start","message":{"usage":{"input_tokens":7}}}',
    "event: content_block_delta",
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}',
    "event: content_block_delta",
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":" there"}}',
    "event: message_delta",
    'data: {"type":"message_delta","usage":{"output_tokens":4}}',
    "event: message_stop",
    'data: {"type":"message_stop"}',
  ];
  const evs = lines.flatMap((l) => n.pushLine(l));
  assert.deepEqual(evs, [
    { kind: "text", text: "Hi" },
    { kind: "text", text: " there" },
    { kind: "usage", input: 7, output: 4 },
    { kind: "done" },
  ]);
});

test("SSE normalizer: gemini", () => {
  const n = createSseNormalizer("gemini");
  const evs = [
    ...n.pushLine('data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}'),
    ...n.pushLine('data: {"candidates":[{"content":{"parts":[{"text":"!"}]}}],"usageMetadata":{"promptTokenCount":9,"candidatesTokenCount":2}}'),
  ];
  assert.deepEqual(evs, [
    { kind: "text", text: "Hello" },
    { kind: "text", text: "!" },
    { kind: "usage", input: 9, output: 2 },
  ]);
});

test("extractText: 三家格式", () => {
  assert.equal(extractText("openai", { choices: [{ message: { content: "T1" } }] }), "T1");
  assert.equal(extractText("anthropic", { content: [{ type: "text", text: "T2" }] }), "T2");
  assert.equal(
    extractText("gemini", { candidates: [{ content: { parts: [{ text: "T" }, { text: "3" }] } }] }),
    "T3"
  );
});

test("toOpenAiSseLine: text/done/error", () => {
  assert.equal(
    toOpenAiSseLine({ kind: "text", text: "hi" }),
    'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'
  );
  assert.equal(toOpenAiSseLine({ kind: "done" }), "data: [DONE]\n\n");
  assert.ok((toOpenAiSseLine({ kind: "error", message: "boom" }) ?? "").includes("upstream_error"));
  assert.equal(toOpenAiSseLine({ kind: "usage", input: 1, output: 2 }), null);
});
