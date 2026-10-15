import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import * as React from "react";
import { MessageSquarePlus, MoreHorizontal, Pencil, Settings, LogOut, Trash2 } from "lucide-react";
import { Button } from "./ui/button";
import { Separator } from "./ui/misc";
import { Badge } from "./ui/misc";
import { useChat } from "../context/ChatContext";
import { useAuth } from "../context/AuthContext";
import { byok } from "../lib/byok";
export function SessionSidebar({ onOpenSettings }) {
    const { conversations, activeId, selectConversation, newConversation, deleteConversation, renameConversation, activeConfig } = useChat();
    const { user, logout } = useAuth();
    const [menuId, setMenuId] = React.useState(null);
    const [editingId, setEditingId] = React.useState(null);
    const [editTitle, setEditTitle] = React.useState("");
    return (_jsxs("div", { className: "flex h-full w-64 flex-col border-r bg-card", children: [_jsx("div", { className: "p-3", children: _jsxs(Button, { className: "w-full", onClick: () => newConversation(), children: [_jsx(MessageSquarePlus, {}), " \u65B0\u5BF9\u8BDD"] }) }), _jsxs("div", { className: "flex-1 overflow-y-auto px-2", children: [conversations.map((c) => (_jsxs("div", { className: "relative", children: [_jsxs("button", { onClick: () => selectConversation(c.id), className: `flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-accent ${c.id === activeId ? "bg-accent" : ""}`, children: [_jsx("span", { className: "flex-1 truncate", children: c.title }), _jsx("span", { className: "rounded p-1 hover:bg-muted", onClick: (e) => { e.stopPropagation(); setMenuId(menuId === c.id ? null : c.id); }, children: _jsx(MoreHorizontal, { className: "h-4 w-4" }) })] }), menuId === c.id && (_jsxs("div", { className: "absolute right-2 top-9 z-20 w-32 rounded-md border bg-card p-1 shadow-md", children: [_jsxs("button", { className: "flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent", onClick: () => { setEditingId(c.id); setEditTitle(c.title); setMenuId(null); }, children: [_jsx(Pencil, { className: "h-3.5 w-3.5" }), " \u91CD\u547D\u540D"] }), _jsxs("button", { className: "flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-destructive hover:bg-accent", onClick: () => { deleteConversation(c.id); setMenuId(null); }, children: [_jsx(Trash2, { className: "h-3.5 w-3.5" }), " \u5220\u9664"] })] })), editingId === c.id && (_jsx("div", { className: "px-3 py-1", children: _jsx("input", { autoFocus: true, value: editTitle, onChange: (e) => setEditTitle(e.target.value), onKeyDown: (e) => {
                                        if (e.key === "Enter" && editTitle.trim()) {
                                            renameConversation(c.id, editTitle.trim());
                                            setEditingId(null);
                                        }
                                        if (e.key === "Escape")
                                            setEditingId(null);
                                    }, onBlur: () => setEditingId(null), className: "w-full rounded border border-input bg-background px-2 py-1 text-sm" }) }))] }, c.id))), conversations.length === 0 && (_jsx("div", { className: "px-3 py-8 text-center text-sm text-muted-foreground", children: "\u6682\u65E0\u4F1A\u8BDD" }))] }), _jsxs("div", { className: "p-3", children: [_jsx(Separator, { className: "mb-3" }), activeConfig && (_jsxs("div", { className: "mb-2 flex items-center gap-2 px-1", children: [_jsx(Badge, { variant: "secondary", className: "truncate", children: activeConfig.name }), !byok.has(activeConfig.id) && _jsx(Badge, { variant: "outline", children: "\u672A\u586B Key" })] })), _jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "truncate px-1 text-sm text-muted-foreground", children: user?.username }), _jsxs("div", { className: "flex gap-1", children: [_jsx(Button, { variant: "ghost", size: "icon", onClick: onOpenSettings, title: "\u8BBE\u7F6E", children: _jsx(Settings, {}) }), _jsx(Button, { variant: "ghost", size: "icon", onClick: () => logout(), title: "\u9000\u51FA\u767B\u5F55", children: _jsx(LogOut, {}) })] })] })] })] }));
}
