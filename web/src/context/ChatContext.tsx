import * as React from "react";
import { api } from "../lib/api";
import { completeDirect, streamDirect, streamProxied } from "../lib/modelClient";
import type { DirectCallParams } from "../lib/modelClient";
import {
  loadProviders, enabledModels, hasKey,
  loadActiveModel, saveActiveModel, providerName, providerFormat,
} from "../lib/providers";
import type { ActiveModel, ProviderState } from "../lib/providers";
import type {
  CanonicalPart, Conversation, HistoryItem, Message, RequestMode,
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
  providers: ProviderState;
  activeModel: ActiveModel | null;
  activeRequestMode: RequestMode;
  keyMissing: boolean;
  refreshProviders: () => void;
  selectModel: (m: ActiveModel) => void;
  selectConversation: (id: string | null) => void;
  newConversation: () => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  loadMore: () => Promise<void>;
  send: (text: string, imageDataUrls: string[], opts?: { resendFromId?: number; baseMessages?: Message[] }) => Promise<void>;
  editAndResend: (msgId: number, text: string, imageDataUrls: string[]) => Promise<void>;
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
  const [providers, setProviders] = React.useState<ProviderState>(() => loadProviders());
  const [activeModel, setActiveModel] = React.useState<ActiveModel | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  const activeIdRef = React.useRef<string | null>(null);
  activeIdRef.current = activeId;
  const providersRef = React.useRef(providers);
  providersRef.current = providers;
  const activeModelRef = React.useRef(activeModel);
  activeModelRef.current = activeModel;
  const sendRef = React.useRef<(text: string, imgs: string[], opts?: { resendFromId?: number; baseMessages?: Message[] }) => Promise<void>>(
    async () => {}
  );

  const refreshProviders = React.useCallback(() => {
    const s = loadProviders();
    setProviders(s);
    // 当前选择失效时回退；从未选择过则自动选中第一个可用模型
    setActiveModel((prev) => {
      const avail = enabledModels(s);
      if (prev && avail.some((m) => m.provider === prev.provider && m.model === prev.model)) return prev;
      const next = loadActiveModel(s) ?? avail[0] ?? null;
      if (next) saveActiveModel(next);
      return next;
    });
  }, []);

  const selectModel = React.useCallback((m: ActiveModel) => {
    setActiveModel(m);
    saveActiveModel(m);
  }, []);

  const refreshConversations = React.useCallback(async () => {
    const r = await api.conversations(1, 50);
    setConversations(r.items);
  }, []);

  React.useEffect(() => {
    refreshProviders();
    refreshConversations().catch(() => {});
  }, [refreshProviders, refreshConversations]);

  const activeRequestMode: RequestMode = activeModel
    ? providers[activeModel.provider]?.requestMode ?? "direct"
    : "direct";
  const keyMissing = !!activeModel && !hasKey(providers, activeModel.provider);

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
    const m = activeModelRef.current;
    const ps = providersRef.current;
    const c = await api.createConversation(m && ps[m.provider] ? {
      provider: providerFormat(ps, m.provider), model: m.model,
      request_mode: ps[m.provider].requestMode,
    } : {});
    await refreshConversations();
    selectConversation(c.id);
  }, [refreshConversations, selectConversation]);

  const deleteConversation = React.useCallback(async (id: string) => {
    await api.deleteConversation(id);
    setConversations((prev) => prev.filter((c) => (c.id === id ? false : true)));
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

  const send = React.useCallback(async (
    text: string, imageDataUrls: string[],
    opts?: { resendFromId?: number; baseMessages?: Message[] }
  ) => {
    const m = activeModelRef.current;
    const ps = providersRef.current;
    if (!m || !activeId) return;
    const p = ps[m.provider];
    if (!p) throw new Error("供应商配置不存在，请重新选择模型");
    const key = p.apiKey;
    if (!hasKey(ps, m.provider)) throw new Error(`请先在设置中为 ${providerName(ps, m.provider)} 填写 API Key`);

    const params: DirectCallParams = {
      api_format: providerFormat(ps, m.provider),
      base_url: p.baseUrl,
      model: m.model,
    };

    const parts: CanonicalPart[] = [];
    if (text.trim()) parts.push({ type: "text", text: text.trim() });
    for (const url of imageDataUrls) parts.push({ type: "image_url", image_url: { url } });
    if (parts.length === 0) return;
    const isParts = imageDataUrls.length > 0;
    const content = isParts ? JSON.stringify(parts) : text.trim();
    const resend = !!opts?.resendFromId;

    const controller = new AbortController();
    abortRef.current = controller;
    setStreaming(true);

    const now = new Date().toISOString();
    const tmpAsstId = -Date.now() - 1;
    if (resend) {
      // 编辑重发：用户消息已就地更新，只插入空助手消息占位
      setMessages((prev) => [
        ...prev,
        { id: tmpAsstId, role: "assistant", content_type: "text", content: "", model: m.model, tokens_in: null, tokens_out: null, created_at: now },
      ]);
    } else {
      // 乐观插入用户消息与空助手消息
      const tmpUserId = -Date.now();
      setMessages((prev) => [
        ...prev,
        { id: tmpUserId, role: "user", content_type: isParts ? "parts" : "text", content, tokens_in: null, tokens_out: null, created_at: now },
        { id: tmpAsstId, role: "assistant", content_type: "text", content: "", model: m.model, tokens_in: null, tokens_out: null, created_at: now },
      ]);
    }

    const history = toHistoryItems(opts?.baseMessages ?? messages).slice(-30);
    if (!resend) history.push({ role: "user", parts });
    // resend 时 baseMessages 已以编辑后的用户消息结尾，直接用作上下文

    try {
      if (p.requestMode === "proxy") {
        const res = await api.chatProxy(
          activeId, content, isParts ? "parts" : "text", key,
          { api_format: providerFormat(ps, m.provider), base_url: p.baseUrl, model: m.model },
          controller.signal,
        );
        await streamProxied(res, {
          signal: controller.signal,
          onText: (t) => setMessages((prev) => prev.map((x) => (x.id === tmpAsstId ? { ...x, content: x.content + t } : x))),
        });
        // 代理模式后端已落库：用服务端状态刷新
        await loadMessages(activeId);
      } else {
        let acc = "";
        try {
          await streamDirect(params, key, "", history, {
            signal: controller.signal,
            onText: (t) => {
              acc += t;
              setMessages((prev) => prev.map((x) => (x.id === tmpAsstId ? { ...x, content: acc } : x)));
            },
          });
        } catch (e) {
          // 用户主动中断：保留已收到的部分，不抛错
          if (!controller.signal.aborted) throw e;
        }
        if (!resend) {
          await api.postMessage(activeId, { role: "user", content, content_type: isParts ? "parts" : "text" });
        }
        // 中断且无输出时不写空助手消息
        if (acc || !controller.signal.aborted) {
          await api.postMessage(activeId, { role: "assistant", content: acc, content_type: "text", model: m.model });
        }
        await loadMessages(activeId);
        // 首轮标题自动生成（中断时跳过）
        const conv = conversations.find((c) => c.id === activeId);
        if (conv && conv.title === "新会话" && acc && !controller.signal.aborted) {
          try {
            const title = (
              await completeDirect(params, key, "你是一个标题生成器。",
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
  }, [activeId, messages, conversations, loadMessages, refreshConversations]);
  // editAndResend 通过 ref 调用 send，避免循环依赖
  sendRef.current = send;

  /** 重新编辑发送：更新指定用户消息、删除其后消息，然后从该处重新生成 */
  const editAndResend = React.useCallback(async (msgId: number, text: string, imageDataUrls: string[]) => {
    if (!activeId || msgId <= 0) return;
    const parts: CanonicalPart[] = [];
    if (text.trim()) parts.push({ type: "text", text: text.trim() });
    for (const url of imageDataUrls) parts.push({ type: "image_url", image_url: { url } });
    if (parts.length === 0) return;
    const isParts = imageDataUrls.length > 0;
    const content = isParts ? JSON.stringify(parts) : text.trim();
    await api.patchMessage(activeId, msgId, content, isParts ? "parts" : "text");
    // 显式构造新消息数组（避免闭包读到旧 messages）
    const baseMessages = (() => {
      const idx = messages.findIndex((x) => x.id === msgId);
      if (idx === -1) return messages;
      const head = messages.slice(0, idx + 1);
      head[idx] = { ...head[idx], content, content_type: isParts ? "parts" : "text" };
      return head;
    })();
    setMessages(baseMessages);
    await sendRef.current(text, imageDataUrls, { resendFromId: msgId, baseMessages });
  }, [activeId, messages]);

  const value: ChatCtxValue = {
    conversations, activeId, messages, hasMore, loadingMsgs, streaming,
    providers, activeModel, activeRequestMode, keyMissing,
    refreshProviders, selectModel,
    selectConversation, newConversation, deleteConversation, renameConversation,
    loadMore, send, editAndResend, stop,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useChat(): ChatCtxValue {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error("useChat must be used within ChatProvider");
  return ctx;
}
