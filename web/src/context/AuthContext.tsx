import * as React from "react";
import { api } from "../lib/api";
import type { User } from "../lib/types";

interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = React.createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<User | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    const token = localStorage.getItem("aichat_token");
    if (!token) { setLoading(false); return; }
    api.me()
      .then((r) => setUser(r.user))
      .catch(() => localStorage.removeItem("aichat_token"))
      .finally(() => setLoading(false));
  }, []);

  const login = async (username: string, password: string) => {
    const r = await api.login(username, password);
    localStorage.setItem("aichat_token", r.token);
    setUser(r.user);
  };
  const register = async (username: string, password: string) => {
    const r = await api.register(username, password);
    localStorage.setItem("aichat_token", r.token);
    setUser(r.user);
  };
  const logout = async () => {
    try { await api.logout(); } catch { /* 忽略 */ }
    localStorage.removeItem("aichat_token");
    setUser(null);
  };

  return <Ctx.Provider value={{ user, loading, login, register, logout }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
