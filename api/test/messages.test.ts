import test from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { setupApp, teardownApp, cleanDb, registerUser, bearer } from "./helpers.js";

let app: FastifyInstance;
let token: string;
let convId: string;
test.before(async () => { app = await setupApp(); });
test.after(async () => { await teardownApp(app); });
test.beforeEach(async () => {
  await cleanDb(app);
  token = (await registerUser(app, "msguser")).token;
  const r = await app.inject({ method: "POST", url: "/api/conversations", headers: bearer(token), payload: {} });
  convId = r.json().id;
});

async function post(role: string, content: string, content_type = "text") {
  return app.inject({
    method: "POST", url: `/api/conversations/${convId}/messages`, headers: bearer(token),
    payload: { role, content, content_type },
  });
}

test("消息写入与时间排序", async () => {
  await post("user", "m1");
  await post("assistant", "m2");
  const r = await app.inject({ method: "GET", url: `/api/conversations/${convId}/messages`, headers: bearer(token) });
  const j = r.json();
  assert.equal(j.items.length, 2);
  assert.equal(j.items[0].content, "m1"); // ASC
  assert.equal(j.items[1].content, "m2");
  assert.ok(j.items[1].id > j.items[0].id);
});

test("游标分页 before_id + has_more", async () => {
  for (let i = 1; i <= 5; i++) await post("user", `m${i}`);
  const p1 = await app.inject({ method: "GET", url: `/api/conversations/${convId}/messages?limit=2`, headers: bearer(token) });
  const j1 = p1.json();
  assert.deepEqual(j1.items.map((m: any) => m.content), ["m4", "m5"]);
  assert.equal(j1.has_more, true);
  const oldest = j1.items[0].id;
  const p2 = await app.inject({
    method: "GET", url: `/api/conversations/${convId}/messages?limit=2&before_id=${oldest}`, headers: bearer(token),
  });
  const j2 = p2.json();
  assert.deepEqual(j2.items.map((m: any) => m.content), ["m2", "m3"]);
  assert.equal(j2.has_more, true);
  const p3 = await app.inject({
    method: "GET", url: `/api/conversations/${convId}/messages?limit=2&before_id=${j2.items[0].id}`, headers: bearer(token),
  });
  const j3 = p3.json();
  assert.deepEqual(j3.items.map((m: any) => m.content), ["m1"]);
  assert.equal(j3.has_more, false);
});

test("多模态 parts 写入与校验", async () => {
  const parts = JSON.stringify([{ type: "text", text: "看图" }]);
  const r = await post("user", parts, "parts");
  assert.equal(r.statusCode, 201);
  assert.equal(r.json().content_type, "parts");
  const bad = await post("user", "not-json", "parts");
  assert.equal(bad.statusCode, 400);
  const badRole = await post("bot", "x");
  assert.equal(badRole.statusCode, 400);
});
