import { useEffect, useState, type FormEvent } from "react";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { PageBody, PageHeader } from "../../components/layout/AppShell";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { Input, Label, Select } from "../../components/ui/input";
import { Table, TableState, Td, Th } from "../../components/ui/table";
import { KeyRevealDialog } from "../../components/portal/KeyReveal";
import { useAuthState } from "../../context/AuthContext";
import { useKeysState } from "../../context/KeysContext";
import { useKeysActions } from "../../hooks/useKeysActions";
import { useToast } from "../../context/ToastContext";
import { formatDate, formatRelative, formatUsd } from "../../lib/format";

export function PortalKeys() {
  const { user } = useAuthState();
  const { keys, status, error } = useKeysState();
  const { load, create, rotate, revoke } = useKeysActions();
  const toast = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);

  useEffect(() => {
    if (status === "idle") void load();
  }, [status, load]);

  const doRotate = async (id: string, name: string) => {
    if (!window.confirm(`Rotate "${name}"? The current secret stops working within seconds.`)) return;
    try {
      const { rawKey } = await rotate(id);
      setRevealed(rawKey);
    } catch (err) {
      toast("error", (err as Error).message);
    }
  };

  const doRevoke = async (id: string, name: string) => {
    if (!window.confirm(`Revoke "${name}"? This is instant and irreversible.`)) return;
    try {
      await revoke(id);
      toast("success", "Key revoked — dead on every gateway node in <5s");
    } catch (err) {
      toast("error", (err as Error).message);
    }
  };

  return (
    <>
      <PageHeader
        title="API keys"
        description="Create, rotate and revoke. Revocation is instant and irreversible."
        actions={
          <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> New key
          </Button>
        }
      />
      <PageBody>
        <div className="rounded-lg border border-line bg-surface">
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Key</Th>
                <Th>Team</Th>
                <Th>Budget</Th>
                <Th>Last used</Th>
                <Th>Status</Th>
                <Th className="w-24" />
              </tr>
            </thead>
            <tbody>
              <TableState
                loading={status === "loading" || status === "idle"}
                error={error ? new Error(error) : null}
                empty={status === "ready" && keys.length === 0}
                emptyMessage="No keys yet. Create one to start calling the gateway."
                colSpan={7}
                onRetry={() => void load()}
              />
              {keys.map((k) => (
                <tr key={k.id} className="group hover:bg-surface-2/50">
                  <Td className="font-medium text-zinc-100">{k.name}</Td>
                  <Td>
                    <code className="font-mono text-xs text-zinc-400">{k.keyPrefix}…</code>
                  </Td>
                  <Td className="text-xs text-zinc-500">
                    {user?.teams.find((t) => t.id === k.teamId)?.name ?? <span className="text-zinc-600">personal</span>}
                  </Td>
                  <Td className="tnum text-xs">{k.monthlyBudgetUsd ? formatUsd(k.monthlyBudgetUsd) : <span className="text-zinc-600">—</span>}</Td>
                  <Td className="text-xs text-zinc-500">{formatRelative(k.lastUsedAt)}</Td>
                  <Td>
                    {k.revokedAt ? (
                      <Badge tone="red">revoked</Badge>
                    ) : k.expiresAt && new Date(k.expiresAt) < new Date() ? (
                      <Badge tone="amber">expired</Badge>
                    ) : (
                      <Badge tone="accent">active</Badge>
                    )}
                  </Td>
                  <Td>
                    {!k.revokedAt && (
                      <div className="flex justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <Button size="icon" variant="ghost" aria-label={`Rotate ${k.name}`} onClick={() => void doRotate(k.id, k.name)}>
                          <RefreshCw className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" aria-label={`Revoke ${k.name}`} onClick={() => void doRevoke(k.id, k.name)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
        <p className="mt-3 text-2xs text-zinc-600">
          Created {formatDate(new Date())} keys inherit your personal and team budgets automatically — a key budget can
          only tighten them further.
        </p>
      </PageBody>

      {createOpen && (
        <CreateKeyDialog
          teams={user?.teams ?? []}
          onClose={() => setCreateOpen(false)}
          onCreated={(raw) => {
            setCreateOpen(false);
            setRevealed(raw);
          }}
        />
      )}
      {revealed && <KeyRevealDialog rawKey={revealed} onClose={() => setRevealed(null)} />}
    </>
  );
}

function CreateKeyDialog({
  teams,
  onClose,
  onCreated,
}: {
  teams: { id: string; name: string }[];
  onClose: () => void;
  onCreated: (rawKey: string) => void;
}) {
  const { create } = useKeysActions();
  const toast = useToast();
  const [name, setName] = useState("");
  const [teamId, setTeamId] = useState("");
  const [budget, setBudget] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { rawKey } = await create({
        name,
        teamId: teamId || null,
        monthlyBudgetUsd: budget.trim() === "" ? null : budget.trim(),
      });
      onCreated(rawKey);
    } catch (err) {
      toast("error", (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="New API key">
      <form onSubmit={submit}>
        <div className="mb-3">
          <Label htmlFor="nk-name">Name</Label>
          <Input id="nk-name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Laptop dev key" />
        </div>
        {teams.length > 0 && (
          <div className="mb-3">
            <Label htmlFor="nk-team">Bill to team</Label>
            <Select id="nk-team" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              <option value="">Personal (no team)</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </div>
        )}
        <div className="mb-4">
          <Label htmlFor="nk-budget">Key budget (USD / month, optional)</Label>
          <Input id="nk-budget" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="empty = inherit yours" />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            Create key
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
