import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import * as React from "react";
import { X } from "lucide-react";
import { cn } from "../../lib/utils";
export function Dialog({ open, onOpenChange, children }) {
    React.useEffect(() => {
        if (!open)
            return;
        const onKey = (e) => e.key === "Escape" && onOpenChange(false);
        window.addEventListener("keydown", onKey);
        document.body.style.overflow = "hidden";
        return () => {
            window.removeEventListener("keydown", onKey);
            document.body.style.overflow = "";
        };
    }, [open, onOpenChange]);
    if (!open)
        return null;
    return (_jsxs("div", { className: "fixed inset-0 z-50 flex items-center justify-center", children: [_jsx("div", { className: "absolute inset-0 bg-black/50", onClick: () => onOpenChange(false) }), _jsx("div", { className: "relative z-10 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg border bg-card p-6 shadow-lg", children: children })] }));
}
export function DialogHeader({ className, ...props }) {
    return _jsx("div", { className: cn("flex flex-col space-y-1.5 mb-4", className), ...props });
}
export function DialogTitle({ className, ...props }) {
    return _jsx("h2", { className: cn("text-lg font-semibold leading-none tracking-tight", className), ...props });
}
export function DialogFooter({ className, ...props }) {
    return _jsx("div", { className: cn("flex justify-end gap-2 mt-6", className), ...props });
}
export function DialogClose({ onClose }) {
    return (_jsx("button", { onClick: onClose, className: "absolute right-4 top-4 rounded-sm opacity-70 hover:opacity-100 focus:outline-none", "aria-label": "\u5173\u95ED", children: _jsx(X, { className: "h-4 w-4" }) }));
}
