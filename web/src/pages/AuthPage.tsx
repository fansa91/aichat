import * as React from "react";
import { Bot } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input, Label } from "../components/ui/input";
import { useAuth } from "../context/AuthContext";
import { ApiError } from "../lib/api";

export function AuthPage() {
  const { login, register } = useAuth();
  const [mode, setMode] = React.useState<"login" | "register">("login");
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "login") await login(username.trim(), password);
      else await register(username.trim(), password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "请求失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm rounded-xl border bg-card p-8 shadow-sm">
        <div className="mb-6 flex flex-col items-center gap-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Bot className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-semibold">AI 对话</h1>
          <p className="text-sm text-muted-foreground">{mode === "login" ? "登录以继续" : "注册新账号"}</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="username">用户名</Label>
            <Input id="username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">密码</Label>
            <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} required />
          </div>
          {error && <div className="text-sm text-destructive">{error}</div>}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "请稍候…" : mode === "login" ? "登录" : "注册"}
          </Button>
        </form>
        <div className="mt-4 text-center text-sm">
          <button className="text-primary hover:underline" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>
            {mode === "login" ? "没有账号？去注册" : "已有账号？去登录"}
          </button>
        </div>
      </div>
    </div>
  );
}
