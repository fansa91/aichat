import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import type { RowDataPacket } from "mysql2/promise";
import { setupApp, teardownApp, cleanDb, registerUser, bearer, pollFor } from "./helpers.js";

interface Captured { url?: string; headers: http.IncomingHttpHeaders; body: any; }

function startFakeUpstream(kind: "openai" | "anthropic" | "error500") {
  const requests: Captured[] = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : null;
      requests.push({ url: req.url, headers: req.headers, body });
      if (kind === "error500") {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "upstream exploded" } }));
        return;
      }
      if (kind === "openai") {
        if (body?.stream) {
          res.writeHead(200, { "content-type": "text/event-stream" });
          res.end(
            'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n' +
            'data: {"choices":[{"delta":{"content":" world"}}]}\n\n' +
            'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":3}}\n\n' +
            "data: [DONE]\n\n"
          );
        } else {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ choices: [{ message: { content: "测试标题" } }] }));
        }
        return;
      }
      // anthropic
      if (body?.stream) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(
          "event: message_start\n" +
          'data: {"type":"message_start","message":{"usage":{"input_tokens":7}}}\n\n' +
          "event: content_block_delta\n" +
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}\n\n' +
          "event: message_delta\n" +
          'data: {"type":"message_delta","usage":{"output_tokens":4}}\n\n' +
          "event: message_stop\n" +
          'data: {"type":"message_stop"}\n\n'
        );
      } else {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ content: [{ type: "text", text: "测试标题" }] }));
      }
    });
  });
  return new Promise<{ url: string; requests: Captured[]; close: () => Promise<void> }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        requests,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

async function readSse(res: Response): Promise<string[]> {
  const lines: string[] = [];
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of res.body as any) {
    buf += decoder.decode(chunk, { stream: true });
    const parts = buf.split("\n");
    buf = parts.pop() ?? "";
    for (const l of parts) if (l.trim()) lines.push(l.trim());
  }
  if (buf.trim()) lines.push(buf.trim());
  return lines;
}

let app: FastifyInstance;
let base: string;
test.before(async () => {
  app = await setupApp();
  await app.listen({ port: 0, host: "127.0.0.1" });
  const { port } = app.server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});
test.after(async () => { await teardownApp(app); });
test.beforeEach(async () => { await cleanDb(app); });

async function makeConv(token: string, cfgId: string) {
  const r = await app.inject({
    method: "POST", url: "/api/conversations", headers: bearer(token),
    payload: { model_config_id: cfgId },
  });
  return r.json().id as string;
}

test("代理转发：transient Key 全流程（openai）", async () => {
  const up = await startFakeUpstream("openai");
  try {
    const { token } = await registerUser(app, "chatuser1");
    const cfg = await app.inject({
      method: "POST", url: "/api/model-configs", headers: bearer(token),
      payload: { name: "c", base_url: up.url, model: "gpt-4o", request_mode: "proxy" },
    });
    const convId = await makeConv(token, cfg.json().id);

    const res = await fetch(`${base}/api/conversations/${convId}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "x-model-api-key": "sk-transient-123" },
      body: JSON.stringify({ content: "你好" }),
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "text/event-stream");
    const lines = await readSse(res);
    assert.ok(lines.some((l) => l.includes('"content":"Hello"')), `缺 Hello 行: ${lines}`);
    assert.ok(lines.some((l) => l.includes('"content":" world"')));
    assert.equal(lines[lines.length - 1], "data: [DONE]");

    // 上游收到正确的鉴权与请求体，且 body 里没有 Key
    assert.equal(up.requests.length >= 1, true);
    const chatReq = up.requests.find((r) => r.body?.stream === true)!;
    assert.equal(chatReq.headers.authorization, "Bearer sk-transient-123");
    assert.ok(JSON.stringify(chatReq.body).includes("你好"));
    assert.ok(!JSON.stringify(chatReq.body).includes("sk-transient"));

    // 消息落库：用户 + 助手，usage 回填（落库在 raw.end() 之后，轮询等待）
    const settled = await pollFor(async () => {
      const [m] = await app.pool.query<RowDataPacket[]>(
        "SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?",
        [convId]
      );
      return (m[0].n as number) === 2;
    });
    assert.equal(settled, true, "用户+助手两条消息应落库");
    const [msgs] = await app.pool.query<RowDataPacket[]>(
      "SELECT role, content, tokens_in, tokens_out FROM messages WHERE conversation_id = ? ORDER BY id",
      [convId]
    );
    assert.equal(msgs[0].role, "user");
    assert.equal(msgs[1].role, "assistant");
    assert.equal(msgs[1].content, "Hello world");
    assert.equal(msgs[1].tokens_in, 5);
    assert.equal(msgs[1].tokens_out, 3);

    // transient Key 未持久化
    const [keys] = await app.pool.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM api_keys");
    assert.equal(keys[0].n, 0);

    // 首轮标题自动生成
    const ok = await pollFor(async () => {
      const r = await app.inject({ method: "GET", url: `/api/conversations/${convId}`, headers: bearer(token) });
      return r.json().title === "测试标题";
    });
    assert.equal(ok, true, "标题应自动生成为「测试标题」");
  } finally {
    await up.close();
  }
});

test("代理转发：服务端加密 Key（无请求头）", async () => {
  const up = await startFakeUpstream("openai");
  try {
    const { token, user } = await registerUser(app, "chatuser2");
    const cfg = await app.inject({
      method: "POST", url: "/api/model-configs", headers: bearer(token),
      payload: { name: "c", base_url: up.url, model: "gpt-4o", request_mode: "proxy" },
    });
    const cfgId = cfg.json().id;
    await app.inject({
      method: "POST", url: "/api/keys", headers: bearer(token),
      payload: { label: "k", base_url: up.url, model_config_id: cfgId, api_key: "sk-server-456", consent: true },
    });
    const convId = await makeConv(token, cfgId);
    const res = await fetch(`${base}/api/conversations/${convId}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ content: "hi" }),
    });
    assert.equal(res.status, 200);
    const lines = await readSse(res);
    assert.equal(lines[lines.length - 1], "data: [DONE]");
    const chatReq = up.requests.find((r) => r.body?.stream === true)!;
    assert.equal(chatReq.headers.authorization, "Bearer sk-server-456");
    void user;
  } finally {
    await up.close();
  }
});

test("代理转发：无 Key 时 400", async () => {
  const { token } = await registerUser(app, "chatuser3");
  const cfg = await app.inject({
    method: "POST", url: "/api/model-configs", headers: bearer(token),
    payload: { name: "c", base_url: "http://127.0.0.1:9", model: "gpt-4o", request_mode: "proxy" },
  });
  const convId = await makeConv(token, cfg.json().id);
  const res = await fetch(`${base}/api/conversations/${convId}/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ content: "hi" }),
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, "bad_request");
});

test("代理转发：上游 500 时 502", async () => {
  const up = await startFakeUpstream("error500");
  try {
    const { token } = await registerUser(app, "chatuser4");
    const cfg = await app.inject({
      method: "POST", url: "/api/model-configs", headers: bearer(token),
      payload: { name: "c", base_url: up.url, model: "gpt-4o", request_mode: "proxy" },
    });
    const convId = await makeConv(token, cfg.json().id);
    const res = await fetch(`${base}/api/conversations/${convId}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "x-model-api-key": "sk-test-key-123" },
      body: JSON.stringify({ content: "hi" }),
    });
    assert.equal(res.status, 502);
    assert.equal((await res.json()).error, "upstream_error");
  } finally {
    await up.close();
  }
});

test("代理转发：anthropic 线路归一化", async () => {
  const up = await startFakeUpstream("anthropic");
  try {
    const { token } = await registerUser(app, "chatuser5");
    const cfg = await app.inject({
      method: "POST", url: "/api/model-configs", headers: bearer(token),
      payload: { name: "c", base_url: up.url, model: "claude-x", api_format: "anthropic", request_mode: "proxy" },
    });
    const convId = await makeConv(token, cfg.json().id);
    const res = await fetch(`${base}/api/conversations/${convId}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "x-model-api-key": "sk-ant-1" },
      body: JSON.stringify({ content: "hi" }),
    });
    assert.equal(res.status, 200);
    const lines = await readSse(res);
    assert.ok(lines.some((l) => l.includes('"content":"Hi"')));
    assert.equal(lines[lines.length - 1], "data: [DONE]");
    const chatReq = up.requests.find((r) => r.body?.stream === true)!;
    assert.equal(chatReq.url, "/v1/messages");
    assert.equal(chatReq.headers["x-api-key"], "sk-ant-1");
    // 落库在 raw.end() 之后异步发生，轮询等待
    const found = await pollFor(async () => {
      const [m] = await app.pool.query<RowDataPacket[]>(
        "SELECT content, tokens_in, tokens_out FROM messages WHERE conversation_id = ? AND role = 'assistant'",
        [convId]
      );
      return m.length === 1;
    });
    assert.equal(found, true, "助手消息应落库");
    const [msgs] = await app.pool.query<RowDataPacket[]>(
      "SELECT content, tokens_in, tokens_out FROM messages WHERE conversation_id = ? AND role = 'assistant'",
      [convId]
    );
    assert.equal(msgs[0].content, "Hi");
    assert.equal(msgs[0].tokens_in, 7);
    assert.equal(msgs[0].tokens_out, 4);
  } finally {
    await up.close();
  }
});

test("代理转发：provider 直传参数（无 model_config）", async () => {
  const up = await startFakeUpstream("openai");
  try {
    const { token } = await registerUser(app, "chatuser_provider");
    // 不创建 model_config，会话也不关联配置
    const r = await app.inject({
      method: "POST", url: "/api/conversations", headers: bearer(token),
      payload: { provider: "openai", model: "gpt-4o", request_mode: "proxy" },
    });
    assert.equal(r.statusCode, 201);
    const convId = r.json().id as string;

    const res = await fetch(`${base}/api/conversations/${convId}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "x-model-api-key": "sk-direct" },
      body: JSON.stringify({
        content: "你好",
        api_format: "openai", base_url: up.url, model: "gpt-4o",
      }),
    });
    assert.equal(res.status, 200);
    const lines = await readSse(res);
    assert.ok(lines.some((l) => l.includes('"content":"Hello"')), `缺 Hello 行: ${lines}`);

    const chatReq = up.requests.find((r) => r.body?.stream === true)!;
    assert.equal(chatReq.body.model, "gpt-4o");
    assert.equal(chatReq.headers.authorization, "Bearer sk-direct");
  } finally {
    await up.close();
  }
});

test("代理转发：resend=true 时不重复插入用户消息", async () => {
  const up = await startFakeUpstream("openai");
  try {
    const { token } = await registerUser(app, "chatuser_resend");
    const convId = await makeConv(token, null);
    // 先手动写入一条用户消息（模拟编辑后的状态）
    await app.inject({
      method: "POST", url: `/api/conversations/${convId}/messages`, headers: bearer(token),
      payload: { role: "user", content: "编辑后的问题" },
    });
    const res = await fetch(`${base}/api/conversations/${convId}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "x-model-api-key": "sk-transient" },
      body: JSON.stringify({
        content: "编辑后的问题", api_format: "openai", base_url: up.url, model: "gpt-4o", resend: true,
      }),
    });
    assert.equal(res.status, 200);
    await readSse(res);
    const settled = await pollFor(async () => {
      const [m] = await app.pool.query<RowDataPacket[]>(
        "SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?",
        [convId]
      );
      return m[0].n === 2;
    });
    assert.ok(settled, "应只有 2 条消息（用户 1 条不重复 + 助手 1 条）");
    const [all] = await app.pool.query<RowDataPacket[]>(
      "SELECT role FROM messages WHERE conversation_id = ? ORDER BY id",
      [convId]
    );
    assert.deepEqual(all.map((r: any) => r.role), ["user", "assistant"]);
  } finally {
    await up.close();
  }
});
