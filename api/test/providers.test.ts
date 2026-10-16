import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import { setupApp, teardownApp, cleanDb, registerUser, bearer } from "./helpers.js";

function startFakeModels(payload: unknown, status = 200) {
  const requests: { url?: string; headers: http.IncomingHttpHeaders }[] = [];
  const server = http.createServer((req, res) => {
    requests.push({ url: req.url, headers: req.headers });
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
  });
  return new Promise<{ url: string; requests: typeof requests; close: () => Promise<void> }>((resolve) => {
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

let app: FastifyInstance;
test.before(async () => { app = await setupApp(); });
test.after(async () => { await teardownApp(app); });
test.beforeEach(async () => { await cleanDb(app); });

test("模型列表中转：transient Key 直传上游", async () => {
  const up = await startFakeModels({ data: [{ id: "m1" }, { id: "m2" }, {}] });
  try {
    const { token } = await registerUser(app, "provuser1");
    const r = await app.inject({
      method: "POST", url: "/api/providers/models", headers: bearer(token),
      payload: { api_format: "openai", base_url: up.url },
    });
    // 无 Key（请求头/服务端都没有）→ 400
    assert.equal(r.statusCode, 400);

    const r2 = await app.inject({
      method: "POST", url: "/api/providers/models",
      headers: { ...bearer(token), "x-model-api-key": "sk-transient" },
      payload: { api_format: "openai", base_url: up.url },
    });
    assert.equal(r2.statusCode, 200);
    assert.deepEqual(r2.json().models, ["m1", "m2"]);
    assert.equal(up.requests[0].headers.authorization, "Bearer sk-transient");
    assert.equal(up.requests[0].url, "/models");
  } finally {
    await up.close();
  }
});

test("模型列表中转：参数非法", async () => {
  const { token } = await registerUser(app, "provuser2");
  const bad = await app.inject({
    method: "POST", url: "/api/providers/models", headers: bearer(token),
    payload: { api_format: "weird", base_url: "http://x" },
  });
  assert.equal(bad.statusCode, 400);
  const bad2 = await app.inject({
    method: "POST", url: "/api/providers/models", headers: bearer(token),
    payload: { api_format: "openai", base_url: "not-a-url" },
  });
  assert.equal(bad2.statusCode, 400);
});

test("模型列表中转：上游 500 → 502", async () => {
  const up = await startFakeModels({ error: "boom" }, 500);
  try {
    const { token } = await registerUser(app, "provuser3");
    const r = await app.inject({
      method: "POST", url: "/api/providers/models",
      headers: { ...bearer(token), "x-model-api-key": "sk-transient" },
      payload: { api_format: "openai", base_url: up.url },
    });
    assert.equal(r.statusCode, 502);
  } finally {
    await up.close();
  }
});

test("模型列表中转：未认证拒绝", async () => {
  const r = await app.inject({
    method: "POST", url: "/api/providers/models",
    payload: { api_format: "openai", base_url: "http://x" },
  });
  assert.equal(r.statusCode, 401);
});
