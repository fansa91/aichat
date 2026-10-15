import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import * as React from "react";
import { ChatMessage } from "./ChatMessage";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/misc";
export function MessageList({ messages, hasMore, loading, streaming, onLoadMore }) {
    const ref = React.useRef(null);
    const stickRef = React.useRef(true);
    const onScroll = () => {
        const el = ref.current;
        if (!el)
            return;
        stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    };
    React.useEffect(() => {
        const el = ref.current;
        if (el && stickRef.current)
            el.scrollTop = el.scrollHeight;
    }, [messages, streaming]);
    // 切换会话时回到顶部/底部
    const firstId = messages[0]?.id;
    React.useEffect(() => {
        const el = ref.current;
        if (el) {
            el.scrollTop = el.scrollHeight;
            stickRef.current = true;
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [firstId]);
    return (_jsxs("div", { ref: ref, onScroll: onScroll, className: "flex-1 overflow-y-auto", children: [hasMore && (_jsx("div", { className: "flex justify-center py-3", children: _jsx(Button, { variant: "outline", size: "sm", onClick: onLoadMore, disabled: loading, children: loading ? "加载中…" : "加载更早的消息" }) })), loading && messages.length === 0 && (_jsxs("div", { className: "space-y-3 px-4 py-4", children: [_jsx(Skeleton, { className: "h-16 w-3/4" }), _jsx(Skeleton, { className: "h-16 w-2/3 ml-auto" })] })), messages.map((m) => (_jsx(ChatMessage, { message: m }, m.id))), messages.length === 0 && !loading && (_jsx("div", { className: "flex h-full items-center justify-center text-sm text-muted-foreground", children: "\u5F00\u59CB\u65B0\u7684\u5BF9\u8BDD\u5427" }))] }));
}
