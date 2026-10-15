import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils";

interface SelectProps {
  value: string;
  onValueChange: (v: string) => void;
  options: { value: string; label: string }[];
  className?: string;
  placeholder?: string;
}

export function Select({ value, onValueChange, options, className, placeholder }: SelectProps) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);
  const selected = options.find((o) => o.value === value);
  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs focus:outline-none focus:ring-1 focus:ring-ring"
      >
        <span className={cn(!selected && "text-muted-foreground")}>
          {selected ? selected.label : placeholder ?? "请选择"}
        </span>
        <ChevronDown className="h-4 w-4 opacity-50" />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-card p-1 shadow-md">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => { onValueChange(o.value); setOpen(false); }}
              className={cn(
                "flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground text-left",
                o.value === value && "bg-accent"
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
