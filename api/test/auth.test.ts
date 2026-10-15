import test from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { setupApp, teardownApp, cleanDb, registerUser, bearer } from "./helpers.js";

let app: FastifyInstance;
test.before(async () => { app = await setupApp(); });
test.after(async () => { await teardownApp(app); });
test.beforeEach(async () => { await cleanDb(app); });

test("register: 成功 201 并返回 token", async () => {
  const res = await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "alice", password: "password123" } });
  assert.equal(res.statusCode, 201);
  const j = res.json();
  assert.equal(j.user.username, "alice");
  assert.equal(j.token.length, 64);
});

test("register: 重复用户名 409，弱密码/非法用户名 400", async () => {
  await registerUser(app, "dup");
  const r2 = await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "dup", password: "password123" } });
  assert.equal(r2.statusCode, 409);
  const r3 = await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "ab", password: "password123" } });
  assert.equal(r3.statusCode, 400);
  const r4 = await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "okname", password: "short" } });
  assert.equal(r4.statusCode, 400);
});

test("login/me/logout 完整流程", async () => {
  await registerUser(app, "loginuser", "s3cret-pw");
  const bad = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "loginuser", password: "wrong" } });
  assert.equal(bad.statusCode, 401);
  const ok = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "loginuser", password: "s3cret-pw" } });
  assert.equal(ok.statusCode, 200);
  const token = ok.json().token;
  const me = await app.inject({ method: "GET", url: "/api/auth/me", headers: bearer(token) });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().user.username, "loginuser");
  const out = await app.inject({ method: "POST", url: "/api/auth/logout", headers: bearer(token) });
  assert.equal(out.statusCode, 204);
  const me2 = await app.inject({ method: "GET", url: "/api/auth/me", headers: bearer(token) });
  assert.equal(me2.statusCode, 401);
});

test("未认证访问被拒绝", async () => {
  const r = await app.inject({ method: "GET", url: "/api/conversations" });
  assert.equal(r.statusCode, 401);
  const r2 = await app.inject({ method: "GET", url: "/api/auth/me", headers: bearer("bogus") });
  assert.equal(r2.statusCode, 401);
});

test("health 无需认证", async () => {
  const r = await app.inject({ method: "GET", url: "/api/health" });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().db, "ok");
});
