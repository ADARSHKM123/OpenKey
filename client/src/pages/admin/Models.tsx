import { useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { PageBody, PageHeader } from "../../components/layout/AppShell";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { Input, Label, Select } from "../../components/ui/input";
import { Badge } from "../../components/ui/badge";
import { Card, CardBody } from "../../components/ui/card";
import { invalidateQueries, useQuery } from "../../hooks/useQuery";
import { api } from "../../lib/api";
import { useToast } from "../../context/ToastContext";

interface Route {
  id?: string;
  priority: number;
  weight: number;
  upstreamModel: string;
  inputCostPer1M: string;
  outputCostPer1M: string;
  cachedInputCostPer1M: string | null;
  defaultMaxTokens: number;
  provider: { id: string; provider: string; label: string };
}

interface Alias {
  id: string;
  alias: string;
  displayName: string;
  description: string | null;
  enabled: boolean;
  routes?: Route[];
}

interface Provider {
  id: string;
  provider: string;
  label: string;
}

export function AdminModels() {
  const { data: aliases, loading, error, refetch } = useQuery<Alias[]>("/api/aliases");
  const { data: providers } = useQuery<Provider[]>("/api/providers");
  const toast = useToast();
  const [editing, setEditing] = useState<Alias | "new" | null>(null);

  const refresh = () => {
    invalidateQueries("/api/aliases");
    void refetch();
  };

  const toggle = async (a: Alias) => {
    try {
      await api(`/api/aliases/${a.id}`, { method: "PATCH", body: { enabled: !a.enabled } });
      toast("success", `${a.alias} ${a.enabled ? "disabled" : "enabled"} — live in <5s`);
      refresh();
    } catch (err) {
      toast("error", (err as Error).message);
    }
  };

  const remove = async (a: Alias) => {
    if (!window.confirm(`Delete alias "${a.alias}"? Requests using it will start failing immediately.`)) return;
    try {
      await api(`/api/aliases/${a.id}`, { method: "DELETE" });
      toast("success", "Alias deleted");
      refresh();
    } catch (err) {
      toast("error", (err as Error).message);
    }
  };

  return (
    <>
      <PageHeader
        title="Model aliases"
        description="What employees see. Each alias hides an ordered fallback chain of real providers."
        actions={
          <Button variant="primary" size="sm" onClick={() => setEditing("new")}>
            <Plus className="h-3.5 w-3.5" /> New alias
          </Button>
        }
      />
      <PageBody>
        {loading && <div className="h-32 animate-pulse rounded-lg bg-surface" />}
        {error && <p className="text-sm text-red-400">{error.message}</p>}
        {aliases && aliases.length === 0 && (
          <Card>
            <CardBody className="py-14 text-center text-sm text-zinc-500">
              No aliases yet. Create one (e.g. <span className="font-mono text-zinc-300">smart-model</span>) and chain
              providers behind it.
            </CardBody>
          </Card>
        )}
        <div className="space-y-3">
          {aliases?.map((a) => (
            <Card key={a.id}>
              <CardBody className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-accent">{a.alias}</span>
                    <span className="text-sm text-zinc-300">{a.displayName}</span>
                    {!a.enabled && <Badge tone="amber">disabled</Badge>}
                  </div>
                  {a.description && <p className="mt-0.5 text-xs text-zinc-500">{a.description}</p>}
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    {(a.routes ?? [])
                      .sort((x, y) => x.priority - y.priority)
                      .map((r, i) => (
                        <div key={r.id ?? i} className="flex items-center gap-1.5">
                          {i > 0 && <span className="text-2xs text-zinc-600">→</span>}
                          <span className="rounded border border-line-strong bg-surface-2 px-2 py-1 text-2xs text-zinc-300">
                            <span className="text-zinc-500">{r.provider.provider}</span> {r.upstreamModel}
                            <span className="tnum ml-1.5 text-zinc-600">
                              ${r.inputCostPer1M}/${r.outputCostPer1M} per 1M
                            </span>
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(a)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void toggle(a)}>
                    {a.enabled ? "Disable" : "Enable"}
                  </Button>
                  <Button size="icon" variant="ghost" aria-label={`Delete ${a.alias}`} onClick={() => void remove(a)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      </PageBody>

      {editing && (
        <AliasDialog
          alias={editing === "new" ? null : editing}
          providers={providers ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
    </>
  );
}

interface RouteDraft {
  providerId: string;
  upstreamModel: string;
  weight: number;
  inputCostPer1M: string;
  outputCostPer1M: string;
  cachedInputCostPer1M: string;
  defaultMaxTokens: number;
}

function AliasDialog({
  alias,
  providers,
  onClose,
  onSaved,
}: {
  alias: Alias | null;
  providers: Provider[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(alias?.alias ?? "");
  const [displayName, setDisplayName] = useState(alias?.displayName ?? "");
  const [description, setDescription] = useState(alias?.description ?? "");
  const [routes, setRoutes] = useState<RouteDraft[]>(
    (alias?.routes ?? [])
      .sort((a, b) => a.priority - b.priority)
      .map((r) => ({
        providerId: r.provider.id,
        upstreamModel: r.upstreamModel,
        weight: r.weight,
        inputCostPer1M: r.inputCostPer1M,
        outputCostPer1M: r.outputCostPer1M,
        cachedInputCostPer1M: r.cachedInputCostPer1M ?? "",
        defaultMaxTokens: r.defaultMaxTokens,
      })),
  );
  const [busy, setBusy] = useState(false);

  const addRoute = () =>
    setRoutes((r) => [
      ...r,
      {
        providerId: providers[0]?.id ?? "",
        upstreamModel: "",
        weight: 100,
        inputCostPer1M: "0",
        outputCostPer1M: "0",
        cachedInputCostPer1M: "",
        defaultMaxTokens: 4096,
      },
    ]);

  const move = (i: number, dir: -1 | 1) =>
    setRoutes((r) => {
      const next = [...r];
      const j = i + dir;
      if (j < 0 || j >= next.length) return r;
      const a = next[i];
      const b = next[j];
      if (!a || !b) return r;
      next[i] = b;
      next[j] = a;
      return next;
    });

  const patch = (i: number, p: Partial<RouteDraft>) =>
    setRoutes((r) => r.map((route, idx) => (idx === i ? { ...route, ...p } : route)));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (routes.length === 0) {
      toast("info", "An alias needs at least one route.");
      return;
    }
    setBusy(true);
    try {
      const body = {
        alias: name,
        displayName,
        description: description || null,
        routes: routes.map((r, i) => ({
          providerId: r.providerId,
          upstreamModel: r.upstreamModel,
          priority: i, // position in the list IS the fallback order
          weight: r.weight,
          inputCostPer1M: r.inputCostPer1M,
          outputCostPer1M: r.outputCostPer1M,
          cachedInputCostPer1M: r.cachedInputCostPer1M.trim() === "" ? null : r.cachedInputCostPer1M,
          defaultMaxTokens: r.defaultMaxTokens,
        })),
      };
      if (alias) await api(`/api/aliases/${alias.id}`, { method: "PATCH", body });
      else await api("/api/aliases", { method: "POST", body });
      toast("success", alias ? "Alias updated — live in <5s" : "Alias created");
      onSaved();
    } catch (err) {
      toast("error", (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={alias ? `Edit ${alias.alias}` : "New model alias"} wide>
      <form onSubmit={submit}>
        <div className="mb-3 grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="al-name">Alias (what developers call)</Label>
            <Input id="al-name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="smart-model" className="font-mono" />
          </div>
          <div>
            <Label htmlFor="al-display">Display name (what employees see)</Label>
            <Input id="al-display" required value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Claude (best quality)" />
          </div>
        </div>
        <div className="mb-4">
          <Label htmlFor="al-desc">Plain-English description</Label>
          <Input id="al-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Best for writing and analysis" />
        </div>

        <div className="mb-2 flex items-center justify-between">
          <Label className="mb-0">Fallback chain (top = primary)</Label>
          <Button type="button" size="sm" onClick={addRoute} disabled={providers.length === 0}>
            <Plus className="h-3.5 w-3.5" /> Add route
          </Button>
        </div>
        {providers.length === 0 && <p className="mb-3 text-xs text-amber-400">Connect a provider first.</p>}
        <div className="mb-4 space-y-2">
          {routes.map((r, i) => (
            <div key={i} className="rounded border border-line bg-surface p-3">
              <div className="mb-2 flex items-center gap-2">
                <Badge tone={i === 0 ? "accent" : "neutral"}>{i === 0 ? "primary" : `fallback ${i}`}</Badge>
                <div className="ml-auto flex gap-1">
                  <Button type="button" size="icon" variant="ghost" aria-label="Move up" onClick={() => move(i, -1)} disabled={i === 0}>
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button type="button" size="icon" variant="ghost" aria-label="Move down" onClick={() => move(i, 1)} disabled={i === routes.length - 1}>
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button>
                  <Button type="button" size="icon" variant="ghost" aria-label="Remove route" onClick={() => setRoutes((x) => x.filter((_, idx) => idx !== i))}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Select value={r.providerId} onChange={(e) => patch(i, { providerId: e.target.value })}>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label} ({p.provider})
                    </option>
                  ))}
                </Select>
                <Input
                  required
                  value={r.upstreamModel}
                  onChange={(e) => patch(i, { upstreamModel: e.target.value })}
                  placeholder="upstream model id"
                  className="font-mono text-xs"
                />
              </div>
              <div className="mt-2 grid grid-cols-4 gap-2">
                <div>
                  <Label className="mb-1 text-2xs">$ in / 1M</Label>
                  <Input required inputMode="decimal" value={r.inputCostPer1M} onChange={(e) => patch(i, { inputCostPer1M: e.target.value })} />
                </div>
                <div>
                  <Label className="mb-1 text-2xs">$ out / 1M</Label>
                  <Input required inputMode="decimal" value={r.outputCostPer1M} onChange={(e) => patch(i, { outputCostPer1M: e.target.value })} />
                </div>
                <div>
                  <Label className="mb-1 text-2xs">$ cached / 1M</Label>
                  <Input inputMode="decimal" value={r.cachedInputCostPer1M} onChange={(e) => patch(i, { cachedInputCostPer1M: e.target.value })} placeholder="—" />
                </div>
                <div>
                  <Label className="mb-1 text-2xs">Max tokens</Label>
                  <Input
                    required
                    inputMode="numeric"
                    value={String(r.defaultMaxTokens)}
                    onChange={(e) => patch(i, { defaultMaxTokens: Number(e.target.value) || 4096 })}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            {alias ? "Save changes" : "Create alias"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
