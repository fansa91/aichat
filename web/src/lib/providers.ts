// Provider 中心配置（LobeChat 风格）：每个上游供应商独立配置 Key、Base URL、
// 请求模式与模型列表。全部只存浏览器 localStorage，不上传服务器。
// 后端代理模式按需通过请求体传入 provider 参数（见 api/src/routes/chat.ts）。

import type { ApiFormat, RequestMode } from "./types";
import { listModels } from "./modelClient";

export type { ApiFormat };

export interface ProviderModel {
  id: string;      // 如 "gpt-4o"
  enabled: boolean;
  custom: boolean; // 用户手动添加
}

export interface ProviderSettings {
  enabled: boolean;
  apiKey: string;
  baseUrl: string;
  requestMode: RequestMode;
  models: ProviderModel[];
}

export type ProviderState = Record<ApiFormat, ProviderSettings>;

export interface ProviderMeta {
  id: ApiFormat;
  name: string;
  defaultBaseUrl: string;
  defaultModels: string[];
}

export const PROVIDERS: ProviderMeta[] = [
  {
    id: "openai",
    name: "OpenAI",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModels: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "o3-mini"],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    defaultBaseUrl: "https://api.anthropic.com",
    defaultModels: ["claude-sonnet-4-20250514", "claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022"],
  },
  {
    id: "gemini",
    name: "Google",
    defaultBaseUrl: "https://generativelanguage.googleapis.com",
    defaultModels: ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"],
  },
];

const LS_KEY = "aichat_providers_v1";

function defaults(): ProviderState {
  const s = {} as ProviderState;
  for (const p of PROVIDERS) {
    s[p.id] = {
      enabled: p.id === "openai",
      apiKey: "",
      baseUrl: p.defaultBaseUrl,
      requestMode: "direct",
      models: p.defaultModels.map((id) => ({ id, enabled: true, custom: false })),
    };
  }
  return s;
}

function sanitize(raw: unknown): ProviderState {
  const d = defaults();
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Record<string, Partial<ProviderSettings>>;
  for (const p of PROVIDERS) {
    const o = r[p.id];
    if (!o || typeof o !== "object") continue;
    const cur = d[p.id];
    if (typeof o.enabled === "boolean") cur.enabled = o.enabled;
    if (typeof o.apiKey === "string") cur.apiKey = o.apiKey;
    if (typeof o.baseUrl === "string" && o.baseUrl.trim()) cur.baseUrl = o.baseUrl.trim();
    if (o.requestMode === "direct" || o.requestMode === "proxy") cur.requestMode = o.requestMode;
    if (Array.isArray(o.models)) {
      cur.models = o.models
        .filter((m) => m && typeof m.id === "string" && m.id.trim())
        .map((m) => ({ id: m.id.trim(), enabled: m.enabled !== false, custom: m.custom === true }));
    }
  }
  return d;
}

export function loadProviders(): ProviderState {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return defaults();
    return sanitize(JSON.parse(raw));
  } catch {
    return defaults();
  }
}

export function saveProviders(s: ProviderState): void {
  localStorage.setItem(LS_KEY, JSON.stringify(s));
}

export interface ActiveModel { provider: ApiFormat; model: string; }

/** 所有已启用 provider 的已启用模型（聊天模型选择器用） */
export function enabledModels(s: ProviderState): ActiveModel[] {
  const out: ActiveModel[] = [];
  for (const p of PROVIDERS) {
    const ps = s[p.id];
    if (!ps.enabled) continue;
    for (const m of ps.models) {
      if (m.enabled) out.push({ provider: p.id, model: m.id });
    }
  }
  return out;
}

export function providerName(id: ApiFormat): string {
  return PROVIDERS.find((p) => p.id === id)?.name ?? id;
}

export function hasKey(s: ProviderState, provider: ApiFormat): boolean {
  return (s[provider].apiKey?.length ?? 0) >= 8;
}

const LS_ACTIVE = "aichat_active_model_v1";

export function loadActiveModel(s: ProviderState): ActiveModel | null {
  try {
    const raw = localStorage.getItem(LS_ACTIVE);
    if (raw) {
      const a = JSON.parse(raw) as ActiveModel;
      const list = enabledModels(s);
      if (list.some((m) => m.provider === a.provider && m.model === a.model)) return a;
    }
  } catch { /* 忽略 */ }
  return enabledModels(s)[0] ?? null;
}

export function saveActiveModel(a: ActiveModel): void {
  localStorage.setItem(LS_ACTIVE, JSON.stringify(a));
}

export interface CheckResult {
  ok: boolean;
  models?: string[];
  error?: string;
}

/** 检查连接：用填写的 Key/BaseURL 拉取上游模型列表（直调上游，不经过本服务器） */
export async function checkConnection(
  provider: ApiFormat, baseUrl: string, apiKey: string
): Promise<CheckResult> {
  try {
    const models = await listModels(provider, baseUrl.trim(), apiKey.trim());
    return { ok: true, models };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "连接失败" };
  }
}
