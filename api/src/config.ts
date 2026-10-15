// 后端配置：全部来自环境变量（deploy.sh 写入 api/.env，0600 权限）。
// 数据库凭据与加密密钥永不进前端、不进仓库。

export interface AppConfig {
  port: number;
  db: { host: string; port: number; user: string; password: string; name: string };
  keyEncryptionKey: string | null; // 64 位 hex（32 字节），缺失时 /api/keys 相关功能不可用
  corsOrigin: string | null;
}

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") throw new Error(`missing env ${name}`);
  return v;
}

export function loadConfig(): AppConfig {
  const keyHex = process.env.AICHAT_KEY_ENCRYPTION_KEY ?? null;
  if (keyHex !== null && !/^[0-9a-fA-F]{64}$/.test(keyHex)) {
    throw new Error("AICHAT_KEY_ENCRYPTION_KEY must be 64 hex chars (32 bytes)");
  }
  return {
    port: parseInt(process.env.PORT ?? "3002", 10),
    db: {
      host: process.env.DB_HOST ?? "127.0.0.1",
      port: parseInt(process.env.DB_PORT ?? "3306", 10),
      user: required("DB_USER", "root"),
      password: process.env.DB_PASSWORD ?? "",
      name: process.env.DB_NAME ?? "aichat",
    },
    keyEncryptionKey: keyHex,
    corsOrigin: process.env.CORS_ORIGIN ?? null,
  };
}
