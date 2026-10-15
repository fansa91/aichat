import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import * as React from "react";
import { Bot } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input, Label } from "../components/ui/input";
import { useAuth } from "../context/AuthContext";
import { ApiError } from "../lib/api";
export function AuthPage() {
    const { login, register } = useAuth();
    const [mode, setMode] = React.useState("login");
    const [username, setUsername] = React.useState("");
    const [password, setPassword] = React.useState("");
    const [error, setError] = React.useState("");
    const [busy, setBusy] = React.useState(false);
    const submit = async (e) => {
        e.preventDefault();
        setError("");
        setBusy(true);
        try {
            if (mode === "login")
                await login(username.trim(), password);
            else
                await register(username.trim(), password);
        }
        catch (err) {
            setError(err instanceof ApiError ? err.message : "请求失败");
        }
        finally {
            setBusy(false);
        }
    };
    return (_jsx("div", { className: "flex min-h-screen items-center justify-center bg-background p-4", children: _jsxs("div", { className: "w-full max-w-sm rounded-xl border bg-card p-8 shadow-sm", children: [_jsxs("div", { className: "mb-6 flex flex-col items-center gap-2", children: [_jsx("div", { className: "flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground", children: _jsx(Bot, { className: "h-6 w-6" }) }), _jsx("h1", { className: "text-xl font-semibold", children: "AI \u5BF9\u8BDD" }), _jsx("p", { className: "text-sm text-muted-foreground", children: mode === "login" ? "登录以继续" : "注册新账号" })] }), _jsxs("form", { onSubmit: submit, className: "space-y-4", children: [_jsxs("div", { className: "space-y-2", children: [_jsx(Label, { htmlFor: "username", children: "\u7528\u6237\u540D" }), _jsx(Input, { id: "username", value: username, onChange: (e) => setUsername(e.target.value), autoComplete: "username", required: true })] }), _jsxs("div", { className: "space-y-2", children: [_jsx(Label, { htmlFor: "password", children: "\u5BC6\u7801" }), _jsx(Input, { id: "password", type: "password", value: password, onChange: (e) => setPassword(e.target.value), autoComplete: mode === "login" ? "current-password" : "new-password", required: true })] }), error && _jsx("div", { className: "text-sm text-destructive", children: error }), _jsx(Button, { type: "submit", className: "w-full", disabled: busy, children: busy ? "请稍候…" : mode === "login" ? "登录" : "注册" })] }), _jsx("div", { className: "mt-4 text-center text-sm", children: _jsx("button", { className: "text-primary hover:underline", onClick: () => { setMode(mode === "login" ? "register" : "login"); setError(""); }, children: mode === "login" ? "没有账号？去注册" : "已有账号？去登录" }) })] }) }));
}
