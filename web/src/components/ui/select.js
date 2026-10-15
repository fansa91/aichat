import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils";
export function Select({ value, onValueChange, options, className, placeholder }) {
    const [open, setOpen] = React.useState(false);
    const ref = React.useRef(null);
    React.useEffect(() => {
        const onClick = (e) => {
            if (ref.current && !ref.current.contains(e.target))
                setOpen(false);
        };
        document.addEventListener("mousedown", onClick);
        return () => document.removeEventListener("mousedown", onClick);
    }, []);
    const selected = options.find((o) => o.value === value);
    return (_jsxs("div", { ref: ref, className: cn("relative", className), children: [_jsxs("button", { type: "button", onClick: () => setOpen((o) => !o), className: "flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs focus:outline-none focus:ring-1 focus:ring-ring", children: [_jsx("span", { className: cn(!selected && "text-muted-foreground"), children: selected ? selected.label : placeholder ?? "请选择" }), _jsx(ChevronDown, { className: "h-4 w-4 opacity-50" })] }), open && (_jsx("div", { className: "absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-card p-1 shadow-md", children: options.map((o) => (_jsx("button", { type: "button", onClick: () => { onValueChange(o.value); setOpen(false); }, className: cn("flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground text-left", o.value === value && "bg-accent"), children: o.label }, o.value))) }))] }));
}
