import * as React from "react";
import { Check, ChevronDown, Menu } from "lucide-react";
import { SessionSidebar } from "../components/SessionSidebar";
import { MessageList } from "../components/MessageList";
import { ChatInput } from "../components/ChatInput";
import { SettingsPage } from "./SettingsPage";
import { useChat } from "../context/ChatContext";
import { PROVIDERS, providerName } from "../lib/providers";
import type { ActiveModel } from "../lib/providers";

export function ChatPage() {
  const {
    activeId, messages, hasMore, loadingMsgs, streaming,
    activeModel, selectModel, keyMissing,
    loadMore, send, stop,
  } = useChat();
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [sendError, setSendError] = React.useState("");

  const handleSend = async (text: string, images: string[]) => {
    setSendError("");
    try {
      await send(text, images);
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "发送失败");
    }
  };

  return (
    <div className="flex h-screen bg-background">
      {/* 桌面端侧栏 */}
      <div className="hidden md:block">
        <SessionSidebar onOpenSettings={() => setSettingsOpen(true)} />
      </div>
      {/* 移动端抽屉 */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDrawerOpen(false)} />
          <div className="absolute inset-y-0 left-0 z-10">
            <SessionSidebar
              onOpenSettings={() => { setDrawerOpen(false); setSettingsOpen(true); }}
              onNavigate={() => setDrawerOpen(false)}
            />
          </div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* 顶栏：移动端菜单 + 模型选择器 */}
        <div className="flex items-center gap-2 border-b px-2 py-2 sm:px-4">
          <button
            className="rounded p-2 hover:bg-accent md:hidden"
            onClick={() => setDrawerOpen(true)}
            aria-label="打开会话列表"
          >
            <Menu className="h-5 w-5" />
          </button>
          <ModelSelector
            activeModel={activeModel}
            onSelect={selectModel}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        </div>
        <MessageList
          messages={messages}
          hasMore={hasMore}
          loading={loadingMsgs}
          streaming={streaming}
          onLoadMore={loadMore}
        />
        {sendError && (
          <div className="border-t px-4 py-2 text-sm text-destructive">{sendError}</div>
        )}
        {keyMissing && activeId && activeModel && (
          <div className="border-t px-4 py-2 text-sm text-muted-foreground">
            {providerName(activeModel.provider)} 未填写 API Key，
            <button className="text-primary hover:underline" onClick={() => setSettingsOpen(true)}>去设置</button>
          </div>
        )}
        <ChatInput
          streaming={streaming}
          disabled={!activeId || !activeModel}
          onSend={handleSend}
          onStop={stop}
        />
      </div>
      {settingsOpen && <SettingsPage onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

/** 按供应商分组的模型选择器 */
function ModelSelector({ activeModel, onSelect, onOpenSettings }: {
  activeModel: ActiveModel | null;
  onSelect: (m: ActiveModel) => void;
  onOpenSettings: () => void;
}) {
  const { providers } = useChat();
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const groups = PROVIDERS
    .map((p) => ({
      meta: p,
      models: providers[p.id].enabled
        ? providers[p.id].models.filter((m) => m.enabled).map((m) => ({ provider: p.id as ActiveModel["provider"], model: m.id }))
        : [],
    }))
    .filter((g) => g.models.length > 0);

  return (
    <div ref={ref} className="relative min-w-0">
      <button
        className="flex max-w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium hover:bg-accent"
        onClick={() => setOpen((v) => !v)}
      >
        {activeModel ? (
          <>
            <span className="shrink-0 text-muted-foreground">{providerName(activeModel.provider)}</span>
            <span className="truncate">{activeModel.model}</span>
          </>
        ) : (
          <span className="text-muted-foreground">选择模型</span>
        )}
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 max-h-80 w-64 overflow-y-auto rounded-lg border bg-card p-1 shadow-lg">
          {groups.map((g) => (
            <div key={g.meta.id}>
              <div className="px-2 py-1 text-xs font-medium text-muted-foreground">{g.meta.name}</div>
              {g.models.map((m) => {
                const cur = activeModel?.provider === m.provider && activeModel?.model === m.model;
                return (
                  <button
                    key={`${m.provider}/${m.model}`}
                    className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent ${cur ? "bg-accent" : ""}`}
                    onClick={() => { onSelect(m); setOpen(false); }}
                  >
                    <span className="min-w-0 flex-1 truncate">{m.model}</span>
                    {cur && <Check className="h-4 w-4 shrink-0" />}
                  </button>
                );
              })}
            </div>
          ))}
          {groups.length === 0 && (
            <div className="px-2 py-4 text-center text-sm text-muted-foreground">暂无可用模型</div>
          )}
          <div className="mt-1 border-t pt-1">
            <button
              className="flex w-full items-center rounded px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent"
              onClick={() => { setOpen(false); onOpenSettings(); }}
            >
              管理模型配置…
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
