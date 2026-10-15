import test from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import type { RowDataPacket } from "mysql2/promise";
import { setupApp, teardownApp, cleanDb, registerUser, bearer, testConfig } from "./helpers.js";
import { resolveServerKey } from "../src/routes/keys.js";

let app: FastifyInstance;
let token: string;
let userId: string;
test.before(async () => { app = await setupApp(); });
test.after(async () => { await teardownApp(app); });
test.beforeEach(async () => {
  await cleanDb(app);
  const u = await registerUser(app, "keyuser");
  token = u.token;
  userId = u.user.id;
});

const payload = {
  label: "我的 Key", base_url: "https://api.example.com/v1",
  api_key: "sk-test-secret-9999", consent: true,
};

test("未勾选同意则拒绝", async () => {
  const r = await app.inject({
    method: "POST", url: "/api/keys", headers: bearer(token),
    payload: { ...payload, consent: false },
  });
  assert.equal(r.statusCode, 400);
});

test("同步成功：加密存储、只返回 hint", async () => {
  const r = await app.inject({ method: "POST", url: "/api/keys", headers: bearer(token), payload });
  assert.equal(r.statusCode, 201);
  const j = r.json();
  assert.equal(j.key_hint, "…9999");
  assert.ok(!("api_key" in j));
  // 库里是密文而非原文
  const [rows] = await app.pool.query<RowDataPacket[]>("SELECT key_encrypted FROM api_keys");
  const blob = rows[0].key_encrypted as Buffer;
  assert.ok(!blob.toString("utf8").includes("sk-test-secret-9999"));
  // 列表接口同样不返回原文
  const list = await app.inject({ method: "GET", url: "/api/keys", headers: bearer(token) });
  assert.equal(list.json().items[0].key_hint, "…9999");
  assert.ok(!("api_key" in list.json().items[0]));
  // 解密可用
  const plain = await resolveServerKey(app.pool, testConfig(), userId, null, "https://api.example.com/v1");
  assert.equal(plain, "sk-test-secret-9999");
});

test("删除 Key", async () => {
  const c = await app.inject({ method: "POST", url: "/api/keys", headers: bearer(token), payload });
  const d = await app.inject({ method: "DELETE", url: `/api/keys/${c.json().id}`, headers: bearer(token) });
  assert.equal(d.statusCode, 204);
});

test("未配置加密密钥时返回 500", async () => {
  const app2 = await setupApp(testConfig({ keyEncryptionKey: null }));
  try {
    const u = await registerUser(app2, "nokeyuser");
    const r = await app2.inject({
      method: "POST", url: "/api/keys", headers: bearer(u.token), payload,
    });
    assert.equal(r.statusCode, 500);
    assert.equal(r.json().error, "server_misconfigured");
  } finally {
    await teardownApp(app2);
  }
});
