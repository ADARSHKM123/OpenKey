import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { KeyRound, Plus, Sparkles } from "lucide-react";
import { PageBody, PageHeader } from "../../components/layout/AppShell";
import { Card, CardBody, CardHeader } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { Input, Label } from "../../components/ui/input";
import { RadialGauge } from "../../components/portal/RadialGauge";
import { Snippets } from "../../components/portal/Snippets";
import { KeyRevealDialog } from "../../components/portal/KeyReveal";
import { useAuthState } from "../../context/AuthContext";
import { useKeysState } from "../../context/KeysContext";
import { useKeysActions } from "../../hooks/useKeysActions";
import { useQuery } from "../../hooks/useQuery";
import { useToast } from "../../context/ToastContext";
import { api } from "../../lib/api";
import { formatUsd } from "../../lib/format";

interface UsageMe {
  monthToDateUsd: string;
  monthlyBudgetUsd: string | null;
}

interface AliasCard {
  id: string;
  alias: string;
  displayName: string;
  description: string | null;
}

export function PortalHome() {
  const { user } = useAuthState();
  const { keys, status } = useKeysState();
  const { load, create } = useKeysActions();
  const { data: usage } = useQuery<UsageMe>("/api/usage/me");
  const { data: aliases } = useQuery<AliasCard[]>("/api/aliases");
  const toast = useToast();
  const [revealed, setRevealed] = useState<string | null>(null);
  const [budgetOpen, setBudgetOpen] = useState(false);

  useEffect(() => {
    if (status === "idle") void load();
  }, [status, load]);

  const activeKey = keys.find((k) => !k.revokedAt);

  const createFirstKey = async () => {
    try {
      const { rawKey } = await create({ name: `${user?.name ?? "My"} — default` });
      setRevealed(rawKey);
    } catch (err) {
      toast("error", (err as Error).message);
    }
  };

  return (
    <>
      <PageHeader title={`Hey, ${user?.name?.split(" ")[0] ?? "there"}`} description="Your gateway access at a glance" />
      <PageBody>
        <div className="mb-4 grid gap-4 lg:grid-cols-3">
          {/* Hero: the API key */}
          <Card className="lg:col-span-2">
            <CardHeader
              title="Your API key"
              description="Works with any OpenAI-compatible SDK"
              actions={
                activeKey ? (
                  <Link to="/portal/keys" className="text-xs text-zinc-400 underline-offset-2 hover:text-zinc-200 hover:underline">
                    Manage keys
                  </Link>
                ) : undefined
              }
            />
            <CardBody>
              {status === "loading" && <div className="h-10 animate-pulse rounded bg-surface-2" />}
              {status === "ready" && activeKey && (
                <div className="flex items-center gap-3 rounded border border-line-strong bg-[#0c0c0e] px-3.5 py-3">
                  <KeyRound className="h-4 w-4 shrink-0 text-accent" />
                  <code className="font-mono text-sm text-zinc-200">
                    {activeKey.keyPrefix}
                    <span className="text-zinc-600">••••••••••••••••••••</span>
                  </code>
                  <span className="ml-auto text-2xs text-zinc-600">
                    full key shown once at creation — rotate to get a new one
                  </span>
                </div>
              )}
              {status === "ready" && !activeKey && (
                <div className="flex flex-col items-center rounded border border-dashed border-line-strong py-8">
                  <p className="mb-3 text-sm text-zinc-400">You don't have a key yet.</p>
                  <Button variant="primary" onClick={() => void createFirstKey()}>
                    <Plus className="h-4 w-4" /> Create my API key
                  </Button>
                </div>
              )}
            </CardBody>
          </Card>

          {/* Spend meter */}
          <Card>
            <CardHeader
              title="This month"
              actions={
                <Button size="sm" variant="ghost" onClick={() => setBudgetOpen(true)}>
                  Request more
                </Button>
              }
            />
            <CardBody className="flex flex-col items-center">
              <RadialGauge
                spent={Number(usage?.monthToDateUsd ?? 0)}
                budget={usage?.monthlyBudgetUsd ? Number(usage.monthlyBudgetUsd) : null}
              />
              <p className="tnum mt-1 text-xs text-zinc-500">
                <span className="font-medium text-zinc-200">{formatUsd(usage?.monthToDateUsd ?? 0)}</span>
                {usage?.monthlyBudgetUsd ? ` of ${formatUsd(usage.monthlyBudgetUsd)}` : " spent — no personal limit"}
              </p>
            </CardBody>
          </Card>
        </div>

        {/* Snippets */}
        <div className="mb-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Connect in one line</h2>
          <Snippets apiKey={revealed ?? "YOUR_OPENKEY_API_KEY"} />
        </div>

        {/* Model catalog */}
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Models you can use</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(aliases ?? []).map((a) => (
            <Card key={a.id}>
              <CardBody className="py-3.5">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-3.5 w-3.5 text-accent" />
                  <p className="text-sm font-medium text-zinc-100">{a.displayName}</p>
                </div>
                <p className="mt-1 text-xs text-zinc-500">{a.description ?? "Ready to use."}</p>
                <code className="mt-2 inline-block rounded bg-surface-2 px-1.5 py-0.5 font-mono text-2xs text-zinc-400">
                  model: "{a.alias}"
                </code>
              </CardBody>
            </Card>
          ))}
          {aliases?.length === 0 && (
            <p className="col-span-full rounded border border-dashed border-line py-8 text-center text-xs text-zinc-600">
              No models published yet — ask your admin.
            </p>
          )}
        </div>
      </PageBody>

      {revealed && <KeyRevealDialog rawKey={revealed} onClose={() => setRevealed(null)} />}
      {budgetOpen && <BudgetRequestDialog onClose={() => setBudgetOpen(false)} />}
    </>
  );
}

function BudgetRequestDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/api/budget-requests", {
        method: "POST",
        body: { requestedUsd: amount.trim(), ...(reason.trim() ? { reason: reason.trim() } : {}) },
      });
      toast("success", "Request sent — your admin will see it in their approval queue.");
      onClose();
    } catch (err) {
      toast("error", (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Request a bigger budget"
      description="Goes straight to your admin's approval queue — no Slack messages needed."
    >
      <form onSubmit={submit}>
        <div className="mb-3">
          <Label htmlFor="br-amount">New monthly budget (USD)</Label>
          <Input id="br-amount" required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="100" />
        </div>
        <div className="mb-4">
          <Label htmlFor="br-reason">Why? (optional, but it helps)</Label>
          <Input id="br-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Running evals for the Q3 launch" />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            Send request
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
