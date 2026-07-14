import { useState, type FormEvent } from "react";
import { Copy, Plus, Search } from "lucide-react";
import { PageBody, PageHeader } from "../../components/layout/AppShell";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { Input, Label, Select } from "../../components/ui/input";
import { Badge } from "../../components/ui/badge";
import { Table, TableState, Td, Th } from "../../components/ui/table";
import { invalidateQueries, useQuery } from "../../hooks/useQuery";
import { api } from "../../lib/api";
import { useToast } from "../../context/ToastContext";
import { formatUsd } from "../../lib/format";

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
  status: string;
  monthlyBudgetUsd: string | null;
  teams: { id: string; name: string }[];
}

export function AdminUsers() {
  const [q, setQ] = useState("");
  const { data: users, loading, error, refetch } = useQuery<UserRow[]>(`/api/users${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  const toast = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [tempCred, setTempCred] = useState<{ email: string; password: string } | null>(null);

  const refresh = () => {
    invalidateQueries("/api/users");
    void refetch();
  };

  const setStatus = async (user: UserRow, status: "active" | "suspended") => {
    try {
      await api(`/api/users/${user.id}`, { method: "PATCH", body: { status } });
      toast("success", status === "suspended" ? `${user.name} suspended — keys stop working in <5s` : `${user.name} reactivated`);
      refresh();
    } catch (err) {
      toast("error", (err as Error).message);
    }
  };

  return (
    <>
      <PageHeader
        title="Users"
        description="Roles, personal budgets, suspension"
        actions={
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search users…" className="h-8 w-56 pl-8" />
            </div>
            <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Add user
            </Button>
          </>
        }
      />
      <PageBody>
        <div className="rounded-lg border border-line bg-surface">
          <Table>
            <thead>
              <tr>
                <Th>User</Th>
                <Th>Role</Th>
                <Th>Teams</Th>
                <Th>Personal budget</Th>
                <Th>Status</Th>
                <Th className="w-32" />
              </tr>
            </thead>
            <tbody>
              <TableState
                loading={loading}
                error={error}
                empty={!users || users.length === 0}
                emptyMessage={q ? "No users match your search." : "No users yet."}
                colSpan={6}
                onRetry={() => void refetch()}
              />
              {users?.map((u) => (
                <tr key={u.id} className="group hover:bg-surface-2/50">
                  <Td>
                    <p className="font-medium text-zinc-100">{u.name}</p>
                    <p className="text-2xs text-zinc-600">{u.email}</p>
                  </Td>
                  <Td>
                    <Badge tone={u.role === "OWNER" ? "accent" : u.role === "ADMIN" ? "blue" : "neutral"}>{u.role}</Badge>
                  </Td>
                  <Td className="text-xs text-zinc-400">{u.teams.map((t) => t.name).join(", ") || <span className="text-zinc-600">—</span>}</Td>
                  <Td className="tnum">{u.monthlyBudgetUsd ? formatUsd(u.monthlyBudgetUsd) : <span className="text-zinc-600">unlimited</span>}</Td>
                  <Td>
                    {u.status === "active" ? (
                      <Badge tone="accent">active</Badge>
                    ) : (
                      <Badge tone="red">{u.status}</Badge>
                    )}
                  </Td>
                  <Td>
                    <div className="flex justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(u)}>
                        Edit
                      </Button>
                      {u.role !== "OWNER" &&
                        (u.status === "active" ? (
                          <Button size="sm" variant="ghost" className="text-red-400" onClick={() => void setStatus(u, "suspended")}>
                            Suspend
                          </Button>
                        ) : (
                          <Button size="sm" variant="ghost" onClick={() => void setStatus(u, "active")}>
                            Reactivate
                          </Button>
                        ))}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </PageBody>

      <CreateUserDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(email, password) => {
          setCreateOpen(false);
          setTempCred({ email, password });
          refresh();
        }}
      />
      {editing && (
        <EditUserDialog
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
      {tempCred && (
        <Dialog
          open
          onOpenChange={() => setTempCred(null)}
          title="One-time password"
          description="Hand this to the employee. It is shown once and stored only as a hash."
        >
          <div className="mb-4 flex items-center justify-between rounded border border-line-strong bg-surface p-3">
            <div>
              <p className="text-xs text-zinc-500">{tempCred.email}</p>
              <p className="mt-1 font-mono text-sm text-zinc-100">{tempCred.password}</p>
            </div>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Copy password"
              onClick={() => void navigator.clipboard.writeText(tempCred.password)}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex justify-end">
            <Button variant="primary" onClick={() => setTempCred(null)}>
              Done
            </Button>
          </div>
        </Dialog>
      )}
    </>
  );
}

function CreateUserDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (email: string, tempPassword: string) => void;
}) {
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("MEMBER");
  const [budget, setBudget] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api<{ tempPassword: string }>("/api/users", {
        method: "POST",
        body: { email, name, role, monthlyBudgetUsd: budget.trim() === "" ? null : budget.trim() },
      });
      onCreated(email, res.tempPassword);
      setEmail("");
      setName("");
      setBudget("");
    } catch (err) {
      toast("error", (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="Add user">
      <form onSubmit={submit}>
        <div className="mb-3">
          <Label htmlFor="nu-name">Name</Label>
          <Input id="nu-name" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="mb-3">
          <Label htmlFor="nu-email">Email</Label>
          <Input id="nu-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="mb-3">
          <Label htmlFor="nu-role">Role</Label>
          <Select id="nu-role" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="MEMBER">Member</option>
            <option value="VIEWER">Viewer</option>
            <option value="ADMIN">Admin</option>
          </Select>
        </div>
        <div className="mb-4">
          <Label htmlFor="nu-budget">Personal monthly budget (USD)</Label>
          <Input id="nu-budget" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="empty = unlimited" inputMode="decimal" />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            Create user
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function EditUserDialog({ user, onClose, onSaved }: { user: UserRow; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(user.name);
  const [role, setRole] = useState(user.role);
  const [budget, setBudget] = useState(user.monthlyBudgetUsd ?? "");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/api/users/${user.id}`, {
        method: "PATCH",
        body: { name, role, monthlyBudgetUsd: budget.trim() === "" ? null : budget.trim() },
      });
      toast("success", "User updated — live in <5s");
      onSaved();
    } catch (err) {
      toast("error", (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`Edit ${user.name}`}>
      <form onSubmit={submit}>
        <div className="mb-3">
          <Label htmlFor="eu-name">Name</Label>
          <Input id="eu-name" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="mb-3">
          <Label htmlFor="eu-role">Role</Label>
          <Select id="eu-role" value={role} onChange={(e) => setRole(e.target.value as UserRow["role"])} disabled={user.role === "OWNER"}>
            <option value="MEMBER">Member</option>
            <option value="VIEWER">Viewer</option>
            <option value="ADMIN">Admin</option>
            {user.role === "OWNER" && <option value="OWNER">Owner</option>}
          </Select>
        </div>
        <div className="mb-4">
          <Label htmlFor="eu-budget">Personal monthly budget (USD)</Label>
          <Input id="eu-budget" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="empty = unlimited" inputMode="decimal" />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            Save changes
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
