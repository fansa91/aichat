import { jsx as _jsx } from "react/jsx-runtime";
import * as React from "react";
import { cn } from "../../lib/utils";
export const Input = React.forwardRef(({ className, type, ...props }, ref) => (_jsx("input", { ref: ref, type: type, className: cn("flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors", "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50", className), ...props })));
Input.displayName = "Input";
export const Textarea = React.forwardRef(({ className, ...props }, ref) => (_jsx("textarea", { ref: ref, className: cn("flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs transition-colors", "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50", className), ...props })));
Textarea.displayName = "Textarea";
export function Label({ className, ...props }) {
    return (_jsx("label", { className: cn("text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70", className), ...props }));
}
