import { useState, type FormEvent } from "react";
import { CheckCircle2, Plug, Plus, Trash2, XCircle } from "lucide-react";
import { PageBody, PageHeader } from "../../components/layout/AppShell";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { Input, Label, Select } from "../../components/ui/input";
import { Badge } from "../../components/ui/badge";
import { Card, CardBody } from "../../components/ui/card";
import { invalidateQueries, useQuery } from "../../hooks/useQuery";
import { api } from "../../lib/api";
import { useToast } from "../../context/ToastContext";
import { formatRelative } from "../../lib/format";

interface Provider {
  id: string;
  provider: string;
  label: string;
  enabled: boolean;
  healthy: boolean;
  lastCheckedAt: string | null;
}

// Per-provider credential fields. The config JSON is sent once, encrypted at
// rest, and never returned by the API — editing always means re-entering.
const PROVIDER_FIELDS: Record<string, { key: string; label: string; placeholder: string; required: boolean; secret?: boolean }[]> = {
  bedrock: [
    { key: "region", label: "AWS region", placeholder: "us-east-1", required: true },
    { key: "accessKeyId", label: "Access key ID (blank = IAM role)", placeholder: "AKIA…", required: false },
    { key: "secretAccessKey", label: "Secret access key", placeholder: "", required: false, secret: true },
  ],
  azure_openai: [
    { key: "endpoint", label: "Endpoint", placeholder: "https://myresource.openai.azure.com", required: true },
    { key: "apiKey", label: "API key", placeholder: "", required: true, secret: true },
    { key: "apiVersion", label: "API version", placeholder: "2024-10-21", required: false },
  ],
  anthropic: [
    { key: "apiKey", label: "API key", placeholder: "sk-ant-…", required: true, secret: true },
  ],
  openai: [
    { key: "apiKey", label: "API key", placeholder: "sk-…", required: true, secret: true },
    { key: "baseUrl", label: "Base URL (optional)", placeholder: "https://api.openai.com/v1", required: false },
  ],
  ollama: [{ key: "baseUrl", label: "Base URL", placeholder: "http://ollama:11434", required: true }],
  mock: [],
};

const TEST_MODEL_HINT: Record<string, string> = {
  bedrock: "anthropic.claude-haiku-4-v1:0",
  azure_openai: "gpt-4o-mini",
  anthropic: "claude-haiku-4-5",
  openai: "gpt-4o-mini",
  ollama: "llama3.2",
  mock: "mock-small",
};

export function AdminProviders() {
  const { data: providers, loading, error, refetch } = useQuery<Provider[]>("/api/providers");
  const toast = useToast();
  const [addOpen, setAddOpen] = useState(false);

  const refresh = () => {
    invalidateQueries("/api/providers");
    void refetch();
  };

  const toggle = async (p: Provider) => {
    try {
      await api(`/api/providers/${p.id}`, { method: "PATCH", body: { enabled: !p.enabled } });
      toast("success", `${p.label} ${p.enabled ? "disabled" : "enabled"}`);
      refresh();
    } catch (err) {
      toast("error", (err as Error).message);
    }
  };

  const remove = async (p: Provider) => {
    if (!window.confirm(`Delete provider "${p.label}"?`)) return;
    try {
      await api(`/api/providers/${p.id}`, { method: "DELETE" });
      toast("success", "Provider deleted");
      refresh();
    } catch (err) {
      toast("error", (err as Error).message);
    }
  };

  return (
    <>
      <PageHeader
        title="Providers"
        description="Your own cloud credentials — encrypted at rest, never displayed, never leaving this deployment"
        actions={
          <Button variant="primary" size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Connect provider
          </Button>
        }
      />
      <PageBody>
        {loading && <div className="h-32 animate-pulse rounded-lg bg-surface" />}
        {error && <p className="text-sm text-red-400">{error.message}</p>}
        {providers && providers.length === 0 && (
          <Card>
            <CardBody className="flex flex-col items-center py-14 text-center">
              <Plug className="mb-3 h-8 w-8 text-zinc-700" />
              <p className="text-sm font-medium text-zinc-300">No providers connected</p>
              <p className="mt-1 max-w-sm text-xs text-zinc-500">
                Connect AWS Bedrock, Azure OpenAI, Anthropic or OpenAI with your own credentials. OpenKey never proxies
                through anyone else's servers.
              </p>
              <Button variant="primary" size="sm" className="mt-4" onClick={() => setAddOpen(true)}>
                <Plus className="h-3.5 w-3.5" /> Connect provider
              </Button>
            </CardBody>
          </Card>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          {providers?.map((p) => (
            <Card key={p.id}>
              <CardBody className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-zinc-100">{p.label}</p>
                    <Badge tone="neutral">{p.provider}</Badge>
                    {!p.enabled && <Badge tone="amber">disabled</Badge>}
                  </div>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-zinc-500">
                    {p.healthy ? (
                      <>
                        <CheckCircle2 className="h-3.5 w-3.5 text-accent" /> healthy
                      </>
                    ) : (
                      <>
                        <XCircle className="h-3.5 w-3.5 text-red-400" /> failing
                      </>
                    )}
                    <span className="text-zinc-700">·</span> checked {formatRelative(p.lastCheckedAt)}
                  </p>
                </div>
                <div className="flex gap-1">
                  <TestButton provider={p} onDone={refresh} />
                  <Button size="sm" variant="ghost" onClick={() => void toggle(p)}>
                    {p.enabled ? "Disable" : "Enable"}
                  </Button>
                  <Button size="icon" variant="ghost" aria-label={`Delete ${p.label}`} onClick={() => void remove(p)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      </PageBody>

      <AddProviderDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSaved={() => {
          setAddOpen(false);
          refresh();
        }}
      />
    </>
  );
}

function TestButton({ provider, onDone }: { provider: Provider; onDone: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    const model = window.prompt("Upstream model id to test with:", TEST_MODEL_HINT[provider.provider] ?? "");
    if (!model) return;
    setBusy(true);
    try {
      const res = await api<{ ok: boolean; error?: string; latencyMs: number }>(`/api/providers/${provider.id}/test`, {
        method: "POST",
        body: { model },
      });
      if (res.ok) toast("success", `Connection OK (${res.latencyMs}ms)`);
      else toast("error", res.error ?? "Test failed");
      onDone();
    } catch (err) {
      toast("error", (err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button size="sm" variant="ghost" loading={busy} onClick={() => void run()}>
      Test
    </Button>
  );
}

function AddProviderDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [kind, setKind] = useState("bedrock");
  const [label, setLabel] = useState("");
  const [config, setConfig] = useState<Record<string, string>>({});
  const [testModel, setTestModel] = useState("");
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string; latencyMs: number } | null>(null);
  const [busy, setBusy] = useState<"test" | "save" | null>(null);

  const fields = PROVIDER_FIELDS[kind] ?? [];
  const cleanConfig = () =>
    Object.fromEntries(Object.entries(config).filter(([, v]) => v.trim() !== ""));

  const runTest = async () => {
    setBusy("test");
    setTestResult(null);
    try {
      const res = await api<{ ok: boolean; error?: string; latencyMs: number }>("/api/providers/test", {
        method: "POST",
        body: { provider: kind, config: cleanConfig(), model: testModel || TEST_MODEL_HINT[kind] },
      });
      setTestResult(res);
    } catch (err) {
      setTestResult({ ok: false, error: (err as Error).message, latencyMs: 0 });
    } finally {
      setBusy(null);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    // Never let an admin save a credential they haven't proven works.
    if (!testResult?.ok) {
      toast("info", "Run a successful test before saving.");
      return;
    }
    setBusy("save");
    try {
      await api("/api/providers", { method: "POST", body: { provider: kind, label, config: cleanConfig() } });
      toast("success", "Provider connected");
      onSaved();
      setLabel("");
      setConfig({});
      setTestResult(null);
    } catch (err) {
      toast("error", (err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Connect provider"
      description="Credentials are encrypted with your master key and can never be read back."
    >
      <form onSubmit={submit}>
        <div className="mb-3">
          <Label htmlFor="np-kind">Provider</Label>
          <Select
            id="np-kind"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setConfig({});
              setTestResult(null);
            }}
          >
            <option value="bedrock">AWS Bedrock</option>
            <option value="azure_openai">Azure OpenAI</option>
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
            <option value="ollama">Ollama (local)</option>
            <option value="mock">Mock (testing)</option>
          </Select>
        </div>
        <div className="mb-3">
          <Label htmlFor="np-label">Label</Label>
          <Input id="np-label" required value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Bedrock us-east-1 (prod)" />
        </div>
        {fields.map((f) => (
          <div key={f.key} className="mb-3">
            <Label htmlFor={`np-${f.key}`}>{f.label}</Label>
            <Input
              id={`np-${f.key}`}
              type={f.secret ? "password" : "text"}
              required={f.required}
              value={config[f.key] ?? ""}
              onChange={(e) => setConfig((c) => ({ ...c, [f.key]: e.target.value }))}
              placeholder={f.placeholder}
              autoComplete="off"
            />
          </div>
        ))}
        <div className="mb-4">
          <Label htmlFor="np-testmodel">Test with model</Label>
          <div className="flex gap-2">
            <Input
              id="np-testmodel"
              value={testModel}
              onChange={(e) => setTestModel(e.target.value)}
              placeholder={TEST_MODEL_HINT[kind]}
            />
            <Button type="button" loading={busy === "test"} onClick={() => void runTest()}>
              Test connection
            </Button>
          </div>
          {testResult && (
            <p
              role="status"
              className={`mt-2 rounded border px-3 py-2 text-xs ${
                testResult.ok
                  ? "border-accent/30 bg-accent-faint text-accent"
                  : "border-red-900/50 bg-red-950/30 text-red-300"
              }`}
            >
              {testResult.ok ? `Success — 1-token round trip in ${testResult.latencyMs}ms` : testResult.error}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy === "save"} disabled={!testResult?.ok}>
            Save provider
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
