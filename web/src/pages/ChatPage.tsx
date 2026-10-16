import * as React from "react";
import { ChevronDown, Menu } from "lucide-react";
import { SessionSidebar } from "../components/SessionSidebar";
import { MessageList } from "../components/MessageList";
import { ChatInput } from "../components/ChatInput";
import { ModelPickerDialog } from "../components/ModelPickerDialog";
import { SettingsPage } from "./SettingsPage";
import { useChat } from "../context/ChatContext";
import { providerName } from "../lib/providers";
import type { ActiveModel } from "../lib/providers";

export function ChatPage() {
  const {
    activeId, messages, hasMore, loadingMsgs, streaming,
    activeModel, providers, keyMissing,
    loadMore, send, editAndResend, stop,
  } = useChat();
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [pickerOpen, setPickerOpen] = React.useState(false);
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

  const handleEditResend = async (msgId: number, text: string) => {
    setSendError("");
    try {
      await editAndResend(msgId, text, []);
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "重新发送失败");
    }
  };

  return (
    <div className="flex h-screen overflow-x-hidden bg-background">
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
          <ModelSelectorButton
            activeModel={activeModel}
            onOpen={() => setPickerOpen(true)}
          />
        </div>
        <MessageList
          messages={messages}
          hasMore={hasMore}
          loading={loadingMsgs}
          streaming={streaming}
          onLoadMore={loadMore}
          onEditResend={handleEditResend}
        />
        {sendError && (
          <div className="border-t px-4 py-2 text-sm text-destructive">{sendError}</div>
        )}
        {keyMissing && activeId && activeModel && (
          <div className="border-t px-4 py-2 text-sm text-muted-foreground">
            {providerName(providers, activeModel.provider)} 未填写 API Key，
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
      {pickerOpen && (
        <ModelPickerDialog
          onClose={() => setPickerOpen(false)}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      )}
    </div>
  );
}

/** 顶栏模型选择按钮，点击弹出选择面板 */
function ModelSelectorButton({ activeModel, onOpen }: {
  activeModel: ActiveModel | null;
  onOpen: () => void;
}) {
  const { providers } = useChat();
  return (
    <button
      onClick={onOpen}
      className="flex min-w-0 items-center gap-2 rounded-lg px-3 py-1.5 text-sm hover:bg-accent"
      title="选择模型"
    >
      {activeModel ? (
        <>
          <span className="shrink-0 text-muted-foreground">{providerName(providers, activeModel.provider)}</span>
          <span className="truncate">{activeModel.model}</span>
        </>
      ) : (
        <span className="text-muted-foreground">选择模型</span>
      )}
      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}
