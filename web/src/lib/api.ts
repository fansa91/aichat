// 自家后端 API 客户端。Key 永不经过这些接口（直连 Key 在浏览器，代理 Key 走专用请求头）。

import type { ApiKeyMeta, Conversation, Message, ModelConfig, User } from "./types";

const BASE = "/api";

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem("aichat_token");
  const hasBody = opts.body !== undefined && opts.body !== null;
  const res = await fetch(BASE + path, {
    ...opts,
    headers: {
      ...(hasBody ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(opts.headers ?? {}),
    },
  });
  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, json.error ?? "unknown", json.message ?? `HTTP ${res.status}`);
  return json as T;
}

export const api = {
  health: () => req<{ status: string; db: string; version: string }>("/health"),
  register: (username: string, password: string) =>
    req<{ token: string; user: User }>("/auth/register", { method: "POST", body: JSON.stringify({ username, password }) }),
  login: (username: string, password: string) =>
    req<{ token: string; user: User }>("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  logout: () => req("/auth/logout", { method: "POST" }),
  me: () => req<{ user: User }>("/auth/me"),

  conversations: (page = 1, perPage = 20) =>
    req<{ items: Conversation[]; page: number; per_page: number; total: number }>(
      `/conversations?page=${page}&per_page=${perPage}`
    ),
  createConversation: (body: { title?: string; model_config_id?: string; request_mode?: string; provider?: string; model?: string }) =>
    req<Conversation>("/conversations", { method: "POST", body: JSON.stringify(body) }),
  getConversation: (id: string) => req<Conversation>(`/conversations/${id}`),
  patchConversation: (id: string, title: string) =>
    req<Conversation>(`/conversations/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }),
  deleteConversation: (id: string) => req(`/conversations/${id}`, { method: "DELETE" }),

  messages: (convId: string, limit = 50, beforeId?: number) =>
    req<{ items: Message[]; has_more: boolean }>(
      `/conversations/${convId}/messages?limit=${limit}${beforeId ? `&before_id=${beforeId}` : ""}`
    ),
  postMessage: (convId: string, body: { role: string; content: string; content_type?: string }) =>
    req<Message>(`/conversations/${convId}/messages`, { method: "POST", body: JSON.stringify(body) }),

  modelConfigs: () => req<{ items: ModelConfig[] }>("/model-configs"),
  createModelConfig: (body: Record<string, unknown>) =>
    req<ModelConfig>("/model-configs", { method: "POST", body: JSON.stringify(body) }),
  patchModelConfig: (id: string, body: Record<string, unknown>) =>
    req<ModelConfig>(`/model-configs/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteModelConfig: (id: string) => req(`/model-configs/${id}`, { method: "DELETE" }),

  keys: () => req<{ items: ApiKeyMeta[] }>("/keys"),
  createKey: (body: { label: string; model_config_id?: string; base_url: string; api_key: string; consent: boolean }) =>
    req<ApiKeyMeta>("/keys", { method: "POST", body: JSON.stringify(body) }),
  deleteKey: (id: string) => req(`/keys/${id}`, { method: "DELETE" }),

  /** 代理模式聊天：返回 SSE 响应，由调用方逐行解析（已归一化为 OpenAI 风格） */
  chatProxy: (
    convId: string, content: string, contentType: string, modelApiKey?: string,
    provider?: { api_format: string; base_url: string; model: string },
  ) =>
    fetch(BASE + `/conversations/${convId}/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(localStorage.getItem("aichat_token") ? { authorization: `Bearer ${localStorage.getItem("aichat_token")}` } : {}),
        ...(modelApiKey ? { "x-model-api-key": modelApiKey } : {}),
      },
      body: JSON.stringify({ content, content_type: contentType, ...(provider ?? {}) }),
    }),
};
