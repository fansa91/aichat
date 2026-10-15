import * as React from "react";
import { MessageSquarePlus, MoreHorizontal, Pencil, Settings, LogOut, Trash2 } from "lucide-react";
import { Button } from "./ui/button";
import { Separator } from "./ui/misc";
import { Badge } from "./ui/misc";
import { useChat } from "../context/ChatContext";
import { useAuth } from "../context/AuthContext";
import { providerName } from "../lib/providers";

export function SessionSidebar({ onOpenSettings, onNavigate }: { onOpenSettings: () => void; onNavigate?: () => void }) {
  const { conversations, activeId, selectConversation, newConversation, deleteConversation, renameConversation, activeModel, keyMissing } = useChat();
  const { user, logout } = useAuth();
  const [menuId, setMenuId] = React.useState<string | null>(null);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editTitle, setEditTitle] = React.useState("");

  const pick = (id: string) => { selectConversation(id); onNavigate?.(); };

  return (
    <div className="flex h-full w-64 flex-col border-r bg-card">
      <div className="p-3">
        <Button className="w-full" onClick={() => { newConversation(); onNavigate?.(); }}>
          <MessageSquarePlus /> 新对话
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto px-2">
        {conversations.map((c) => (
          <div key={c.id} className="relative">
            <button
              onClick={() => pick(c.id)}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-accent ${
                c.id === activeId ? "bg-accent" : ""
              }`}
            >
              <span className="flex-1 truncate">{c.title}</span>
              <span
                className="rounded p-1 hover:bg-muted"
                onClick={(e) => { e.stopPropagation(); setMenuId(menuId === c.id ? null : c.id); }}
              >
                <MoreHorizontal className="h-4 w-4" />
              </span>
            </button>
            {menuId === c.id && (
              <div className="absolute right-2 top-9 z-20 w-32 rounded-md border bg-card p-1 shadow-md">
                <button
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
                  onClick={() => { setEditingId(c.id); setEditTitle(c.title); setMenuId(null); }}
                >
                  <Pencil className="h-3.5 w-3.5" /> 重命名
                </button>
                <button
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-destructive hover:bg-accent"
                  onClick={() => { deleteConversation(c.id); setMenuId(null); }}
                >
                  <Trash2 className="h-3.5 w-3.5" /> 删除
                </button>
              </div>
            )}
            {editingId === c.id && (
              <div className="px-3 py-1">
                <input
                  autoFocus
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && editTitle.trim()) { renameConversation(c.id, editTitle.trim()); setEditingId(null); }
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  onBlur={() => setEditingId(null)}
                  className="w-full rounded border border-input bg-background px-2 py-1 text-sm"
                />
              </div>
            )}
          </div>
        ))}
        {conversations.length === 0 && (
          <div className="px-3 py-8 text-center text-sm text-muted-foreground">暂无会话</div>
        )}
      </div>
      <div className="p-3">
        <Separator className="mb-3" />
        {activeModel && (
          <div className="mb-2 flex items-center gap-2 px-1">
            <Badge variant="secondary" className="max-w-full truncate">
              {providerName(activeModel.provider)} · {activeModel.model}
            </Badge>
            {keyMissing && <Badge variant="outline">未填 Key</Badge>}
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="truncate px-1 text-sm text-muted-foreground">{user?.username}</span>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" onClick={onOpenSettings} title="设置">
              <Settings />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => logout()} title="退出登录">
              <LogOut />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
