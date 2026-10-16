import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  loadProviders, saveProviders, enabledModels, providerName, providerFormat, hasKey,
  loadActiveModel, saveActiveModel, createCustomProvider, fetchAndMergeModels, fetchModelIds,
  mergeSelectedModels, BUILTINS,
} from "./providers";
import * as modelClient from "./modelClient";

describe("providers", () => {
  beforeEach(() => { localStorage.clear(); });

  it("默认只有 OpenAI 启用，三个内置供应商", () => {
    const s = loadProviders();
    expect(Object.keys(s)).toHaveLength(3);
    expect(s.openai.enabled).toBe(true);
    expect(s.anthropic.enabled).toBe(false);
    expect(s.openai.apiFormat).toBe("openai");
    expect(s.anthropic.apiFormat).toBe("anthropic");
    expect(s.openai.models.length).toBeGreaterThan(0);
  });

  it("save/load 往返", () => {
    const s = loadProviders();
    s.anthropic.enabled = true;
    s.anthropic.apiKey = "sk-ant-test-key";
    s.anthropic.models[0].enabled = false;
    s.openai.models.push({ id: "my-custom", enabled: true, custom: true });
    saveProviders(s);
    const s2 = loadProviders();
    expect(s2.anthropic.enabled).toBe(true);
    expect(s2.anthropic.apiKey).toBe("sk-ant-test-key");
    expect(s2.anthropic.models[0].enabled).toBe(false);
    expect(s2.openai.models.some((m) => m.id === "my-custom" && m.custom)).toBe(true);
  });

  it("v1 迁移到 v2", () => {
    localStorage.setItem("aichat_providers_v1", JSON.stringify({
      openai: { enabled: true, apiKey: "sk-old", baseUrl: "https://x/v1", requestMode: "proxy", models: [{ id: "gpt-4o", enabled: true, custom: false }] },
      anthropic: { enabled: false },
    }));
    const s = loadProviders();
    expect(s.openai.apiKey).toBe("sk-old");
    expect(s.openai.requestMode).toBe("proxy");
    expect(s.openai.apiFormat).toBe("openai");
    expect(s.openai.custom).toBe(false);
    expect(s.openai.models).toHaveLength(1);
    expect(s.gemini).toBeTruthy();
    // 迁移后写入 v2 key
    expect(localStorage.getItem("aichat_providers_v2")).toBeTruthy();
  });

  it("损坏的存储回退到默认值", () => {
    localStorage.setItem("aichat_providers_v2", "{bad json");
    expect(loadProviders().openai.enabled).toBe(true);
  });

  it("enabledModels 只返回启用项", () => {
    const s = loadProviders();
    s.anthropic.enabled = true;
    s.anthropic.models[0].enabled = false;
    const list = enabledModels(s);
    expect(list.filter((m) => m.provider === "anthropic")).toHaveLength(s.anthropic.models.length - 1);
    expect(list.filter((m) => m.provider === "openai")).toHaveLength(s.openai.models.length);
    expect(list.every((m) => m.provider !== "gemini")).toBe(true);
  });

  it("hasKey / providerName / providerFormat", () => {
    const s = loadProviders();
    expect(hasKey(s, "openai")).toBe(false);
    s.openai.apiKey = "sk-12345678";
    expect(hasKey(s, "openai")).toBe(true);
    expect(providerName(s, "openai")).toBe("OpenAI");
    expect(providerFormat(s, "openai")).toBe("openai");
    expect(providerName(s, "nope")).toBe("nope");
    expect(providerFormat(s, "nope")).toBe("openai");
  });

  it("createCustomProvider", () => {
    const p = createCustomProvider("DeepSeek", "https://api.deepseek.com/v1/");
    expect(p.id.startsWith("custom-")).toBe(true);
    expect(p.name).toBe("DeepSeek");
    expect(p.apiFormat).toBe("openai");
    expect(p.custom).toBe(true);
    expect(p.enabled).toBe(true);
    expect(p.baseUrl).toBe("https://api.deepseek.com/v1");
    expect(p.models).toEqual([]);
  });

  it("fetchAndMergeModels 合并拉取结果（保留已有状态）", async () => {
    vi.spyOn(modelClient, "listModels").mockResolvedValue(["gpt-4o", "gpt-4o-new"]);
    const s = loadProviders();
    s.openai.models = [
      { id: "gpt-4o", enabled: false, custom: false },
      { id: "my-local", enabled: true, custom: true },
    ];
    const { state, result } = await fetchAndMergeModels(s, "openai");
    expect(result.ok).toBe(true);
    expect(result.fetched).toBe(2);
    expect(result.added).toBe(1);
    const models = state.openai.models;
    expect(models.find((m) => m.id === "gpt-4o")?.enabled).toBe(false); // 保留禁用
    expect(models.find((m) => m.id === "my-local")?.custom).toBe(true); // 保留自定义
    expect(models.find((m) => m.id === "gpt-4o-new")?.enabled).toBe(true); // 新增默认启用
    vi.restoreAllMocks();
  });

  it("fetchAndMergeModels 拉取失败", async () => {
    vi.spyOn(modelClient, "listModels").mockRejectedValue(new Error("nope"));
    const s = loadProviders();
    const { state, result } = await fetchAndMergeModels(s, "openai");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("nope");
    expect(state).toBe(s);
    vi.restoreAllMocks();
  });

  it("fetchModelIds 只拉取不合并", async () => {
    vi.spyOn(modelClient, "listModels").mockResolvedValue(["a", "b"]);
    const s = loadProviders();
    const before = s.openai.models.length;
    const r = await fetchModelIds(s, "openai");
    expect(r).toEqual({ ok: true, models: ["a", "b"] });
    // 原 state 不变
    expect(s.openai.models).toHaveLength(before);
    vi.restoreAllMocks();
  });

  it("mergeSelectedModels 只合并选中且去重", async () => {
    const s = loadProviders();
    s.openai.models = [
      { id: "gpt-4o", enabled: false, custom: false },
      { id: "my-local", enabled: true, custom: true },
    ];
    const { state, added } = mergeSelectedModels(s, "openai", ["gpt-4o", "new-model"]);
    expect(added).toBe(1);
    expect(state.openai.models).toHaveLength(3);
    expect(state.openai.models.find((m) => m.id === "gpt-4o")?.enabled).toBe(false);
    expect(state.openai.models.find((m) => m.id === "new-model")?.enabled).toBe(true);
  });

  it("fetchAndMergeModels 代理模式走后端中转", async () => {
    const listSpy = vi.spyOn(modelClient, "listModels");
    const { api } = await import("./api");
    const apiSpy = vi.spyOn(api, "providerModels").mockResolvedValue({ models: ["p1", "p2"] });
    const s = loadProviders();
    s.openai.requestMode = "proxy";
    s.openai.apiKey = "sk-proxy-key";
    const { state, result } = await fetchAndMergeModels(s, "openai");
    expect(result.ok).toBe(true);
    expect(result.fetched).toBe(2);
    expect(listSpy).not.toHaveBeenCalled();
    expect(apiSpy).toHaveBeenCalledWith("openai", s.openai.baseUrl, "sk-proxy-key");
    expect(state.openai.models.some((m) => m.id === "p1")).toBe(true);
    vi.restoreAllMocks();
  });

  it("loadActiveModel / saveActiveModel", () => {
    const s = loadProviders();
    expect(loadActiveModel(s)).toEqual({ provider: "openai", model: s.openai.models[0].id });
    saveActiveModel({ provider: "openai", model: s.openai.models[2].id });
    expect(loadActiveModel(s)).toEqual({ provider: "openai", model: s.openai.models[2].id });
    s.openai.models[2].enabled = false;
    saveProviders(s);
    expect(loadActiveModel(s)?.model).not.toBe(s.openai.models[2].id);
  });

  it("BUILTINS 保持三个", () => {
    expect(BUILTINS.map((b) => b.id)).toEqual(["openai", "anthropic", "gemini"]);
  });
});
