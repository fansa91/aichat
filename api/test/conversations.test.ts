import test from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import type { RowDataPacket } from "mysql2/promise";
import { setupApp, teardownApp, cleanDb, registerUser, bearer } from "./helpers.js";

let app: FastifyInstance;
let token: string;
test.before(async () => { app = await setupApp(); });
test.after(async () => { await teardownApp(app); });
test.beforeEach(async () => {
  await cleanDb(app);
  token = (await registerUser(app, "convuser")).token;
});

async function createConv(t: string, title = "T") {
  const r = await app.inject({
    method: "POST", url: "/api/conversations", headers: bearer(t),
    payload: { title },
  });
  assert.equal(r.statusCode, 201);
  return r.json();
}

test("会话 CRUD", async () => {
  const c = await createConv(token, "我的会话");
  assert.equal(c.title, "我的会话");
  const g = await app.inject({ method: "GET", url: `/api/conversations/${c.id}`, headers: bearer(token) });
  assert.equal(g.statusCode, 200);
  const p = await app.inject({
    method: "PATCH", url: `/api/conversations/${c.id}`, headers: bearer(token),
    payload: { title: "改名" },
  });
  assert.equal(p.json().title, "改名");
  const d = await app.inject({ method: "DELETE", url: `/api/conversations/${c.id}`, headers: bearer(token) });
  assert.equal(d.statusCode, 204);
  const g2 = await app.inject({ method: "GET", url: `/api/conversations/${c.id}`, headers: bearer(token) });
  assert.equal(g2.statusCode, 404);
});

test("会话列表分页", async () => {
  for (let i = 0; i < 25; i++) await createConv(token, `c${i}`);
  const r = await app.inject({ method: "GET", url: "/api/conversations?page=2&per_page=10", headers: bearer(token) });
  const j = r.json();
  assert.equal(j.total, 25);
  assert.equal(j.page, 2);
  assert.equal(j.items.length, 10);
});

test("用户隔离：看不到别人的会话", async () => {
  const other = (await registerUser(app, "otheruser")).token;
  const c = await createConv(token);
  const g = await app.inject({ method: "GET", url: `/api/conversations/${c.id}`, headers: bearer(other) });
  assert.equal(g.statusCode, 404);
  const list = await app.inject({ method: "GET", url: "/api/conversations", headers: bearer(other) });
  assert.equal(list.json().total, 0);
});

test("删除会话级联删除消息", async () => {
  const c = await createConv(token);
  await app.inject({
    method: "POST", url: `/api/conversations/${c.id}/messages`, headers: bearer(token),
    payload: { role: "user", content: "hi" },
  });
  await app.inject({ method: "DELETE", url: `/api/conversations/${c.id}`, headers: bearer(token) });
  const [rows] = await app.pool.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM messages");
  assert.equal(rows[0].n, 0);
});
