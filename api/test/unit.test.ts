import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "../src/auth/password.js";
import { encryptKey, decryptKey, keyHint } from "../src/crypto/keybox.js";
import { createRateLimiter } from "../src/auth/rateLimit.js";
import { hashToken, newToken } from "../src/auth/tokens.js";

test("password: 哈希与校验", async () => {
  const h = await hashPassword("correct-horse-123");
  assert.ok(h.startsWith("scrypt$"));
  assert.equal(await verifyPassword("correct-horse-123", h), true);
  assert.equal(await verifyPassword("wrong", h), false);
  assert.equal(await verifyPassword("x", "not-a-hash"), false);
});

test("keybox: AES-256-GCM 往返", () => {
  const hex = Buffer.alloc(32, 9).toString("hex");
  const blob = encryptKey(hex, "sk-secret-key-123");
  assert.ok(Buffer.isBuffer(blob));
  assert.ok(!blob.toString("utf8").includes("sk-secret-key-123"));
  assert.equal(decryptKey(hex, blob), "sk-secret-key-123");
  assert.equal(keyHint("sk-secret-key-123"), "…-123");
  assert.throws(() => decryptKey(Buffer.alloc(32, 8).toString("hex"), blob), /unsupported|bad decrypt/i);
  assert.throws(() => encryptKey(null, "x"), /key_encryption_unavailable/);
});

test("tokens: 生成与哈希", () => {
  const t = newToken();
  assert.equal(t.length, 64);
  assert.equal(hashToken(t).length, 64);
  assert.notEqual(hashToken(t), t);
});

test("rateLimiter: 固定窗口", () => {
  const lim = createRateLimiter({ windowMs: 60_000, max: 2 });
  assert.equal(lim.check("a"), true);
  assert.equal(lim.check("a"), true);
  assert.equal(lim.check("a"), false);
  assert.equal(lim.check("b"), true); // 不同 key 互不影响
});
