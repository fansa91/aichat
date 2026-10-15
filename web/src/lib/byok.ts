// BYOK 本地密钥管理：Key 默认只存浏览器 localStorage，不上传服务器。
// 提供按模型配置维度的增/改/删。存储结构：{ [configId]: { key, updatedAt } }

const LS_KEY = "aichat_byok_keys";

interface StoredKey { key: string; updatedAt: string; }

function readAll(): Record<string, StoredKey> {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, StoredKey>) {
  localStorage.setItem(LS_KEY, JSON.stringify(all));
}

export const byok = {
  get(configId: string): string | null {
    return readAll()[configId]?.key ?? null;
  },
  set(configId: string, key: string) {
    const all = readAll();
    all[configId] = { key, updatedAt: new Date().toISOString() };
    writeAll(all);
  },
  remove(configId: string) {
    const all = readAll();
    delete all[configId];
    writeAll(all);
  },
  has(configId: string): boolean {
    return (readAll()[configId]?.key?.length ?? 0) >= 8;
  },
  hint(configId: string): string | null {
    const k = readAll()[configId]?.key;
    return k ? `…${k.slice(-4)}` : null;
  },
};
