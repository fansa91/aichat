import * as React from "react";
import {
  Check, ChevronDown, Download, Eye, EyeOff, KeyRound, Loader2, PlugZap,
  Plus, Server, Settings2, Trash2, X,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Input, Label } from "../components/ui/input";
import { Select } from "../components/ui/select";
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Badge, Separator, Switch } from "../components/ui/misc";
import { api, ApiError } from "../lib/api";
import { ModelFetchDialog } from "../components/ModelFetchDialog";
import {
  BUILTINS, checkConnection, createCustomProvider, fetchModelIds, mergeSelectedModels,
  hasKey, loadProviders, providerName, saveProviders,
} from "../lib/providers";
import type { ProviderSettings, ProviderState } from "../lib/providers";
import { useChat } from "../context/ChatContext";
import type { ApiKeyMeta, RequestMode } from "../lib/types";

export function SettingsPage({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = React.useState<"models" | "keys">("models");
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      {/* 移动端全屏，桌面端居中卡片 */}
      <div className="relative z-10 flex h-full w-full flex-col bg-card shadow-lg sm:h-auto sm:max-h-[90vh] sm:max-w-2xl sm:rounded-lg sm:border">
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
          {tab === "models" ? <ProviderListTab /> : <KeySyncTab />}
        </div>
      </div>
    </div>
  );
}

/** LobeChat 风格：供应商卡片列表（内置 + 自定义） */
function ProviderListTab() {
  const { providers, refreshProviders, activeModel } = useChat();
  const [open, setOpen] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);

  const update = (id: string, fn: (s: ProviderState) => void) => {
    const next = loadProviders();
    fn(next);
    saveProviders(next);
    refreshProviders();
  };

  const list = Object.values(providers).sort((a, b) =>
    Number(b.custom) - Number(a.custom) || 0
  );
  // 内置在前、自定义在后
  const ordered = [
    ...BUILTINS.map((b) => providers[b.id]).filter(Boolean),
    ...list.filter((p) => p.custom),
  ];

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        按供应商配置 Key 与模型。Key 只保存在本浏览器，不上传服务器。
        自定义供应商需兼容 OpenAI 接口格式。
      </p>
      {ordered.map((p) => {
        const s = providers[p.id];
        if (!s) return null;
        const enabledCount = s.models.filter((m) => m.enabled).length;
        const expanded = open === p.id;
        return (
          <div key={p.id} className="rounded-lg border">
            <div className="flex w-full items-center gap-3 p-3">
              <Switch
                checked={s.enabled}
                onCheckedChange={(v) => update(p.id, (n) => { n[p.id].enabled = v; })}
              />
              <button
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                onClick={() => setOpen(expanded ? null : p.id)}
                aria-label={`${expanded ? "收起" : "展开"} ${s.name} 配置`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{s.name}</span>
                    {s.custom && <Badge variant="outline">自定义</Badge>}
                    {hasKey(providers, p.id)
                      ? <Badge variant="secondary">已填 Key</Badge>
                      : <Badge variant="outline">未填 Key</Badge>}
                    <span className="truncate text-xs text-muted-foreground">
                      {enabledCount}/{s.models.length} 个模型
                    </span>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{s.baseUrl}</div>
                </div>
                <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
              </button>
              {s.custom && (
                <Button
                  variant="ghost" size="icon" title="删除该供应商"
                  onClick={() => {
                    if (confirm(`删除供应商「${s.name}」及其模型列表？`)) {
                      update(p.id, (n) => { delete n[p.id]; });
                      if (open === p.id) setOpen(null);
                    }
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
            {expanded && (
              <ProviderDetail
                provider={p.id}
                initial={s}
                onChanged={() => refreshProviders()}
              />
            )}
          </div>
        );
      })}
      <Button variant="outline" className="w-full" onClick={() => setAdding(true)}>
        <Plus className="h-4 w-4" /> 添加自定义供应商（OpenAI 兼容）
      </Button>
      {adding && (
        <AddProviderDialog
          onClose={() => setAdding(false)}
          onAdded={() => { setAdding(false); refreshProviders(); }}
        />
      )}
      {activeModel && (
        <ActiveModelRow />
      )}
    </div>
  );
}

/** 添加自定义供应商对话框 */
function AddProviderDialog({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [name, setName] = React.useState("");
  const [baseUrl, setBaseUrl] = React.useState("");
  const [error, setError] = React.useState("");

  const save = () => {
    setError("");
    if (!baseUrl.trim()) { setError("请填写 Base URL"); return; }
    try {
      new URL(baseUrl.trim());
    } catch {
      setError("Base URL 格式不正确");
      return;
    }
    const all = loadProviders();
    const p = createCustomProvider(name, baseUrl);
    all[p.id] = p;
    saveProviders(all);
    onAdded();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogHeader>
        <DialogTitle>添加自定义供应商</DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          适用于 DeepSeek、OpenRouter、硅基流动等 OpenAI 兼容接口。
          添加后在卡片里填写 Key，再点「获取模型列表」拉取可用模型。
        </p>
        <div className="space-y-2">
          <Label>名称</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="如：DeepSeek" />
        </div>
        <div className="space-y-2">
          <Label>Base URL</Label>
          <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.deepseek.com/v1" />
        </div>
        {error && <div className="text-sm text-destructive">{error}</div>}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>取消</Button>
        <Button onClick={save}>添加</Button>
      </DialogFooter>
    </Dialog>
  );
}

/** 当前默认模型快捷行 */
function ActiveModelRow() {
  const { providers, activeModel, selectModel } = useChat();
  const [picking, setPicking] = React.useState(false);
  const list: { provider: string; model: string }[] = [];
  for (const p of Object.values(providers)) {
    if (!p.enabled) continue;
    for (const m of p.models) if (m.enabled) list.push({ provider: p.id, model: m.id });
  }
  if (!activeModel) return null;
  return (
    <div className="rounded-lg border p-3">
      <div className="mb-2 text-sm font-medium">默认模型</div>
      {picking ? (
        <div className="max-h-48 space-y-1 overflow-y-auto">
          {list.map((m) => (
            <button
              key={`${m.provider}/${m.model}`}
              className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent ${m.provider === activeModel.provider && m.model === activeModel.model ? "bg-accent font-medium" : ""}`}
              onClick={() => { selectModel(m); setPicking(false); }}
            >
              <span className="text-muted-foreground">{providerName(providers, m.provider)}</span>
              <span className="truncate">{m.model}</span>
              {m.provider === activeModel.provider && m.model === activeModel.model && <Check className="ml-auto h-4 w-4" />}
            </button>
          ))}
          {list.length === 0 && <div className="text-sm text-muted-foreground">暂无可用模型，先启用供应商并添加模型</div>}
        </div>
      ) : (
        <Button variant="outline" size="sm" className="w-full justify-start" onClick={() => setPicking(true)}>
          <span className="text-muted-foreground">{providerName(providers, activeModel.provider)}</span>
          <span className="truncate">{activeModel.model}</span>
          <ChevronDown className="ml-auto h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

function ProviderDetail({ provider, initial, onChanged }: {
  provider: string; initial: ProviderSettings; onChanged: () => void;
}) {
  const [s, setS] = React.useState(initial);
  const [showKey, setShowKey] = React.useState(false);
  const [checking, setChecking] = React.useState(false);
  const [fetching, setFetching] = React.useState(false);
  const [fetchedModels, setFetchedModels] = React.useState<string[] | null>(null);
  const [checkMsg, setCheckMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [newModel, setNewModel] = React.useState("");

  const persist = (next: ProviderSettings) => {
    const all = loadProviders();
    all[provider] = next;
    saveProviders(all);
    setS(next);
    onChanged();
  };
  const set = (patch: Partial<ProviderSettings>) => persist({ ...s, ...patch });

  const doCheck = async () => {
    if (!s.apiKey.trim()) { setCheckMsg({ ok: false, text: "请先填写 API Key" }); return; }
    setChecking(true); setCheckMsg(null);
    const r = await checkConnection(s);
    setChecking(false);
    setCheckMsg(r.ok
      ? { ok: true, text: `连接成功${r.models?.length ? `，上游返回 ${r.models.length} 个模型` : ""}` }
      : { ok: false, text: `连接失败：${r.error}` });
  };

  const doFetch = async () => {
    if (!s.apiKey.trim()) { setCheckMsg({ ok: false, text: "请先填写 API Key" }); return; }
    setFetching(true); setCheckMsg(null);
    const r = await fetchModelIds(loadProviders(), provider);
    setFetching(false);
    if (!r.ok) {
      setCheckMsg({ ok: false, text: `拉取失败：${r.error}` });
      return;
    }
    if (r.models.length === 0) {
      setCheckMsg({ ok: false, text: "上游返回 0 个模型" });
      return;
    }
    // 弹出选择面板，由用户勾选需要添加的模型
    setFetchedModels(r.models);
  };

  const confirmFetch = (selected: string[]) => {
    const { state, added } = mergeSelectedModels(loadProviders(), provider, selected);
    saveProviders(state);
    setS(state[provider]);
    onChanged();
    setFetchedModels(null);
    setCheckMsg({
      ok: true,
      text: added > 0 ? `已添加 ${added} 个模型` : "所选模型均已存在，无新增",
    });
  };

  const addModel = () => {
    const id = newModel.trim();
    if (!id) return;
    if (s.models.some((m) => m.id === id)) { setNewModel(""); return; }
    persist({ ...s, models: [...s.models, { id, enabled: true, custom: true }] });
    setNewModel("");
  };

  return (
    <div className="space-y-4 border-t p-3">
      <div className="space-y-2">
        <Label>API Key</Label>
        <div className="flex gap-2">
          <Input
            type={showKey ? "text" : "password"}
            value={s.apiKey}
            onChange={(e) => set({ apiKey: e.target.value })}
            placeholder={provider === "gemini" ? "AIza…" : "sk-…"}
            className="flex-1"
            autoComplete="off"
          />
          <Button variant="outline" size="icon" onClick={() => setShowKey((v) => !v)} title={showKey ? "隐藏" : "显示"}>
            {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Base URL</Label>
          <Input value={s.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label>请求模式</Label>
          <Select
            value={s.requestMode}
            onValueChange={(v) => set({ requestMode: v as RequestMode })}
            options={[
              { value: "direct", label: "前端直连（Key 不出浏览器）" },
              { value: "proxy", label: "后端代理（可跨域）" },
            ]}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={doCheck} disabled={checking || fetching}>
          {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
          检查连接
        </Button>
        <Button variant="outline" size="sm" onClick={doFetch} disabled={checking || fetching} title="从上游 /models 拉取并合并到模型列表">
          {fetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          获取模型列表
        </Button>
        {checkMsg && (
          <span className={`text-sm ${checkMsg.ok ? "text-green-600" : "text-destructive"}`}>{checkMsg.text}</span>
        )}
      </div>
      <div className="space-y-2">
        <Label>模型列表</Label>
        <p className="text-xs text-muted-foreground">
          代理模式下经服务器中转拉取（可绕开浏览器跨域限制）；直连模式由浏览器直接请求上游。
        </p>
        <div className="space-y-1">
          {s.models.map((m) => (
            <div key={m.id} className="flex items-center gap-2 rounded border px-2 py-1.5">
              <Switch
                checked={m.enabled}
                onCheckedChange={(v) => persist({ ...s, models: s.models.map((x) => (x.id === m.id ? { ...x, enabled: v } : x)) })}
                aria-label={`启用模型 ${m.id}`}
              />
              <span className="min-w-0 flex-1 truncate text-sm">{m.id}</span>
              {m.custom && <Badge variant="outline">自定义</Badge>}
              <Button
                variant="ghost" size="icon" title="删除"
                onClick={() => persist({ ...s, models: s.models.filter((x) => x.id !== m.id) })}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
            placeholder="输入模型 ID，如 gpt-4o"
            className="flex-1"
            onKeyDown={(e) => { if (e.key === "Enter") addModel(); }}
          />
          <Button variant="outline" size="sm" onClick={addModel}><Plus className="h-4 w-4" /> 添加</Button>
        </div>
      </div>
      {fetchedModels && (
        <ModelFetchDialog
          models={fetchedModels}
          existing={new Set(s.models.map((m) => m.id))}
          onClose={() => setFetchedModels(null)}
          onConfirm={confirmFetch}
        />
      )}
    </div>
  );
}

function KeySyncTab() {
  const [keys, setKeys] = React.useState<ApiKeyMeta[]>([]);
  const [label, setLabel] = React.useState("");
  const [baseUrl, setBaseUrl] = React.useState("https://api.openai.com/v1");
  const [apiKey, setApiKey] = React.useState("");
  const [consent, setConsent] = React.useState(false);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    const r = await api.keys();
    setKeys(r.items);
  }, []);
  React.useEffect(() => { load().catch(() => {}); }, [load]);

  const submit = async () => {
    setError(""); setBusy(true);
    try {
      await api.createKey({
        label: label.trim(), base_url: baseUrl.trim(), api_key: apiKey, consent,
      });
      setLabel(""); setApiKey(""); setConsent(false);
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
          Key 将经 AES-256-GCM 加密存储在服务器数据库中，仅你本人可用。后端代理时会按 Base URL 自动匹配。
          即便如此，仍建议优先使用浏览器本地存储（模型配置里的 Key 输入框），不要同步到服务器。
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
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        {keys.length === 0 && <div className="text-sm text-muted-foreground">暂无</div>}
      </div>
      <Separator />
      <div className="space-y-3">
        <div className="font-medium">同步新的 Key</div>
        <div className="space-y-2">
          <Label>备注</Label>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="如：我的 OpenAI Key" />
        </div>
        <div className="space-y-2">
          <Label>Base URL（代理时按此匹配）</Label>
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
