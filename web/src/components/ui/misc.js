import { jsx as _jsx } from "react/jsx-runtime";
import { cva } from "class-variance-authority";
import { cn } from "../../lib/utils";
const badgeVariants = cva("inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold transition-colors", {
    variants: {
        variant: {
            default: "border-transparent bg-primary text-primary-foreground",
            secondary: "border-transparent bg-secondary text-secondary-foreground",
            outline: "text-foreground",
        },
    },
    defaultVariants: { variant: "default" },
});
export function Badge({ className, variant, ...props }) {
    return _jsx("div", { className: cn(badgeVariants({ variant }), className), ...props });
}
export function Separator({ className, ...props }) {
    return _jsx("div", { className: cn("h-px w-full bg-border", className), ...props });
}
export function Skeleton({ className, ...props }) {
    return _jsx("div", { className: cn("animate-pulse rounded-md bg-muted", className), ...props });
}
export function Switch({ checked, onCheckedChange }) {
    return (_jsx("button", { type: "button", role: "switch", "aria-checked": checked, onClick: () => onCheckedChange(!checked), className: cn("inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors", checked ? "bg-primary" : "bg-input"), children: _jsx("span", { className: cn("block h-4 w-4 rounded-full bg-background shadow transition-transform", checked ? "translate-x-4" : "translate-x-0") }) }));
}
