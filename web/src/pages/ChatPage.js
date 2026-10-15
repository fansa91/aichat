import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import * as React from "react";
import { SessionSidebar } from "../components/SessionSidebar";
import { MessageList } from "../components/MessageList";
import { ChatInput } from "../components/ChatInput";
import { SettingsPage } from "./SettingsPage";
import { useChat } from "../context/ChatContext";
import { byok } from "../lib/byok";
export function ChatPage() {
    const { activeId, messages, hasMore, loadingMsgs, streaming, activeConfig, loadMore, send, stop, } = useChat();
    const [settingsOpen, setSettingsOpen] = React.useState(false);
    const [sendError, setSendError] = React.useState("");
    const keyMissing = activeConfig && !byok.has(activeConfig.id);
    const handleSend = async (text, images) => {
        setSendError("");
        try {
            await send(text, images);
        }
        catch (e) {
            setSendError(e instanceof Error ? e.message : "发送失败");
        }
    };
    return (_jsxs("div", { className: "flex h-screen bg-background", children: [_jsx(SessionSidebar, { onOpenSettings: () => setSettingsOpen(true) }), _jsxs("div", { className: "flex flex-1 flex-col", children: [_jsx(MessageList, { messages: messages, hasMore: hasMore, loading: loadingMsgs, streaming: streaming, onLoadMore: loadMore }), sendError && (_jsx("div", { className: "border-t px-4 py-2 text-sm text-destructive", children: sendError })), keyMissing && activeId && (_jsxs("div", { className: "border-t px-4 py-2 text-sm text-muted-foreground", children: ["\u5F53\u524D\u6A21\u578B\u300C", activeConfig?.name, "\u300D\u672A\u586B\u5199 API Key\uFF0C", _jsx("button", { className: "text-primary hover:underline", onClick: () => setSettingsOpen(true), children: "\u53BB\u8BBE\u7F6E" })] })), _jsx(ChatInput, { streaming: streaming, disabled: !activeId || !activeConfig, onSend: handleSend, onStop: stop })] }), settingsOpen && _jsx(SettingsPage, { onClose: () => setSettingsOpen(false) })] }));
}
