// 密码哈希：scrypt（node:crypto，无原生依赖）。
// 格式： scrypt$N$r$p$saltHex$hashHex

import { scrypt as _scrypt, randomBytes, timingSafeEqual } from "node:crypto";

interface ScryptOpts { N: number; r: number; p: number; }
function scryptAsync(password: string, salt: string, keylen: number, opts: ScryptOpts): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    _scrypt(password, salt, keylen, opts, (err, derived) => {
      if (err) reject(err);
      else resolve(derived as Buffer);
    });
  });
}
const N = 16384, r = 8, p = 1, KEYLEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hash = await scryptAsync(password, salt, KEYLEN, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt}$${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, rr, pp, salt, hashHex] = parts;
  const hash = await scryptAsync(password, salt, KEYLEN, {
    N: parseInt(n, 10), r: parseInt(rr, 10), p: parseInt(pp, 10),
  });
  const expected = Buffer.from(hashHex, "hex");
  return hash.length === expected.length && timingSafeEqual(hash, expected);
}
