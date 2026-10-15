import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import * as React from "react";
import { ImagePlus, Send, Square, X } from "lucide-react";
import { Button } from "./ui/button";
import { Textarea } from "./ui/input";
export function ChatInput({ streaming, disabled, onSend, onStop }) {
    const [text, setText] = React.useState("");
    const [images, setImages] = React.useState([]);
    const fileRef = React.useRef(null);
    const addFiles = (files) => {
        if (!files)
            return;
        for (const f of Array.from(files).slice(0, 4 - images.length)) {
            if (!f.type.startsWith("image/"))
                continue;
            const reader = new FileReader();
            reader.onload = () => {
                const url = reader.result;
                setImages((prev) => (prev.length < 4 ? [...prev, url] : prev));
            };
            reader.readAsDataURL(f);
        }
    };
    const submit = () => {
        if (streaming || disabled)
            return;
        if (!text.trim() && images.length === 0)
            return;
        onSend(text, images);
        setText("");
        setImages([]);
    };
    return (_jsxs("div", { className: "border-t p-4", children: [images.length > 0 && (_jsx("div", { className: "mb-2 flex gap-2", children: images.map((url, i) => (_jsxs("div", { className: "relative", children: [_jsx("img", { src: url, alt: "", className: "h-16 w-16 rounded-lg border object-cover" }), _jsx("button", { onClick: () => setImages((prev) => prev.filter((_, j) => j !== i)), className: "absolute -right-2 -top-2 rounded-full bg-destructive p-0.5 text-white", "aria-label": "\u79FB\u9664\u56FE\u7247", children: _jsx(X, { className: "h-3 w-3" }) })] }, i))) })), _jsxs("div", { className: "flex items-end gap-2", children: [_jsx("input", { ref: fileRef, type: "file", accept: "image/*", multiple: true, className: "hidden", onChange: (e) => { addFiles(e.target.files); e.target.value = ""; } }), _jsx(Button, { variant: "outline", size: "icon", onClick: () => fileRef.current?.click(), disabled: disabled, title: "\u6DFB\u52A0\u56FE\u7247", children: _jsx(ImagePlus, {}) }), _jsx(Textarea, { value: text, onChange: (e) => setText(e.target.value), onPaste: (e) => {
                            const files = e.clipboardData?.files;
                            if (files && files.length > 0) {
                                e.preventDefault();
                                addFiles(files);
                            }
                        }, onKeyDown: (e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                submit();
                            }
                        }, placeholder: disabled ? "请先在设置中配置模型" : "输入消息，Enter 发送，Shift+Enter 换行（可粘贴图片）", className: "max-h-40 resize-none", rows: 2, disabled: disabled }), streaming ? (_jsx(Button, { variant: "destructive", size: "icon", onClick: onStop, title: "\u505C\u6B62", children: _jsx(Square, {}) })) : (_jsx(Button, { size: "icon", onClick: submit, disabled: disabled || (!text.trim() && images.length === 0), title: "\u53D1\u9001", children: _jsx(Send, {}) }))] })] }));
}
