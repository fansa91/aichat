import test from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { setupApp, teardownApp, cleanDb, registerUser, bearer } from "./helpers.js";

let app: FastifyInstance;
let token: string;
test.before(async () => { app = await setupApp(); });
test.after(async () => { await teardownApp(app); });
test.beforeEach(async () => {
  await cleanDb(app);
  token = (await registerUser(app, "cfguser")).token;
});

async function createCfg(t: string, body: any) {
  return app.inject({ method: "POST", url: "/api/model-configs", headers: bearer(t), payload: body });
}

const base = { name: "c1", base_url: "https://api.example.com/v1", model: "gpt-4o" };

test("模型配置 CRUD 与 api_format", async () => {
  const r = await createCfg(token, { ...base, api_format: "anthropic", request_mode: "proxy" });
  assert.equal(r.statusCode, 201);
  assert.equal(r.json().api_format, "anthropic");
  const id = r.json().id;
  const list = await app.inject({ method: "GET", url: "/api/model-configs", headers: bearer(token) });
  assert.equal(list.json().items.length, 1);
  const p = await app.inject({
    method: "PATCH", url: `/api/model-configs/${id}`, headers: bearer(token),
    payload: { temperature: 0.5 },
  });
  assert.equal(p.json().temperature, "0.50");
  const bad = await app.inject({
    method: "PATCH", url: `/api/model-configs/${id}`, headers: bearer(token),
    payload: { api_format: "nope" },
  });
  assert.equal(bad.statusCode, 400);
  const d = await app.inject({ method: "DELETE", url: `/api/model-configs/${id}`, headers: bearer(token) });
  assert.equal(d.statusCode, 204);
});

test("is_default 互斥", async () => {
  const a = (await createCfg(token, { ...base, name: "a", is_default: true })).json();
  const b = (await createCfg(token, { ...base, name: "b", is_default: true })).json();
  const list = (await app.inject({ method: "GET", url: "/api/model-configs", headers: bearer(token) })).json();
  const ra = list.items.find((x: any) => x.id === a.id);
  const rb = list.items.find((x: any) => x.id === b.id);
  assert.equal(ra.is_default, 0);
  assert.equal(rb.is_default, 1);
});

test("非法 base_url 被拒绝", async () => {
  const r = await createCfg(token, { ...base, base_url: "not-a-url" });
  assert.equal(r.statusCode, 400);
});
