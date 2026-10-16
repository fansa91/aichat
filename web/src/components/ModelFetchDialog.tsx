import * as React from "react";
import { Check } from "lucide-react";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { cn } from "../lib/utils";

/** 获取模型列表后的弹出式选择面板：勾选需要添加的模型 */
export function ModelFetchDialog({ models, existing, onClose, onConfirm }: {
  models: string[];
  existing: Set<string>;
  onClose: () => void;
  onConfirm: (selected: string[]) => void;
}) {
  const [q, setQ] = React.useState("");
  const [selected, setSelected] = React.useState<Set<string>>(
    () => new Set(models.filter((m) => !existing.has(m)))
  );

  const filtered = models.filter(
    (m) => !q.trim() || m.toLowerCase().includes(q.trim().toLowerCase())
  );

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) => {
      const visible = new Set(filtered);
      const allSelected = filtered.every((m) => prev.has(m));
      const next = new Set(prev);
      if (allSelected) {
        for (const m of visible) next.delete(m);
      } else {
        for (const m of visible) next.add(m);
      }
      return next;
    });
  };

  const newCount = [...selected].filter((m) => !existing.has(m)).length;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogHeader>
        <DialogTitle>选择要添加的模型（{models.length} 个）</DialogTitle>
      </DialogHeader>
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="搜索模型…"
        autoFocus
      />
      <div className="max-h-[50vh] space-y-0.5 overflow-y-auto py-1">
        {filtered.length > 0 && (
          <button
            onClick={toggleAll}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent"
          >
            {filtered.every((m) => selected.has(m)) ? "取消全选" : "全选当前筛选"}
          </button>
        )}
        {filtered.map((m) => {
          const checked = selected.has(m);
          const isExisting = existing.has(m);
          return (
            <button
              key={m}
              onClick={() => toggle(m)}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-accent",
                checked && "bg-accent/50"
              )}
            >
              <span
                className={cn(
                  "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                  checked ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"
                )}
              >
                {checked && <Check className="h-3 w-3" />}
              </span>
              <span className="min-w-0 flex-1 truncate">{m}</span>
              {isExisting && (
                <span className="shrink-0 text-xs text-muted-foreground">已存在</span>
              )}
            </button>
          );
        })}
        {filtered.length === 0 && (
          <div className="py-8 text-center text-sm text-muted-foreground">无匹配模型</div>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>取消</Button>
        <Button onClick={() => onConfirm([...selected])} disabled={selected.size === 0}>
          添加选中{newCount > 0 ? `（新增 ${newCount} 个）` : ""}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
