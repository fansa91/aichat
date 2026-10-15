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
import type { ApiFormat, ApiKeyMeta, ModelConfig, RequestMode } from "../lib/types";

const FORMAT_LABEL: Record<ApiFormat, string> = { openai: "OpenAI 兼容", anthropic: "Anthropic Claude", gemini: "Google Gemini" };

export function SettingsPage({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = React.useState<"models" | "keys">("models");
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg border bg-card shadow-lg">
        <div className="flex items-center justify-between border-b p-4">
          <h2 className="text-lg font-semibold">设置</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-accent" aria-label="关闭"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex gap-1 border-b px-4">
          {([["models", "模型配置"], ["keys", "Key 同步到服务器"]] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`border-b-2 px-3 py-2 text-sm ${tab === k ? "border-primary font-medium" : "border-transparent text-muted-foreground"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {tab === "models" ? <ModelConfigTab /> : <KeySyncTab />}
        </div>
      </div>
    </div>
  );
}

function ModelConfigTab() {
  const { configs, refreshConfigs } = useChat();
  const [editing, setEditing] = React.useState<ModelConfig | "new" | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setEditing("new")}><Plus /> 新增模型配置</Button>
      </div>
      {configs.map((c) => (
        <div key={c.id} className="rounded-lg border p-3">
          <div className="flex items-center gap-2">
            <span className="font-medium">{c.name}</span>
            {c.is_default === 1 && <Badge>默认</Badge>}
            <Badge variant="secondary">{FORMAT_LABEL[c.api_format]}</Badge>
            <Badge variant="outline">{c.request_mode === "direct" ? "前端直连" : "后端代理"}</Badge>
            {!byok.has(c.id) && <Badge variant="outline">未填 Key</Badge>}
            <div className="ml-auto flex gap-1">
              <Button variant="ghost" size="icon" onClick={() => setEditing(c)} title="编辑"><Pencil /></Button>
              <Button
                variant="ghost" size="icon" title="删除"
                onClick={async () => { if (confirm(`删除配置「${c.name}」？`)) { await api.deleteModelConfig(c.id); byok.remove(c.id); await refreshConfigs(); } }}
              >
                <Trash2 />
              </Button>
            </div>
          </div>
          <div className="mt-1 truncate text-sm text-muted-foreground">{c.base_url} · {c.model}</div>
        </div>
      ))}
      {configs.length === 0 && <div className="py-8 text-center text-sm text-muted-foreground">还没有模型配置，先新增一个吧</div>}
      {editing && (
        <ModelConfigDialog
          initial={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await refreshConfigs(); }}
        />
      )}
    </div>
  );
}

interface ConfigForm {
  name: string; base_url: string; model: string; api_format: ApiFormat;
  temperature: string; max_tokens: string; system_prompt: string;
  request_mode: RequestMode; is_default: boolean;
}

function ModelConfigDialog({ initial, onClose, onSaved }: {
  initial: ModelConfig | null; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = React.useState<ConfigForm>({
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
  const [models, setModels] = React.useState<string[]>([]);
  const [fetching, setFetching] = React.useState(false);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const set = (k: keyof ConfigForm, v: string | boolean | ApiFormat | RequestMode) =>
    setForm((f) => ({ ...f, [k]: v }));

  const fetchModels = async () => {
    if (!key.trim()) { setError("请先填写 API Key 再拉取列表"); return; }
    setFetching(true); setError("");
    try {
      const list = await listModels(form.api_format, form.base_url, key.trim());
      setModels(list);
      if (list.length === 0) setError("该接口未返回模型列表");
    } catch (e) {
      setError(e instanceof Error ? e.message : "拉取失败");
    } finally {
      setFetching(false);
    }
  };

  const save = async () => {
    setError(""); setBusy(true);
    try {
      const body: Record<string, unknown> = {
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
      let id: string;
      if (initial) {
        const r = await api.patchModelConfig(initial.id, body);
        id = r.id;
      } else {
        const r = await api.createModelConfig(body);
        id = r.id;
      }
      // Key 只存浏览器本地
      if (key.trim()) byok.set(id, key.trim());
      else if (initial) byok.remove(id);
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogHeader>
        <DialogTitle>{initial ? "编辑模型配置" : "新增模型配置"}</DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>名称</Label>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="如：GPT-4o（直连）" />
          </div>
          <div className="space-y-2">
            <Label>API 格式</Label>
            <Select
              value={form.api_format}
              onValueChange={(v) => { set("api_format", v as ApiFormat); setModels([]); }}
              options={Object.entries(FORMAT_LABEL).map(([value, label]) => ({ value, label }))}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label>Base URL（不带路径后缀）</Label>
          <Input value={form.base_url} onChange={(e) => set("base_url", e.target.value)} placeholder="https://api.openai.com/v1" />
        </div>
        <div className="space-y-2">
          <Label>模型</Label>
          <div className="flex gap-2">
            {models.length > 0 ? (
              <Select
                className="flex-1"
                value={form.model}
                onValueChange={(v) => set("model", v)}
                options={models.map((m) => ({ value: m, label: m }))}
                placeholder="从列表选择"
              />
            ) : (
              <Input className="flex-1" value={form.model} onChange={(e) => set("model", e.target.value)} placeholder="如：gpt-4o" />
            )}
            <Button variant="outline" size="sm" onClick={fetchModels} disabled={fetching} title="从上游拉取模型列表">
              <RefreshCw className={fetching ? "animate-spin" : ""} /> 拉取列表
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">用上方填写的 Key 直接请求上游的模型列表接口，不经过本服务器。</p>
        </div>
        <div className="space-y-2">
          <Label>API Key（只保存在本浏览器，可修改/删除）</Label>
          <div className="flex gap-2">
            <Input
              type={showKey ? "text" : "password"}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="sk-…"
              className="flex-1"
              autoComplete="off"
            />
            <Button variant="outline" size="icon" onClick={() => setShowKey((s) => !s)} title={showKey ? "隐藏" : "显示"}>
              {showKey ? <EyeOff /> : <Eye />}
            </Button>
            {initial && byok.has(initial.id) && (
              <Button variant="outline" size="sm" onClick={() => { setKey(""); }}>
                清除
              </Button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>请求模式</Label>
            <Select
              value={form.request_mode}
              onValueChange={(v) => set("request_mode", v as RequestMode)}
              options={[{ value: "direct", label: "前端直连" }, { value: "proxy", label: "后端代理" }]}
            />
          </div>
          <div className="flex items-end gap-2 pb-2">
            <Switch checked={form.is_default} onCheckedChange={(v) => set("is_default", v)} />
            <Label>设为默认配置</Label>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Temperature（可选）</Label>
            <Input value={form.temperature} onChange={(e) => set("temperature", e.target.value)} placeholder="0.7" />
          </div>
          <div className="space-y-2">
            <Label>Max tokens（可选）</Label>
            <Input value={form.max_tokens} onChange={(e) => set("max_tokens", e.target.value)} placeholder="4096" />
          </div>
        </div>
        <div className="space-y-2">
          <Label>系统提示词（可选）</Label>
          <Textarea value={form.system_prompt} onChange={(e) => set("system_prompt", e.target.value)} rows={3} />
        </div>
        {error && <div className="text-sm text-destructive">{error}</div>}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>取消</Button>
        <Button onClick={save} disabled={busy || !form.name.trim() || !form.model.trim()}>
          {busy ? "保存中…" : "保存"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

function KeySyncTab() {
  const { configs, refreshConfigs } = useChat();
  const [keys, setKeys] = React.useState<ApiKeyMeta[]>([]);
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
  React.useEffect(() => { load().catch(() => {}); refreshConfigs().catch(() => {}); }, [load, refreshConfigs]);

  const submit = async () => {
    setError(""); setBusy(true);
    try {
      await api.createKey({
        label: label.trim(), base_url: baseUrl.trim(),
        model_config_id: configId || undefined, api_key: apiKey, consent,
      });
      setLabel(""); setApiKey(""); setConsent(false); setConfigId("");
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "同步失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
        <div className="mb-1 flex items-center gap-2 font-medium"><Server className="h-4 w-4" /> 风险告知</div>
        <p className="text-muted-foreground">
          Key 将经 AES-256-GCM 加密存储在服务器数据库中，仅你本人可用。即便如此，
          仍建议优先使用浏览器本地存储（模型配置里的 Key 输入框），不要同步到服务器。
        </p>
      </div>
      <div className="space-y-3">
        <div className="font-medium">已同步的 Key（仅显示末 4 位）</div>
        {keys.map((k) => (
          <div key={k.id} className="flex items-center gap-2 rounded-lg border p-3 text-sm">
            <KeyRound className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">{k.label}</span>
            <span className="text-muted-foreground">{k.key_hint}</span>
            <Button
              variant="ghost" size="icon" className="ml-auto" title="删除"
              onClick={async () => { if (confirm("删除这个已同步的 Key？")) { await api.deleteKey(k.id); await load(); } }}
            >
              <Trash2 />
            </Button>
          </div>
        ))}
        {keys.length === 0 && <div className="text-sm text-muted-foreground">暂无</div>}
      </div>
      <Separator />
      <div className="space-y-3">
        <div className="font-medium">同步新的 Key</div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>备注</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="如：我的 OpenAI Key" />
          </div>
          <div className="space-y-2">
            <Label>关联模型配置（可选）</Label>
            <Select
              value={configId}
              onValueChange={setConfigId}
              options={[{ value: "", label: "不关联" }, ...configs.map((c) => ({ value: c.id, label: c.name }))]}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label>Base URL</Label>
          <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>API Key</Label>
          <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" />
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" />
          <span>我已阅读风险告知，明确同意将该 Key 加密同步到服务器</span>
        </label>
        {error && <div className="text-sm text-destructive">{error}</div>}
        <Button onClick={submit} disabled={busy || !consent || !label.trim() || apiKey.length < 8}>
          {busy ? "同步中…" : "加密同步到服务器"}
        </Button>
      </div>
    </div>
  );
}

export function SettingsIcon() {
  return <Settings2 className="h-4 w-4" />;
}
