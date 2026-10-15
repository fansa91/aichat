// BYOK 本地密钥管理：Key 默认只存浏览器 localStorage，不上传服务器。
// 提供按模型配置维度的增/改/删。存储结构：{ [configId]: { key, updatedAt } }
const LS_KEY = "aichat_byok_keys";
function readAll() {
    try {
        return JSON.parse(localStorage.getItem(LS_KEY) ?? "{}");
    }
    catch {
        return {};
    }
}
function writeAll(all) {
    localStorage.setItem(LS_KEY, JSON.stringify(all));
}
export const byok = {
    get(configId) {
        return readAll()[configId]?.key ?? null;
    },
    set(configId, key) {
        const all = readAll();
        all[configId] = { key, updatedAt: new Date().toISOString() };
        writeAll(all);
    },
    remove(configId) {
        const all = readAll();
        delete all[configId];
        writeAll(all);
    },
    has(configId) {
        return (readAll()[configId]?.key?.length ?? 0) >= 8;
    },
    hint(configId) {
        const k = readAll()[configId]?.key;
        return k ? `…${k.slice(-4)}` : null;
    },
};
