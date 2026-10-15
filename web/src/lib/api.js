// 自家后端 API 客户端。Key 永不经过这些接口（直连 Key 在浏览器，代理 Key 走专用请求头）。
const BASE = "/api";
export class ApiError extends Error {
    code;
    status;
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
    }
}
async function req(path, opts = {}) {
    const token = localStorage.getItem("aichat_token");
    const res = await fetch(BASE + path, {
        ...opts,
        headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            ...(opts.headers ?? {}),
        },
    });
    if (res.status === 204)
        return undefined;
    const json = await res.json().catch(() => ({}));
    if (!res.ok)
        throw new ApiError(res.status, json.error ?? "unknown", json.message ?? `HTTP ${res.status}`);
    return json;
}
export const api = {
    health: () => req("/health"),
    register: (username, password) => req("/auth/register", { method: "POST", body: JSON.stringify({ username, password }) }),
    login: (username, password) => req("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
    logout: () => req("/auth/logout", { method: "POST" }),
    me: () => req("/auth/me"),
    conversations: (page = 1, perPage = 20) => req(`/conversations?page=${page}&per_page=${perPage}`),
    createConversation: (body) => req("/conversations", { method: "POST", body: JSON.stringify(body) }),
    getConversation: (id) => req(`/conversations/${id}`),
    patchConversation: (id, title) => req(`/conversations/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }),
    deleteConversation: (id) => req(`/conversations/${id}`, { method: "DELETE" }),
    messages: (convId, limit = 50, beforeId) => req(`/conversations/${convId}/messages?limit=${limit}${beforeId ? `&before_id=${beforeId}` : ""}`),
    postMessage: (convId, body) => req(`/conversations/${convId}/messages`, { method: "POST", body: JSON.stringify(body) }),
    modelConfigs: () => req("/model-configs"),
    createModelConfig: (body) => req("/model-configs", { method: "POST", body: JSON.stringify(body) }),
    patchModelConfig: (id, body) => req(`/model-configs/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    deleteModelConfig: (id) => req(`/model-configs/${id}`, { method: "DELETE" }),
    keys: () => req("/keys"),
    createKey: (body) => req("/keys", { method: "POST", body: JSON.stringify(body) }),
    deleteKey: (id) => req(`/keys/${id}`, { method: "DELETE" }),
    /** 代理模式聊天：返回 SSE 响应，由调用方逐行解析（已归一化为 OpenAI 风格） */
    chatProxy: (convId, content, contentType, modelApiKey) => fetch(BASE + `/conversations/${convId}/chat`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            ...(localStorage.getItem("aichat_token") ? { authorization: `Bearer ${localStorage.getItem("aichat_token")}` } : {}),
            ...(modelApiKey ? { "x-model-api-key": modelApiKey } : {}),
        },
        body: JSON.stringify({ content, content_type: contentType }),
    }),
};
