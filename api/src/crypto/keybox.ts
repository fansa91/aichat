// AES-256-GCM 加密盒：用于服务端同步的用户 Key。
// 密钥来自环境变量 AICHAT_KEY_ENCRYPTION_KEY（64 位 hex）；
// 存储格式：nonce(12B) + ciphertext + authTag(16B)，整块存 BLOB。

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function keyBytes(hex: string | null): Buffer {
  if (!hex) throw new Error("key_encryption_unavailable");
  return Buffer.from(hex, "hex");
}

export function encryptKey(keyHex: string | null, plaintext: string): Buffer {
  const key = keyBytes(keyHex);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([nonce, ct, cipher.getAuthTag()]);
}

export function decryptKey(keyHex: string | null, blob: Buffer): string {
  const key = keyBytes(keyHex);
  const nonce = blob.subarray(0, 12);
  const tag = blob.subarray(blob.length - 16);
  const ct = blob.subarray(12, blob.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

export function keyHint(plaintext: string): string {
  const tail = plaintext.slice(-4);
  return `…${tail}`;
}
