// 新版设置页 / 聊天页 SSR 烟测：确认 provider 卡片、模型选择器、移动端结构可渲染
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../../context/ChatContext", () => {
  const providers = {
    openai: {
      enabled: true, apiKey: "sk-test", baseUrl: "https://api.openai.com/v1",
      requestMode: "direct",
      models: [
        { id: "gpt-4o", enabled: true, custom: false },
        { id: "my-model", enabled: false, custom: true },
      ],
    },
    anthropic: { enabled: false, apiKey: "", baseUrl: "https://api.anthropic.com", requestMode: "direct", models: [] },
    gemini: { enabled: false, apiKey: "", baseUrl: "https://x", requestMode: "direct", models: [] },
  };
  return {
    useChat: () => ({
      providers,
      activeModel: { provider: "openai", model: "gpt-4o" },
      selectModel: vi.fn(),
      refreshProviders: vi.fn(),
      keyMissing: false,
      conversations: [], activeId: null, messages: [], hasMore: false,
      loadingMsgs: false, streaming: false, activeRequestMode: "direct",
      selectConversation: vi.fn(), newConversation: vi.fn(), deleteConversation: vi.fn(),
      renameConversation: vi.fn(), loadMore: vi.fn(), send: vi.fn(), stop: vi.fn(),
    }),
  };
});

vi.mock("../lib/api", () => ({
  api: { keys: vi.fn().mockResolvedValue({ items: [] }), createKey: vi.fn(), deleteKey: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: { username: "u" }, logout: vi.fn() }),
}));

import { SettingsPage } from "../SettingsPage";

describe("SettingsPage 烟测", () => {
  beforeEach(() => { localStorage.clear(); });

  it("渲染三个 provider 卡片", () => {
    render(<SettingsPage onClose={() => {}} />);
    expect(screen.getAllByText("OpenAI").length).toBeGreaterThan(0);
    expect(screen.getByText("Anthropic")).toBeTruthy();
    expect(screen.getByText("Google")).toBeTruthy();
  });

  it("展开 OpenAI 显示 Key/BaseURL/模型列表与添加框", () => {
    render(<SettingsPage onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText("展开 OpenAI 配置"));
    expect(screen.getByPlaceholderText("sk-…")).toBeTruthy();
    expect(screen.getByPlaceholderText("输入模型 ID，如 gpt-4o")).toBeTruthy();
    expect(screen.getAllByText("gpt-4o").length).toBeGreaterThan(0);
    expect(screen.getByText("my-model")).toBeTruthy();
    expect(screen.getByText("检查连接")).toBeTruthy();
  });

  it("移动端样式类存在（全屏容器）", () => {
    const { container } = render(<SettingsPage onClose={() => {}} />);
    const modal = container.querySelector(".z-10.flex.h-full");
    expect(modal?.className).toContain("sm:rounded-lg");
    expect(modal?.className).toContain("sm:max-w-2xl");
  });
});
