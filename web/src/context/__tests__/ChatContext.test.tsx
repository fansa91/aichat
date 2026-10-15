import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, act } from "@testing-library/react";
import { ChatProvider, useChat } from "../ChatContext";

vi.mock("../../lib/api", () => ({
  api: {
    conversations: vi.fn(),
    messages: vi.fn(),
    createConversation: vi.fn(),
    deleteConversation: vi.fn(),
    patchConversation: vi.fn(),
    postMessage: vi.fn(),
    chatProxy: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
}));

import type { ProviderState } from "../../lib/providers";

const providerState = (): ProviderState => ({
  openai: {
    id: "openai", name: "OpenAI", apiFormat: "openai", custom: false,
    enabled: true, apiKey: "sk-test-key", baseUrl: "https://api.openai.com/v1",
    requestMode: "proxy",
    models: [{ id: "gpt-4o", enabled: true, custom: false }],
  },
  anthropic: {
    id: "anthropic", name: "Anthropic", apiFormat: "anthropic", custom: false,
    enabled: false, apiKey: "", baseUrl: "https://api.anthropic.com",
    requestMode: "direct", models: [],
  },
  gemini: {
    id: "gemini", name: "Google", apiFormat: "gemini", custom: false,
    enabled: false, apiKey: "", baseUrl: "https://generativelanguage.googleapis.com",
    requestMode: "direct", models: [],
  },
});

vi.mock("../../lib/providers", () => ({
  loadProviders: vi.fn(),
  saveProviders: vi.fn(),
  enabledModels: vi.fn((s: any) =>
    (Object.keys(s) as Array<"openai" | "anthropic" | "gemini">).flatMap((p) =>
      s[p].enabled ? s[p].models.filter((m: any) => m.enabled).map((m: any) => ({ provider: p, model: m.id })) : []
    )
  ),
  hasKey: vi.fn((s: any, p: string) => (s[p].apiKey?.length ?? 0) >= 8),
  providerFormat: vi.fn((s: any, p: string) => s[p]?.apiFormat ?? "openai"),
  loadActiveModel: vi.fn(),
  saveActiveModel: vi.fn(),
  providerName: vi.fn((p: string) => p),
}));

vi.mock("../../lib/modelClient", () => ({
  streamDirect: vi.fn(),
  streamProxied: vi.fn(),
  completeDirect: vi.fn(),
}));

import { api } from "../../lib/api";
import { loadProviders, loadActiveModel } from "../../lib/providers";
import { streamProxied, streamDirect, completeDirect } from "../../lib/modelClient";

const conv = {
  id: "conv1", title: "新会话", model_config_id: null,
  provider: "openai", model: "gpt-4o",
  request_mode: "proxy", created_at: "", updated_at: "",
};

// 探针组件：把 context 暴露给测试
let ctx: ReturnType<typeof useChat> | null = null;
function Probe() {
  ctx = useChat();
  return null;
}

describe("ChatContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ctx = null;
    localStorage.clear();
    vi.mocked(loadProviders).mockReturnValue(providerState());
    vi.mocked(loadActiveModel).mockReturnValue({ provider: "openai", model: "gpt-4o" });
    vi.mocked(api.conversations).mockResolvedValue({ items: [conv], page: 1, per_page: 50, total: 1 } as any);
    vi.mocked(api.messages).mockResolvedValue({ items: [], has_more: false } as any);
  });

  it("挂载时加载会话与 provider 配置", async () => {
    render(<ChatProvider><Probe /></ChatProvider>);
    await waitFor(() => expect(ctx?.conversations).toHaveLength(1));
    expect(ctx?.providers.openai.enabled).toBe(true);
    expect(ctx?.activeModel).toEqual({ provider: "openai", model: "gpt-4o" });
    expect(ctx?.keyMissing).toBe(false);
  });

  it("无 Key 时 keyMissing 为 true", async () => {
    const s = providerState();
    s.openai.apiKey = "";
    vi.mocked(loadProviders).mockReturnValue(s);
    render(<ChatProvider><Probe /></ChatProvider>);
    await waitFor(() => expect(ctx?.conversations).toHaveLength(1));
    expect(ctx?.keyMissing).toBe(true);
  });

  it("send() 代理模式：乐观消息 → 流式增量 → 服务端刷新", async () => {
    const persisted = [
      { id: 1, role: "user", content_type: "text", content: "你好", tokens_in: null, tokens_out: null, created_at: "" },
      { id: 2, role: "assistant", content_type: "text", content: "你好呀", tokens_in: 1, tokens_out: 2, created_at: "" },
    ];
    vi.mocked(api.messages).mockResolvedValue({ items: persisted, has_more: false } as any);
    vi.mocked(api.chatProxy).mockResolvedValue(new Response("x"));
    vi.mocked(streamProxied).mockImplementation(async (_res, ev: any) => {
      ev.onText("你好");
      ev.onText("呀");
      return { text: "你好呀" };
    });

    render(<ChatProvider><Probe /></ChatProvider>);
    await waitFor(() => expect(ctx?.conversations).toHaveLength(1));

    await act(async () => {
      ctx!.selectConversation("conv1");
    });
    await waitFor(() => expect(api.messages).toHaveBeenCalled());

    await act(async () => {
      await ctx!.send("你好", []);
    });

    // 代理模式：chatProxy 被调用，附带 provider 参数
    expect(api.chatProxy).toHaveBeenCalledWith(
      "conv1", "你好", "text", "sk-test-key",
      { api_format: "openai", base_url: "https://api.openai.com/v1", model: "gpt-4o" },
    );
    expect(streamProxied).toHaveBeenCalled();
    // 流结束后用服务端状态刷新
    await waitFor(() => {
      expect(ctx?.messages).toHaveLength(2);
      expect(ctx?.messages[1].content).toBe("你好呀");
    });
    expect(ctx?.streaming).toBe(false);
  });

  it("send() 无 Key 时抛错", async () => {
    const s = providerState();
    s.openai.apiKey = "";
    vi.mocked(loadProviders).mockReturnValue(s);
    render(<ChatProvider><Probe /></ChatProvider>);
    await waitFor(() => expect(ctx?.conversations).toHaveLength(1));
    await act(async () => { ctx!.selectConversation("conv1"); });
    await expect(act(async () => { await ctx!.send("你好", []); })).rejects.toThrow("API Key");
  });

  it("send() 直连模式：流式 → 前端落库两条消息 → 首轮自动标题", async () => {
    const s = providerState();
    s.openai.requestMode = "direct";
    vi.mocked(loadProviders).mockReturnValue(s);
    const persisted = [
      { id: 1, role: "user", content_type: "text", content: "你好", tokens_in: null, tokens_out: null, created_at: "" },
      { id: 2, role: "assistant", content_type: "text", content: "你好呀", tokens_in: 5, tokens_out: 6, created_at: "" },
    ];
    vi.mocked(api.messages).mockResolvedValue({ items: persisted, has_more: false } as any);
    vi.mocked(streamDirect).mockImplementation(async (_c, _k, _s, _h, ev: any) => {
      ev.onText("你好呀");
      return { text: "你好呀", input: 5, output: 6 };
    });
    vi.mocked(api.postMessage).mockImplementation(async (_id, body: any) =>
      ({ id: Math.random(), role: body.role, content_type: "text", content: body.content, tokens_in: null, tokens_out: null, created_at: "" } as any));
    vi.mocked(completeDirect).mockResolvedValue("打招呼");
    vi.mocked(api.patchConversation).mockImplementation(async (id: string, title: string) =>
      ({ ...conv, title } as any));

    render(<ChatProvider><Probe /></ChatProvider>);
    await waitFor(() => expect(ctx?.conversations).toHaveLength(1));
    await act(async () => { ctx!.selectConversation("conv1"); });

    await act(async () => { await ctx!.send("你好", []); });

    expect(streamDirect).toHaveBeenCalled();
    const callArg = vi.mocked(streamDirect).mock.calls[0][0] as any;
    expect(callArg.api_format).toBe("openai");
    expect(callArg.model).toBe("gpt-4o");
    // 直连模式前端负责落库：user + assistant 各一条
    expect(vi.mocked(api.postMessage).mock.calls.filter((c) => c[1].role === "user")).toHaveLength(1);
    expect(vi.mocked(api.postMessage).mock.calls.filter((c) => c[1].role === "assistant")).toHaveLength(1);
    // 首轮标题自动生成
    expect(completeDirect).toHaveBeenCalled();
    expect(api.patchConversation).toHaveBeenCalledWith("conv1", "打招呼");
    await waitFor(() => expect(ctx?.messages[1].content).toBe("你好呀"));
  });

  it("selectModel 切换模型并持久化", async () => {
    render(<ChatProvider><Probe /></ChatProvider>);
    await waitFor(() => expect(ctx?.conversations).toHaveLength(1));
    await act(async () => {
      ctx!.selectModel({ provider: "openai", model: "gpt-4o" });
    });
    expect(ctx?.activeModel).toEqual({ provider: "openai", model: "gpt-4o" });
  });
});
