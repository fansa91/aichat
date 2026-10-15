import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, act } from "@testing-library/react";
import { ChatProvider, useChat } from "../ChatContext";

vi.mock("../../lib/api", () => ({
  api: {
    modelConfigs: vi.fn(),
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

vi.mock("../../lib/byok", () => ({
  byok: { get: vi.fn(), has: vi.fn(), set: vi.fn(), remove: vi.fn() },
}));

vi.mock("../../lib/modelClient", () => ({
  streamDirect: vi.fn(),
  streamProxied: vi.fn(),
  completeDirect: vi.fn(),
}));

import { api } from "../../lib/api";
import { byok } from "../../lib/byok";
import { streamProxied, streamDirect, completeDirect } from "../../lib/modelClient";

const cfg = {
  id: "cfg1", name: "测试", base_url: "http://x", model: "gpt-4o",
  api_format: "openai", temperature: null, max_tokens: null,
  system_prompt: null, request_mode: "proxy", is_default: 1,
  created_at: "", updated_at: "",
};
const conv = {
  id: "conv1", title: "新会话", model_config_id: "cfg1",
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
    vi.mocked(api.modelConfigs).mockResolvedValue({ items: [cfg] } as any);
    vi.mocked(api.conversations).mockResolvedValue({ items: [conv], page: 1, per_page: 50, total: 1 } as any);
    vi.mocked(api.messages).mockResolvedValue({ items: [], has_more: false } as any);
    vi.mocked(byok.get).mockReturnValue("sk-test");
    vi.mocked(byok.has).mockReturnValue(true);
  });

  it("挂载时加载会话与模型配置", async () => {
    render(<ChatProvider><Probe /></ChatProvider>);
    await waitFor(() => expect(ctx?.conversations).toHaveLength(1));
    expect(ctx?.configs).toHaveLength(1);
    expect(ctx?.activeConfig?.id).toBe("cfg1");
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

    // 代理模式：chatProxy 被调用，Key 通过参数传递
    expect(api.chatProxy).toHaveBeenCalledWith("conv1", "你好", "text", "sk-test");
    expect(streamProxied).toHaveBeenCalled();
    // 流结束后用服务端状态刷新
    await waitFor(() => {
      expect(ctx?.messages).toHaveLength(2);
      expect(ctx?.messages[1].content).toBe("你好呀");
    });
    expect(ctx?.streaming).toBe(false);
  });

  it("send() 无 Key 时抛错", async () => {
    vi.mocked(byok.get).mockReturnValue(null);
    render(<ChatProvider><Probe /></ChatProvider>);
    await waitFor(() => expect(ctx?.conversations).toHaveLength(1));
    await act(async () => { ctx!.selectConversation("conv1"); });
    await expect(act(async () => { await ctx!.send("你好", []); })).rejects.toThrow("API Key");
  });

  it("send() 直连模式：流式 → 前端落库两条消息 → 首轮自动标题", async () => {
    const directCfg = { ...cfg, request_mode: "direct" };
    const directConv = { ...conv, request_mode: "direct" };
    vi.mocked(api.modelConfigs).mockResolvedValue({ items: [directCfg] } as any);
    vi.mocked(api.conversations).mockResolvedValue({ items: [directConv], page: 1, per_page: 50, total: 1 } as any);
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
      ({ ...directConv, title } as any));

    render(<ChatProvider><Probe /></ChatProvider>);
    await waitFor(() => expect(ctx?.conversations).toHaveLength(1));
    await act(async () => { ctx!.selectConversation("conv1"); });

    await act(async () => { await ctx!.send("你好", []); });

    expect(streamDirect).toHaveBeenCalled();
    // 直连模式前端负责落库：user + assistant 各一条
    expect(vi.mocked(api.postMessage).mock.calls.filter((c) => c[1].role === "user")).toHaveLength(1);
    expect(vi.mocked(api.postMessage).mock.calls.filter((c) => c[1].role === "assistant")).toHaveLength(1);
    // 首轮标题自动生成
    expect(completeDirect).toHaveBeenCalled();
    expect(api.patchConversation).toHaveBeenCalledWith("conv1", "打招呼");
    await waitFor(() => expect(ctx?.messages[1].content).toBe("你好呀"));
  });
});
