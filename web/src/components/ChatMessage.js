import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Bot, User as UserIcon } from "lucide-react";
import { cn } from "../lib/utils";
function UserParts({ message }) {
    if (message.content_type !== "parts") {
        return _jsx("div", { className: "whitespace-pre-wrap", children: message.content });
    }
    let parts = [];
    try {
        parts = JSON.parse(message.content);
    }
    catch { /* 忽略 */ }
    return (_jsx("div", { className: "space-y-2", children: parts.map((p, i) => p.type === "text" ? (_jsx("div", { className: "whitespace-pre-wrap", children: p.text }, i)) : (_jsx("img", { src: p.image_url.url, alt: "\u56FE\u7247", className: "max-w-64 rounded-lg border" }, i))) }));
}
export const ChatMessage = React.memo(function ChatMessage({ message }) {
    const isUser = message.role === "user";
    return (_jsxs("div", { className: cn("flex gap-3 px-4 py-4", isUser ? "flex-row-reverse" : ""), children: [_jsx("div", { className: cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", isUser ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"), children: isUser ? _jsx(UserIcon, { className: "h-4 w-4" }) : _jsx(Bot, { className: "h-4 w-4" }) }), _jsx("div", { className: cn("max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed", isUser ? "bg-primary text-primary-foreground" : "bg-muted/60"), children: isUser ? (_jsx(UserParts, { message: message })) : message.content ? (_jsx("div", { className: "markdown-body", children: _jsx(ReactMarkdown, { remarkPlugins: [remarkGfm], rehypePlugins: [rehypeHighlight], children: message.content }) })) : (_jsxs("span", { className: "inline-flex gap-1 py-2", children: [_jsx("span", { className: "h-2 w-2 animate-bounce rounded-full bg-muted-foreground" }), _jsx("span", { className: "h-2 w-2 animate-bounce rounded-full bg-muted-foreground [animation-delay:0.15s]" }), _jsx("span", { className: "h-2 w-2 animate-bounce rounded-full bg-muted-foreground [animation-delay:0.3s]" })] })) })] }));
});
