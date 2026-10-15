import * as React from "react";
import { SessionSidebar } from "../components/SessionSidebar";
import { MessageList } from "../components/MessageList";
import { ChatInput } from "../components/ChatInput";
import { SettingsPage } from "./SettingsPage";
import { useChat } from "../context/ChatContext";
import { byok } from "../lib/byok";

export function ChatPage() {
  const {
    activeId, messages, hasMore, loadingMsgs, streaming,
    activeConfig, loadMore, send, stop,
  } = useChat();
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [sendError, setSendError] = React.useState("");

  const keyMissing = activeConfig && !byok.has(activeConfig.id);

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
      <SessionSidebar onOpenSettings={() => setSettingsOpen(true)} />
      <div className="flex flex-1 flex-col">
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
        {keyMissing && activeId && (
          <div className="border-t px-4 py-2 text-sm text-muted-foreground">
            当前模型「{activeConfig?.name}」未填写 API Key，
            <button className="text-primary hover:underline" onClick={() => setSettingsOpen(true)}>去设置</button>
          </div>
        )}
        <ChatInput
          streaming={streaming}
          disabled={!activeId || !activeConfig}
          onSend={handleSend}
          onStop={stop}
        />
      </div>
      {settingsOpen && <SettingsPage onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
