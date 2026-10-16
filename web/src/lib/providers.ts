// Provider 中心配置（LobeChat 风格）：
// - 内置供应商：OpenAI / Anthropic / Google
// - 自定义供应商：用户自加，OpenAI 兼容格式（baseUrl + key），如 DeepSeek / OpenRouter / 硅基流动
// - 模型列表支持从上游 /models 拉取并合并（LobeChat 方式），也可手动添加
// 全部只存浏览器 localStorage，不上传服务器。

import type { ApiFormat, RequestMode } from "./types";
import { listModels } from "./modelClient";
import { api, ApiError } from "./api";

export type { ApiFormat };

export interface ProviderModel {
  id: string;      // 如 "gpt-4o"
  enabled: boolean;
  custom: boolean; // 用户手动添加（非拉取）
}

export interface ProviderSettings {
  id: string;            // "openai" | "anthropic" | "gemini" | "custom-<rand>"
  name: string;          // 显示名
  apiFormat: ApiFormat;  // 线路格式；自定义供应商固定 "openai"
  custom: boolean;       // 是否用户自加
  enabled: boolean;
  apiKey: string;
  baseUrl: string;
  requestMode: RequestMode;
  models: ProviderModel[];
}

/** key 为 provider id 的动态表（支持自定义供应商） */
export type ProviderState = Record<string, ProviderSettings>;

export interface BuiltinMeta {
  id: string;
  name: string;
  apiFormat: ApiFormat;
  defaultBaseUrl: string;
  defaultModels: string[];
}

export const BUILTINS: BuiltinMeta[] = [
  {
    id: "openai",
    name: "OpenAI",
    apiFormat: "openai",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModels: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "o3-mini"],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    apiFormat: "anthropic",
    defaultBaseUrl: "https://api.anthropic.com",
    defaultModels: ["claude-sonnet-4-20250514", "claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022"],
  },
  {
    id: "gemini",
    name: "Google",
    apiFormat: "gemini",
    defaultBaseUrl: "https://generativelanguage.googleapis.com",
    defaultModels: ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"],
  },
];

/** 兼容旧 PROVIDERS 导出（内置列表） */
export const PROVIDERS = BUILTINS.map((b) => ({ id: b.id as ApiFormat, name: b.name }));

const LS_KEY = "aichat_providers_v2";
const LS_KEY_V1 = "aichat_providers_v1";

function builtinDefaults(): ProviderState {
  const s: ProviderState = {};
  for (const b of BUILTINS) {
    s[b.id] = {
      id: b.id,
      name: b.name,
      apiFormat: b.apiFormat,
      custom: false,
      enabled: b.id === "openai",
      apiKey: "",
      baseUrl: b.defaultBaseUrl,
      requestMode: "direct",
      models: b.defaultModels.map((id) => ({ id, enabled: true, custom: false })),
    };
  }
  return s;
}

function sanitizeSettings(raw: unknown, fallback: ProviderSettings): ProviderSettings {
  const o = (raw ?? {}) as Record<string, unknown>;
  const models = Array.isArray(o.models)
    ? (o.models as unknown[])
      .filter((m) => m && typeof (m as ProviderModel).id === "string" && (m as ProviderModel).id.trim())
      .map((m) => {
        const pm = m as ProviderModel;
        return { id: pm.id.trim(), enabled: pm.enabled !== false, custom: pm.custom === true };
      })
    : fallback.models;
  return {
    id: typeof o.id === "string" && o.id ? o.id : fallback.id,
    name: typeof o.name === "string" && o.name ? o.name : fallback.name,
    apiFormat: o.apiFormat === "anthropic" || o.apiFormat === "gemini" ? o.apiFormat : "openai",
    custom: o.custom === true,
    enabled: typeof o.enabled === "boolean" ? o.enabled : fallback.enabled,
    apiKey: typeof o.apiKey === "string" ? o.apiKey : "",
    baseUrl: typeof o.baseUrl === "string" && (o.baseUrl as string).trim()
      ? (o.baseUrl as string).trim() : fallback.baseUrl,
    requestMode: o.requestMode === "proxy" ? "proxy" : "direct",
    models,
  };
}

/** v1（Record<ApiFormat>）→ v2（动态表）迁移 */
function migrateV1(raw: unknown): ProviderState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, Record<string, unknown>>;
  const d = builtinDefaults();
  let found = false;
  for (const b of BUILTINS) {
    const o = r[b.id];
    if (!o || typeof o !== "object") continue;
    found = true;
    d[b.id] = sanitizeSettings({ ...o, id: b.id, name: b.name, apiFormat: b.apiFormat, custom: false }, d[b.id]);
  }
  return found ? d : null;
}

function sanitize(raw: unknown): ProviderState {
  const d = builtinDefaults();
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Record<string, unknown>;
  const out: ProviderState = { ...d };
  for (const [id, o] of Object.entries(r)) {
    if (!o || typeof o !== "object") continue;
    const isBuiltin = BUILTINS.some((b) => b.id === id);
    const fallback: ProviderSettings = out[id] ?? {
      id, name: id, apiFormat: "openai", custom: true,
      enabled: false, apiKey: "", baseUrl: "", requestMode: "direct", models: [],
    };
    const s = sanitizeSettings({ ...(o as object), id, custom: !isBuiltin }, fallback);
    // 内置供应商的 id/name/format/custom 不可篡改
    if (isBuiltin) {
      const b = BUILTINS.find((x) => x.id === id)!;
      s.id = b.id; s.name = b.name; s.apiFormat = b.apiFormat; s.custom = false;
    }
    out[id] = s;
  }
  return out;
}

export function loadProviders(): ProviderState {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return sanitize(JSON.parse(raw));
    // v1 迁移
    const v1raw = localStorage.getItem(LS_KEY_V1);
    if (v1raw) {
      const migrated = migrateV1(JSON.parse(v1raw));
      if (migrated) {
        localStorage.setItem(LS_KEY, JSON.stringify(migrated));
        return migrated;
      }
    }
  } catch { /* 忽略 */ }
  return builtinDefaults();
}

export function saveProviders(s: ProviderState): void {
  localStorage.setItem(LS_KEY, JSON.stringify(s));
}

export interface ActiveModel { provider: string; model: string; }

/** 所有已启用 provider 的已启用模型（聊天模型选择器用） */
export function enabledModels(s: ProviderState): ActiveModel[] {
  const out: ActiveModel[] = [];
  for (const p of Object.values(s)) {
    if (!p.enabled) continue;
    for (const m of p.models) {
      if (m.enabled) out.push({ provider: p.id, model: m.id });
    }
  }
  return out;
}

export function providerName(s: ProviderState, id: string): string {
  return s[id]?.name ?? id;
}

export function providerFormat(s: ProviderState, id: string): ApiFormat {
  return s[id]?.apiFormat ?? "openai";
}

export function hasKey(s: ProviderState, provider: string): boolean {
  return (s[provider]?.apiKey?.length ?? 0) >= 8;
}

/** 新建自定义供应商（OpenAI 兼容） */
export function createCustomProvider(name: string, baseUrl: string): ProviderSettings {
  const id = `custom-${Date.now().toString(36)}${Math.floor(Math.random() * 0xffffff).toString(36)}`;
  return {
    id,
    name: name.trim() || "自定义",
    apiFormat: "openai",
    custom: true,
    enabled: true,
    apiKey: "",
    baseUrl: baseUrl.trim().replace(/\/+$/, ""),
    requestMode: "direct",
    models: [],
  };
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

export interface FetchResult {
  ok: boolean;
  fetched?: number;
  added?: number;
  error?: string;
}

/** 拉取上游模型列表：代理模式走后端中转（绕开浏览器 CORS），直连模式浏览器直调 */
async function listModelsSmart(p: ProviderSettings): Promise<string[]> {
  if (p.requestMode === "proxy") {
    try {
      const r = await api.providerModels(p.apiFormat, p.baseUrl, p.apiKey.trim() || undefined);
      return r.models;
    } catch (e) {
      throw new Error(e instanceof ApiError ? e.message : "拉取失败");
    }
  }
  return listModels(p.apiFormat, p.baseUrl, p.apiKey.trim());
}

/**
 * LobeChat 方式拉取模型列表并合并：
 * 新模型追加为启用状态，已有模型保留原有的启用/禁用与自定义标记。
 */
export async function fetchAndMergeModels(
  s: ProviderState, providerId: string
): Promise<{ state: ProviderState; result: FetchResult }> {
  const p = s[providerId];
  if (!p) return { state: s, result: { ok: false, error: "供应商不存在" } };
  let models: string[];
  try {
    models = await listModelsSmart(p);
  } catch (e) {
    return { state: s, result: { ok: false, error: e instanceof Error ? e.message : "拉取失败" } };
  }
  const existing = new Map(p.models.map((m) => [m.id, m]));
  let added = 0;
  const merged: ProviderModel[] = p.models.slice();
  for (const id of models) {
    if (!existing.has(id)) {
      merged.push({ id, enabled: true, custom: false });
      added++;
    }
  }
  const next = { ...s, [providerId]: { ...p, models: merged } };
  return { state: next, result: { ok: true, fetched: models.length, added } };
}

export interface CheckResult {
  ok: boolean;
  models?: string[];
  error?: string;
}

/** 检查连接：拉取上游模型列表（代理模式走后端中转，直连模式浏览器直调） */
export async function checkConnection(
  p: ProviderSettings
): Promise<CheckResult> {
  try {
    const models = await listModelsSmart(p);
    return { ok: true, models };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "连接失败" };
  }
}
