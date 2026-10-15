import * as React from "react";
import { api } from "../lib/api";
import { byok } from "../lib/byok";
import { completeDirect, streamDirect, streamProxied } from "../lib/modelClient";
import type {
  CanonicalPart, Conversation, HistoryItem, Message, ModelConfig,
} from "../lib/types";

function toHistoryItems(messages: Message[]): HistoryItem[] {
  return messages
    .filter((m) => m.role !== "system" || true)
    .map((m) => ({
      role: m.role,
      parts: m.content_type === "parts"
        ? (JSON.parse(m.content) as CanonicalPart[])
        : [{ type: "text", text: m.content } as CanonicalPart],
    }));
}

function partsText(parts: CanonicalPart[]): string {
  return parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("");
}

interface ChatCtxValue {
  conversations: Conversation[];
  activeId: string | null;
  messages: Message[];
  hasMore: boolean;
  loadingMsgs: boolean;
  streaming: boolean;
  configs: ModelConfig[];
  activeConfig: ModelConfig | null;
  refreshConfigs: () => Promise<void>;
  selectConversation: (id: string | null) => void;
  newConversation: () => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  loadMore: () => Promise<void>;
  send: (text: string, imageDataUrls: string[]) => Promise<void>;
  stop: () => void;
}

const Ctx = React.createContext<ChatCtxValue | null>(null);

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [conversations, setConversations] = React.useState<Conversation[]>([]);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [hasMore, setHasMore] = React.useState(false);
  const [loadingMsgs, setLoadingMsgs] = React.useState(false);
  const [streaming, setStreaming] = React.useState(false);
  const [configs, setConfigs] = React.useState<ModelConfig[]>([]);
  const abortRef = React.useRef<AbortController | null>(null);
  const activeIdRef = React.useRef<string | null>(null);
  activeIdRef.current = activeId;

  const refreshConfigs = React.useCallback(async () => {
    const r = await api.modelConfigs();
    setConfigs(r.items);
  }, []);

  const refreshConversations = React.useCallback(async () => {
    const r = await api.conversations(1, 50);
    setConversations(r.items);
  }, []);

  React.useEffect(() => {
    refreshConfigs().catch(() => {});
    refreshConversations().catch(() => {});
  }, [refreshConfigs, refreshConversations]);

  const activeConfig: ModelConfig | null = React.useMemo(() => {
    const conv = conversations.find((c) => c.id === activeId);
    if (conv?.model_config_id) return configs.find((c) => c.id === conv.model_config_id) ?? null;
    return configs.find((c) => c.is_default === 1) ?? configs[0] ?? null;
  }, [conversations, configs, activeId]);

  const loadMessages = React.useCallback(async (convId: string, beforeId?: number) => {
    setLoadingMsgs(true);
    try {
      const r = await api.messages(convId, 50, beforeId);
      setMessages((prev) => {
        const merged = beforeId ? [...r.items, ...prev] : r.items;
        const seen = new Set<number>();
        return merged.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
      });
      setHasMore(r.has_more);
    } finally {
      setLoadingMsgs(false);
    }
  }, []);

  const selectConversation = React.useCallback((id: string | null) => {
    setActiveId(id);
    setMessages([]);
    setHasMore(false);
    if (id) loadMessages(id).catch(() => {});
  }, [loadMessages]);

  const newConversation = React.useCallback(async () => {
    const c = await api.createConversation({});
    await refreshConversations();
    selectConversation(c.id);
  }, [refreshConversations, selectConversation]);

  const deleteConversation = React.useCallback(async (id: string) => {
    await api.deleteConversation(id);
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeIdRef.current === id) selectConversation(null);
  }, [selectConversation]);

  const renameConversation = React.useCallback(async (id: string, title: string) => {
    const c = await api.patchConversation(id, title);
    setConversations((prev) => prev.map((x) => (x.id === id ? c : x)));
  }, []);

  const loadMore = React.useCallback(async () => {
    if (!activeId || messages.length === 0) return;
    await loadMessages(activeId, messages[0].id);
  }, [activeId, messages, loadMessages]);

  const stop = React.useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const send = React.useCallback(async (text: string, imageDataUrls: string[]) => {
    const cfg = activeConfig;
    if (!cfg || !activeId) return;
    const key = byok.get(cfg.id);
    if (!key) throw new Error("请先在设置中为该模型配置填写 API Key");

    const parts: CanonicalPart[] = [];
    if (text.trim()) parts.push({ type: "text", text: text.trim() });
    for (const url of imageDataUrls) parts.push({ type: "image_url", image_url: { url } });
    if (parts.length === 0) return;
    const isParts = imageDataUrls.length > 0;
    const content = isParts ? JSON.stringify(parts) : text.trim();

    const controller = new AbortController();
    abortRef.current = controller;
    setStreaming(true);

    // 乐观插入用户消息与空助手消息
    const tmpUserId = -Date.now();
    const tmpAsstId = -Date.now() - 1;
    const now = new Date().toISOString();
    setMessages((prev) => [
      ...prev,
      { id: tmpUserId, role: "user", content_type: isParts ? "parts" : "text", content, tokens_in: null, tokens_out: null, created_at: now },
      { id: tmpAsstId, role: "assistant", content_type: "text", content: "", tokens_in: null, tokens_out: null, created_at: now },
    ]);

    const history = toHistoryItems(messages).slice(-30);
    history.push({ role: "user", parts });

    try {
      if (cfg.request_mode === "proxy") {
        const res = await api.chatProxy(activeId, content, isParts ? "parts" : "text", key);
        await streamProxied(res, {
          signal: controller.signal,
          onText: (t) => setMessages((prev) => prev.map((m) => (m.id === tmpAsstId ? { ...m, content: m.content + t } : m))),
        });
        // 代理模式后端已落库：用服务端状态刷新
        await loadMessages(activeId);
      } else {
        let acc = "";
        await streamDirect(cfg, key, cfg.system_prompt ?? "", history, {
          signal: controller.signal,
          onText: (t) => {
            acc += t;
            setMessages((prev) => prev.map((m) => (m.id === tmpAsstId ? { ...m, content: acc } : m)));
          },
        });
        // 直连模式：前端负责落库
        await api.postMessage(activeId, { role: "user", content, content_type: isParts ? "parts" : "text" });
        await api.postMessage(activeId, { role: "assistant", content: acc });
        await loadMessages(activeId);
        // 首轮标题自动生成
        const conv = conversations.find((c) => c.id === activeId);
        if (conv && conv.title === "新会话") {
          try {
            const title = (
              await completeDirect(cfg, key, "你是一个标题生成器。",
                `用不超过20个字为以下对话生成一个简短标题，只返回标题本身：\n\n${partsText(parts).slice(0, 500)}\n${acc.slice(0, 500)}`)
            ).trim().slice(0, 60);
            if (title) {
              const updated = await api.patchConversation(activeId, title);
              setConversations((prev) => prev.map((c) => (c.id === activeId ? updated : c)));
            }
          } catch { /* 标题失败不影响主流程 */ }
        }
      }
      await refreshConversations();
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [activeConfig, activeId, messages, conversations, loadMessages, refreshConversations]);

  const value: ChatCtxValue = {
    conversations, activeId, messages, hasMore, loadingMsgs, streaming,
    configs, activeConfig, refreshConfigs,
    selectConversation, newConversation, deleteConversation, renameConversation,
    loadMore, send, stop,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useChat(): ChatCtxValue {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error("useChat must be used within ChatProvider");
  return ctx;
}
