import { jsx as _jsx } from "react/jsx-runtime";
import * as React from "react";
import { api } from "../lib/api";
const Ctx = React.createContext(null);
export function AuthProvider({ children }) {
    const [user, setUser] = React.useState(null);
    const [loading, setLoading] = React.useState(true);
    React.useEffect(() => {
        const token = localStorage.getItem("aichat_token");
        if (!token) {
            setLoading(false);
            return;
        }
        api.me()
            .then((r) => setUser(r.user))
            .catch(() => localStorage.removeItem("aichat_token"))
            .finally(() => setLoading(false));
    }, []);
    const login = async (username, password) => {
        const r = await api.login(username, password);
        localStorage.setItem("aichat_token", r.token);
        setUser(r.user);
    };
    const register = async (username, password) => {
        const r = await api.register(username, password);
        localStorage.setItem("aichat_token", r.token);
        setUser(r.user);
    };
    const logout = async () => {
        try {
            await api.logout();
        }
        catch { /* 忽略 */ }
        localStorage.removeItem("aichat_token");
        setUser(null);
    };
    return _jsx(Ctx.Provider, { value: { user, loading, login, register, logout }, children: children });
}
export function useAuth() {
    const ctx = React.useContext(Ctx);
    if (!ctx)
        throw new Error("useAuth must be used within AuthProvider");
    return ctx;
}
