import * as React from "react";
import { Check, Search } from "lucide-react";
import { Dialog, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { useChat } from "../context/ChatContext";
import type { ActiveModel } from "../lib/providers";
import { cn } from "../lib/utils";

/** LobeChat 风格：弹出式模型选择面板，按供应商分组、可搜索 */
export function ModelPickerDialog({ onClose, onOpenSettings }: {
  onClose: () => void;
  onOpenSettings: () => void;
}) {
  const { providers, activeModel, selectModel } = useChat();
  const [q, setQ] = React.useState("");

  const groups = Object.values(providers)
    .filter((p) => p.enabled)
    .map((p) => ({
      meta: p,
      models: p.models
        .filter((m) => m.enabled)
        .map((m) => ({ provider: p.id, model: m.id })),
    }))
    .filter((g) => g.models.length > 0)
    .map((g) => ({
      ...g,
      models: g.models.filter(
        (m) => !q.trim() || m.model.toLowerCase().includes(q.trim().toLowerCase())
      ),
    }))
    .filter((g) => g.models.length > 0);

  const pick = (m: ActiveModel) => {
    selectModel(m);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogHeader>
        <DialogTitle>选择模型</DialogTitle>
      </DialogHeader>
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索模型…"
          className="pl-9"
          autoFocus
        />
      </div>
      <div className="max-h-[50vh] space-y-4 overflow-y-auto py-1">
        {groups.map((g) => (
          <div key={g.meta.id}>
            <div className="mb-1 px-1 text-xs font-medium text-muted-foreground">
              {g.meta.name}
              {g.meta.custom && "（自定义）"}
            </div>
            <div className="space-y-0.5">
              {g.models.map((m) => {
                const cur = activeModel?.provider === m.provider && activeModel?.model === m.model;
                return (
                  <button
                    key={`${m.provider}/${m.model}`}
                    onClick={() => pick(m)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-accent",
                      cur && "bg-accent"
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{m.model}</span>
                    {cur && <Check className="h-4 w-4 shrink-0 text-primary" />}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {groups.length === 0 && (
          <div className="py-8 text-center text-sm text-muted-foreground">
            暂无可用模型，先启用供应商并添加模型
          </div>
        )}
      </div>
      <div className="border-t pt-3">
        <button
          className="w-full rounded-lg px-3 py-2 text-left text-sm text-muted-foreground hover:bg-accent"
          onClick={() => { onClose(); onOpenSettings(); }}
        >
          管理模型配置…
        </button>
      </div>
    </Dialog>
  );
}
