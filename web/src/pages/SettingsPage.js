import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import * as React from "react";
import { KeyRound, Pencil, Plus, RefreshCw, Server, Settings2, Trash2, X, Eye, EyeOff } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input, Label, Textarea } from "../components/ui/input";
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Select } from "../components/ui/select";
import { Badge, Separator, Switch } from "../components/ui/misc";
import { api, ApiError } from "../lib/api";
import { byok } from "../lib/byok";
import { listModels } from "../lib/modelClient";
import { useChat } from "../context/ChatContext";
const FORMAT_LABEL = { openai: "OpenAI 兼容", anthropic: "Anthropic Claude", gemini: "Google Gemini" };
export function SettingsPage({ onClose }) {
    const [tab, setTab] = React.useState("models");
    return (_jsxs("div", { className: "fixed inset-0 z-40 flex items-center justify-center", children: [_jsx("div", { className: "absolute inset-0 bg-black/50", onClick: onClose }), _jsxs("div", { className: "relative z-10 flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg border bg-card shadow-lg", children: [_jsxs("div", { className: "flex items-center justify-between border-b p-4", children: [_jsx("h2", { className: "text-lg font-semibold", children: "\u8BBE\u7F6E" }), _jsx("button", { onClick: onClose, className: "rounded p-1 hover:bg-accent", "aria-label": "\u5173\u95ED", children: _jsx(X, { className: "h-4 w-4" }) })] }), _jsx("div", { className: "flex gap-1 border-b px-4", children: [["models", "模型配置"], ["keys", "Key 同步到服务器"]].map(([k, label]) => (_jsx("button", { onClick: () => setTab(k), className: `border-b-2 px-3 py-2 text-sm ${tab === k ? "border-primary font-medium" : "border-transparent text-muted-foreground"}`, children: label }, k))) }), _jsx("div", { className: "flex-1 overflow-y-auto p-4", children: tab === "models" ? _jsx(ModelConfigTab, {}) : _jsx(KeySyncTab, {}) })] })] }));
}
function ModelConfigTab() {
    const { configs, refreshConfigs } = useChat();
    const [editing, setEditing] = React.useState(null);
    return (_jsxs("div", { className: "space-y-3", children: [_jsx("div", { className: "flex justify-end", children: _jsxs(Button, { size: "sm", onClick: () => setEditing("new"), children: [_jsx(Plus, {}), " \u65B0\u589E\u6A21\u578B\u914D\u7F6E"] }) }), configs.map((c) => (_jsxs("div", { className: "rounded-lg border p-3", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "font-medium", children: c.name }), c.is_default === 1 && _jsx(Badge, { children: "\u9ED8\u8BA4" }), _jsx(Badge, { variant: "secondary", children: FORMAT_LABEL[c.api_format] }), _jsx(Badge, { variant: "outline", children: c.request_mode === "direct" ? "前端直连" : "后端代理" }), !byok.has(c.id) && _jsx(Badge, { variant: "outline", children: "\u672A\u586B Key" }), _jsxs("div", { className: "ml-auto flex gap-1", children: [_jsx(Button, { variant: "ghost", size: "icon", onClick: () => setEditing(c), title: "\u7F16\u8F91", children: _jsx(Pencil, {}) }), _jsx(Button, { variant: "ghost", size: "icon", title: "\u5220\u9664", onClick: async () => { if (confirm(`删除配置「${c.name}」？`)) {
                                            await api.deleteModelConfig(c.id);
                                            byok.remove(c.id);
                                            await refreshConfigs();
                                        } }, children: _jsx(Trash2, {}) })] })] }), _jsxs("div", { className: "mt-1 truncate text-sm text-muted-foreground", children: [c.base_url, " \u00B7 ", c.model] })] }, c.id))), configs.length === 0 && _jsx("div", { className: "py-8 text-center text-sm text-muted-foreground", children: "\u8FD8\u6CA1\u6709\u6A21\u578B\u914D\u7F6E\uFF0C\u5148\u65B0\u589E\u4E00\u4E2A\u5427" }), editing && (_jsx(ModelConfigDialog, { initial: editing === "new" ? null : editing, onClose: () => setEditing(null), onSaved: async () => { setEditing(null); await refreshConfigs(); } }))] }));
}
function ModelConfigDialog({ initial, onClose, onSaved }) {
    const [form, setForm] = React.useState({
        name: initial?.name ?? "",
        base_url: initial?.base_url ?? "https://api.openai.com/v1",
        model: initial?.model ?? "",
        api_format: initial?.api_format ?? "openai",
        temperature: initial?.temperature != null ? String(initial.temperature) : "",
        max_tokens: initial?.max_tokens != null ? String(initial.max_tokens) : "",
        system_prompt: initial?.system_prompt ?? "",
        request_mode: initial?.request_mode ?? "direct",
        is_default: initial?.is_default === 1,
    });
    const [key, setKey] = React.useState(initial ? byok.get(initial.id) ?? "" : "");
    const [showKey, setShowKey] = React.useState(false);
    const [models, setModels] = React.useState([]);
    const [fetching, setFetching] = React.useState(false);
    const [error, setError] = React.useState("");
    const [busy, setBusy] = React.useState(false);
    const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
    const fetchModels = async () => {
        if (!key.trim()) {
            setError("请先填写 API Key 再拉取列表");
            return;
        }
        setFetching(true);
        setError("");
        try {
            const list = await listModels(form.api_format, form.base_url, key.trim());
            setModels(list);
            if (list.length === 0)
                setError("该接口未返回模型列表");
        }
        catch (e) {
            setError(e instanceof Error ? e.message : "拉取失败");
        }
        finally {
            setFetching(false);
        }
    };
    const save = async () => {
        setError("");
        setBusy(true);
        try {
            const body = {
                name: form.name.trim(),
                base_url: form.base_url.trim(),
                model: form.model.trim(),
                api_format: form.api_format,
                temperature: form.temperature === "" ? null : Number(form.temperature),
                max_tokens: form.max_tokens === "" ? null : parseInt(form.max_tokens, 10),
                system_prompt: form.system_prompt || null,
                request_mode: form.request_mode,
                is_default: form.is_default,
            };
            let id;
            if (initial) {
                const r = await api.patchModelConfig(initial.id, body);
                id = r.id;
            }
            else {
                const r = await api.createModelConfig(body);
                id = r.id;
            }
            // Key 只存浏览器本地
            if (key.trim())
                byok.set(id, key.trim());
            else if (initial)
                byok.remove(id);
            onSaved();
        }
        catch (e) {
            setError(e instanceof ApiError ? e.message : "保存失败");
        }
        finally {
            setBusy(false);
        }
    };
    return (_jsxs(Dialog, { open: true, onOpenChange: (o) => !o && onClose(), children: [_jsx(DialogHeader, { children: _jsx(DialogTitle, { children: initial ? "编辑模型配置" : "新增模型配置" }) }), _jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "grid grid-cols-2 gap-4", children: [_jsxs("div", { className: "space-y-2", children: [_jsx(Label, { children: "\u540D\u79F0" }), _jsx(Input, { value: form.name, onChange: (e) => set("name", e.target.value), placeholder: "\u5982\uFF1AGPT-4o\uFF08\u76F4\u8FDE\uFF09" })] }), _jsxs("div", { className: "space-y-2", children: [_jsx(Label, { children: "API \u683C\u5F0F" }), _jsx(Select, { value: form.api_format, onValueChange: (v) => { set("api_format", v); setModels([]); }, options: Object.entries(FORMAT_LABEL).map(([value, label]) => ({ value, label })) })] })] }), _jsxs("div", { className: "space-y-2", children: [_jsx(Label, { children: "Base URL\uFF08\u4E0D\u5E26\u8DEF\u5F84\u540E\u7F00\uFF09" }), _jsx(Input, { value: form.base_url, onChange: (e) => set("base_url", e.target.value), placeholder: "https://api.openai.com/v1" })] }), _jsxs("div", { className: "space-y-2", children: [_jsx(Label, { children: "\u6A21\u578B" }), _jsxs("div", { className: "flex gap-2", children: [models.length > 0 ? (_jsx(Select, { className: "flex-1", value: form.model, onValueChange: (v) => set("model", v), options: models.map((m) => ({ value: m, label: m })), placeholder: "\u4ECE\u5217\u8868\u9009\u62E9" })) : (_jsx(Input, { className: "flex-1", value: form.model, onChange: (e) => set("model", e.target.value), placeholder: "\u5982\uFF1Agpt-4o" })), _jsxs(Button, { variant: "outline", size: "sm", onClick: fetchModels, disabled: fetching, title: "\u4ECE\u4E0A\u6E38\u62C9\u53D6\u6A21\u578B\u5217\u8868", children: [_jsx(RefreshCw, { className: fetching ? "animate-spin" : "" }), " \u62C9\u53D6\u5217\u8868"] })] }), _jsx("p", { className: "text-xs text-muted-foreground", children: "\u7528\u4E0A\u65B9\u586B\u5199\u7684 Key \u76F4\u63A5\u8BF7\u6C42\u4E0A\u6E38\u7684\u6A21\u578B\u5217\u8868\u63A5\u53E3\uFF0C\u4E0D\u7ECF\u8FC7\u672C\u670D\u52A1\u5668\u3002" })] }), _jsxs("div", { className: "space-y-2", children: [_jsx(Label, { children: "API Key\uFF08\u53EA\u4FDD\u5B58\u5728\u672C\u6D4F\u89C8\u5668\uFF0C\u53EF\u4FEE\u6539/\u5220\u9664\uFF09" }), _jsxs("div", { className: "flex gap-2", children: [_jsx(Input, { type: showKey ? "text" : "password", value: key, onChange: (e) => setKey(e.target.value), placeholder: "sk-\u2026", className: "flex-1", autoComplete: "off" }), _jsx(Button, { variant: "outline", size: "icon", onClick: () => setShowKey((s) => !s), title: showKey ? "隐藏" : "显示", children: showKey ? _jsx(EyeOff, {}) : _jsx(Eye, {}) }), initial && byok.has(initial.id) && (_jsx(Button, { variant: "outline", size: "sm", onClick: () => { setKey(""); }, children: "\u6E05\u9664" }))] })] }), _jsxs("div", { className: "grid grid-cols-2 gap-4", children: [_jsxs("div", { className: "space-y-2", children: [_jsx(Label, { children: "\u8BF7\u6C42\u6A21\u5F0F" }), _jsx(Select, { value: form.request_mode, onValueChange: (v) => set("request_mode", v), options: [{ value: "direct", label: "前端直连" }, { value: "proxy", label: "后端代理" }] })] }), _jsxs("div", { className: "flex items-end gap-2 pb-2", children: [_jsx(Switch, { checked: form.is_default, onCheckedChange: (v) => set("is_default", v) }), _jsx(Label, { children: "\u8BBE\u4E3A\u9ED8\u8BA4\u914D\u7F6E" })] })] }), _jsxs("div", { className: "grid grid-cols-2 gap-4", children: [_jsxs("div", { className: "space-y-2", children: [_jsx(Label, { children: "Temperature\uFF08\u53EF\u9009\uFF09" }), _jsx(Input, { value: form.temperature, onChange: (e) => set("temperature", e.target.value), placeholder: "0.7" })] }), _jsxs("div", { className: "space-y-2", children: [_jsx(Label, { children: "Max tokens\uFF08\u53EF\u9009\uFF09" }), _jsx(Input, { value: form.max_tokens, onChange: (e) => set("max_tokens", e.target.value), placeholder: "4096" })] })] }), _jsxs("div", { className: "space-y-2", children: [_jsx(Label, { children: "\u7CFB\u7EDF\u63D0\u793A\u8BCD\uFF08\u53EF\u9009\uFF09" }), _jsx(Textarea, { value: form.system_prompt, onChange: (e) => set("system_prompt", e.target.value), rows: 3 })] }), error && _jsx("div", { className: "text-sm text-destructive", children: error })] }), _jsxs(DialogFooter, { children: [_jsx(Button, { variant: "outline", onClick: onClose, children: "\u53D6\u6D88" }), _jsx(Button, { onClick: save, disabled: busy || !form.name.trim() || !form.model.trim(), children: busy ? "保存中…" : "保存" })] })] }));
}
function KeySyncTab() {
    const { configs, refreshConfigs } = useChat();
    const [keys, setKeys] = React.useState([]);
    const [label, setLabel] = React.useState("");
    const [baseUrl, setBaseUrl] = React.useState("https://api.openai.com/v1");
    const [configId, setConfigId] = React.useState("");
    const [apiKey, setApiKey] = React.useState("");
    const [consent, setConsent] = React.useState(false);
    const [error, setError] = React.useState("");
    const [busy, setBusy] = React.useState(false);
    const load = React.useCallback(async () => {
        const r = await api.keys();
        setKeys(r.items);
    }, []);
    React.useEffect(() => { load().catch(() => { }); refreshConfigs().catch(() => { }); }, [load, refreshConfigs]);
    const submit = async () => {
        setError("");
        setBusy(true);
        try {
            await api.createKey({
                label: label.trim(), base_url: baseUrl.trim(),
                model_config_id: configId || undefined, api_key: apiKey, consent,
            });
            setLabel("");
            setApiKey("");
            setConsent(false);
            setConfigId("");
            await load();
        }
        catch (e) {
            setError(e instanceof ApiError ? e.message : "同步失败");
        }
        finally {
            setBusy(false);
        }
    };
    return (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm", children: [_jsxs("div", { className: "mb-1 flex items-center gap-2 font-medium", children: [_jsx(Server, { className: "h-4 w-4" }), " \u98CE\u9669\u544A\u77E5"] }), _jsx("p", { className: "text-muted-foreground", children: "Key \u5C06\u7ECF AES-256-GCM \u52A0\u5BC6\u5B58\u50A8\u5728\u670D\u52A1\u5668\u6570\u636E\u5E93\u4E2D\uFF0C\u4EC5\u4F60\u672C\u4EBA\u53EF\u7528\u3002\u5373\u4FBF\u5982\u6B64\uFF0C \u4ECD\u5EFA\u8BAE\u4F18\u5148\u4F7F\u7528\u6D4F\u89C8\u5668\u672C\u5730\u5B58\u50A8\uFF08\u6A21\u578B\u914D\u7F6E\u91CC\u7684 Key \u8F93\u5165\u6846\uFF09\uFF0C\u4E0D\u8981\u540C\u6B65\u5230\u670D\u52A1\u5668\u3002" })] }), _jsxs("div", { className: "space-y-3", children: [_jsx("div", { className: "font-medium", children: "\u5DF2\u540C\u6B65\u7684 Key\uFF08\u4EC5\u663E\u793A\u672B 4 \u4F4D\uFF09" }), keys.map((k) => (_jsxs("div", { className: "flex items-center gap-2 rounded-lg border p-3 text-sm", children: [_jsx(KeyRound, { className: "h-4 w-4 text-muted-foreground" }), _jsx("span", { className: "font-medium", children: k.label }), _jsx("span", { className: "text-muted-foreground", children: k.key_hint }), _jsx(Button, { variant: "ghost", size: "icon", className: "ml-auto", title: "\u5220\u9664", onClick: async () => { if (confirm("删除这个已同步的 Key？")) {
                                    await api.deleteKey(k.id);
                                    await load();
                                } }, children: _jsx(Trash2, {}) })] }, k.id))), keys.length === 0 && _jsx("div", { className: "text-sm text-muted-foreground", children: "\u6682\u65E0" })] }), _jsx(Separator, {}), _jsxs("div", { className: "space-y-3", children: [_jsx("div", { className: "font-medium", children: "\u540C\u6B65\u65B0\u7684 Key" }), _jsxs("div", { className: "grid grid-cols-2 gap-3", children: [_jsxs("div", { className: "space-y-2", children: [_jsx(Label, { children: "\u5907\u6CE8" }), _jsx(Input, { value: label, onChange: (e) => setLabel(e.target.value), placeholder: "\u5982\uFF1A\u6211\u7684 OpenAI Key" })] }), _jsxs("div", { className: "space-y-2", children: [_jsx(Label, { children: "\u5173\u8054\u6A21\u578B\u914D\u7F6E\uFF08\u53EF\u9009\uFF09" }), _jsx(Select, { value: configId, onValueChange: setConfigId, options: [{ value: "", label: "不关联" }, ...configs.map((c) => ({ value: c.id, label: c.name }))] })] })] }), _jsxs("div", { className: "space-y-2", children: [_jsx(Label, { children: "Base URL" }), _jsx(Input, { value: baseUrl, onChange: (e) => setBaseUrl(e.target.value) })] }), _jsxs("div", { className: "space-y-2", children: [_jsx(Label, { children: "API Key" }), _jsx(Input, { type: "password", value: apiKey, onChange: (e) => setApiKey(e.target.value), autoComplete: "off" })] }), _jsxs("label", { className: "flex items-start gap-2 text-sm", children: [_jsx("input", { type: "checkbox", checked: consent, onChange: (e) => setConsent(e.target.checked), className: "mt-1" }), _jsx("span", { children: "\u6211\u5DF2\u9605\u8BFB\u98CE\u9669\u544A\u77E5\uFF0C\u660E\u786E\u540C\u610F\u5C06\u8BE5 Key \u52A0\u5BC6\u540C\u6B65\u5230\u670D\u52A1\u5668" })] }), error && _jsx("div", { className: "text-sm text-destructive", children: error }), _jsx(Button, { onClick: submit, disabled: busy || !consent || !label.trim() || apiKey.length < 8, children: busy ? "同步中…" : "加密同步到服务器" })] })] }));
}
export function SettingsIcon() {
    return _jsx(Settings2, { className: "h-4 w-4" });
}
