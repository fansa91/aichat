import { describe, it, expect, beforeEach } from "vitest";
import {
  loadProviders, saveProviders, enabledModels, providerName, hasKey,
  loadActiveModel, saveActiveModel, PROVIDERS,
} from "./providers";

describe("providers", () => {
  beforeEach(() => { localStorage.clear(); });

  it("默认只有 OpenAI 启用", () => {
    const s = loadProviders();
    expect(s.openai.enabled).toBe(true);
    expect(s.anthropic.enabled).toBe(false);
    expect(s.gemini.enabled).toBe(false);
    expect(s.openai.models.length).toBeGreaterThan(0);
    expect(s.openai.models.every((m) => m.enabled)).toBe(true);
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

  it("损坏的存储回退到默认值", () => {
    localStorage.setItem("aichat_providers_v1", "{bad json");
    expect(loadProviders().openai.enabled).toBe(true);
    localStorage.setItem("aichat_providers_v1", JSON.stringify({ openai: { enabled: "yes" } }));
    expect(loadProviders().openai.enabled).toBe(true); // 非法值被忽略
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

  it("hasKey 按长度判断", () => {
    const s = loadProviders();
    expect(hasKey(s, "openai")).toBe(false);
    s.openai.apiKey = "short";
    expect(hasKey(s, "openai")).toBe(false);
    s.openai.apiKey = "sk-12345678";
    expect(hasKey(s, "openai")).toBe(true);
  });

  it("loadActiveModel 优先恢复上次选择，无效时回退第一个", () => {
    const s = loadProviders();
    expect(loadActiveModel(s)).toEqual({ provider: "openai", model: s.openai.models[0].id });
    saveActiveModel({ provider: "openai", model: s.openai.models[2].id });
    expect(loadActiveModel(s)).toEqual({ provider: "openai", model: s.openai.models[2].id });
    // 模型被禁用后回退
    s.openai.models[2].enabled = false;
    saveProviders(s);
    const r = loadActiveModel(s);
    expect(r?.model).not.toBe(s.openai.models[2].id);
  });

  it("providerName", () => {
    expect(providerName("openai")).toBe("OpenAI");
    expect(PROVIDERS.map((p) => p.id)).toEqual(["openai", "anthropic", "gemini"]);
  });
});
