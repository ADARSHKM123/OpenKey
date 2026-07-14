import { useState, type FormEvent } from "react";
import { Plus, Trash2, UserPlus, X } from "lucide-react";
import { PageBody, PageHeader } from "../../components/layout/AppShell";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { Input, Label, Select } from "../../components/ui/input";
import { Badge } from "../../components/ui/badge";
import { Table, TableState, Td, Th } from "../../components/ui/table";
import { useQuery, invalidateQueries } from "../../hooks/useQuery";
import { api } from "../../lib/api";
import { useToast } from "../../context/ToastContext";
import { formatUsd } from "../../lib/format";

interface Team {
  id: string;
  name: string;
  monthlyBudgetUsd: string | null;
  allowedModels: string[];
  members: { id: string; name: string; email: string }[];
}

interface UserRow {
  id: string;
  name: string;
  email: string;
}

export function AdminTeams() {
  const { data: teams, loading, error, refetch } = useQuery<Team[]>("/api/teams");
  const { data: users } = useQuery<UserRow[]>("/api/users");
  const toast = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Team | null>(null);

  const refresh = () => {
    invalidateQueries("/api/teams");
    void refetch();
  };

  const removeTeam = async (team: Team) => {
    if (!window.confirm(`Delete team "${team.name}"? Keys billed to it fall back to user-level attribution.`)) return;
    try {
      await api(`/api/teams/${team.id}`, { method: "DELETE" });
      toast("success", `Team "${team.name}" deleted`);
      refresh();
    } catch (err) {
      toast("error", (err as Error).message);
    }
  };

  return (
    <>
      <PageHeader
        title="Teams"
        description="Budgets and model access, enforced live in under 5 seconds"
        actions={
          <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> New team
          </Button>
        }
      />
      <PageBody>
        <div className="rounded-lg border border-line bg-surface">
          <Table>
            <thead>
              <tr>
                <Th>Team</Th>
                <Th>Monthly budget</Th>
                <Th>Allowed models</Th>
                <Th>Members</Th>
                <Th className="w-24" />
              </tr>
            </thead>
            <tbody>
              <TableState
                loading={loading}
                error={error}
                empty={!teams || teams.length === 0}
                emptyMessage="No teams yet. Create one to start attributing spend."
                colSpan={5}
                onRetry={() => void refetch()}
              />
              {teams?.map((team) => (
                <tr key={team.id} className="group hover:bg-surface-2/50">
                  <Td className="font-medium text-zinc-100">{team.name}</Td>
                  <Td className="tnum">{team.monthlyBudgetUsd ? formatUsd(team.monthlyBudgetUsd) : <span className="text-zinc-600">unlimited</span>}</Td>
                  <Td>
                    {team.allowedModels.length === 0 ? (
                      <span className="text-zinc-600">all models</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {team.allowedModels.map((m) => (
                          <Badge key={m} tone="blue">{m}</Badge>
                        ))}
                      </div>
                    )}
                  </Td>
                  <Td className="tnum">{team.members.length}</Td>
                  <Td>
                    <div className="flex justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(team)}>
                        Edit
                      </Button>
                      <Button size="icon" variant="ghost" aria-label={`Delete ${team.name}`} onClick={() => void removeTeam(team)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </PageBody>

      <TeamDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={() => {
          setCreateOpen(false);
          refresh();
        }}
      />
      {editing && (
        <TeamDialog
          team={editing}
          users={users ?? []}
          open
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

function TeamDialog({
  team,
  users = [],
  open,
  onClose,
  onSaved,
}: {
  team?: Team;
  users?: UserRow[];
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(team?.name ?? "");
  const [budget, setBudget] = useState(team?.monthlyBudgetUsd ?? "");
  const [models, setModels] = useState((team?.allowedModels ?? []).join(", "));
  const [addUserId, setAddUserId] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = {
        name,
        monthlyBudgetUsd: budget.trim() === "" ? null : budget.trim(),
        allowedModels: models.split(",").map((s) => s.trim()).filter(Boolean),
      };
      if (team) await api(`/api/teams/${team.id}`, { method: "PATCH", body });
      else await api("/api/teams", { method: "POST", body });
      toast("success", team ? "Team updated — live in <5s" : "Team created");
      onSaved();
    } catch (err) {
      toast("error", (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const addMember = async () => {
    if (!team || !addUserId) return;
    try {
      await api(`/api/teams/${team.id}/members`, { method: "POST", body: { userId: addUserId } });
      toast("success", "Member added");
      setAddUserId("");
      onSaved();
    } catch (err) {
      toast("error", (err as Error).message);
    }
  };

  const removeMember = async (userId: string) => {
    if (!team) return;
    try {
      await api(`/api/teams/${team.id}/members/${userId}`, { method: "DELETE" });
      toast("success", "Member removed");
      onSaved();
    } catch (err) {
      toast("error", (err as Error).message);
    }
  };

  const nonMembers = users.filter((u) => !team?.members.some((m) => m.id === u.id));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={team ? `Edit ${team.name}` : "New team"}>
      <form onSubmit={submit}>
        <div className="mb-3">
          <Label htmlFor="team-name">Name</Label>
          <Input id="team-name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Marketing" />
        </div>
        <div className="mb-3">
          <Label htmlFor="team-budget">Monthly budget (USD)</Label>
          <Input
            id="team-budget"
            value={budget ?? ""}
            onChange={(e) => setBudget(e.target.value)}
            placeholder="empty = unlimited"
            inputMode="decimal"
          />
          <p className="mt-1 text-2xs text-zinc-600">Requests over this ceiling get a 429 — including mid-stream.</p>
        </div>
        <div className="mb-4">
          <Label htmlFor="team-models">Allowed model aliases</Label>
          <Input
            id="team-models"
            value={models}
            onChange={(e) => setModels(e.target.value)}
            placeholder="comma-separated; empty = all"
          />
        </div>

        {team && (
          <div className="mb-4 rounded border border-line bg-surface p-3">
            <p className="mb-2 text-xs font-medium text-zinc-400">Members</p>
            <ul className="mb-2 space-y-1">
              {team.members.length === 0 && <li className="text-2xs text-zinc-600">No members yet.</li>}
              {team.members.map((m) => (
                <li key={m.id} className="flex items-center justify-between text-xs text-zinc-300">
                  <span>
                    {m.name} <span className="text-zinc-600">{m.email}</span>
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${m.name}`}
                    onClick={() => void removeMember(m.id)}
                    className="rounded p-0.5 text-zinc-600 hover:text-red-400"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <Select value={addUserId} onChange={(e) => setAddUserId(e.target.value)}>
                <option value="">Add a member…</option>
                {nonMembers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.email})
                  </option>
                ))}
              </Select>
              <Button type="button" size="sm" disabled={!addUserId} onClick={() => void addMember()}>
                <UserPlus className="h-3.5 w-3.5" /> Add
              </Button>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            {team ? "Save changes" : "Create team"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
