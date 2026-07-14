import { useEffect, useState, type FormEvent } from "react";
import { PageBody, PageHeader } from "../../components/layout/AppShell";
import { Button } from "../../components/ui/button";
import { Card, CardBody, CardHeader } from "../../components/ui/card";
import { Input, Label } from "../../components/ui/input";
import { invalidateQueries, useQuery } from "../../hooks/useQuery";
import { api } from "../../lib/api";
import { useToast } from "../../context/ToastContext";

interface Org {
  id: string;
  name: string;
  monthlyBudgetUsd: string | null;
  settings: {
    adminCanViewPrompts?: boolean;
    storeRawPrompts?: boolean;
    logRetentionDays?: number;
  };
}

export function AdminSettings() {
  const { data: org, loading, refetch } = useQuery<Org>("/api/org");
  const toast = useToast();
  const [name, setName] = useState("");
  const [budget, setBudget] = useState("");
  const [retention, setRetention] = useState("90");
  const [adminPrompts, setAdminPrompts] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!org) return;
    setName(org.name);
    setBudget(org.monthlyBudgetUsd ?? "");
    setRetention(String(org.settings.logRetentionDays ?? 90));
    setAdminPrompts(org.settings.adminCanViewPrompts !== false);
  }, [org]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/api/org", {
        method: "PATCH",
        body: {
          name,
          monthlyBudgetUsd: budget.trim() === "" ? null : budget.trim(),
          settings: {
            logRetentionDays: Number(retention) || 90,
            adminCanViewPrompts: adminPrompts,
          },
        },
      });
      toast("success", "Org settings saved — live in <5s");
      invalidateQueries("/api/org");
      void refetch();
    } catch (err) {
      toast("error", (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Settings" description="Org-wide policies" />
      <PageBody className="max-w-2xl">
        {loading ? (
          <div className="h-64 animate-pulse rounded-lg bg-surface" />
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <Card>
              <CardHeader title="Organization" />
              <CardBody className="space-y-3">
                <div>
                  <Label htmlFor="org-name">Name</Label>
                  <Input id="org-name" required value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="org-budget">Org monthly budget (USD)</Label>
                  <Input id="org-budget" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="empty = unlimited" inputMode="decimal" />
                  <p className="mt-1 text-2xs text-zinc-600">
                    The outermost ceiling. Team, user and key budgets can only tighten it, never widen it.
                  </p>
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Privacy & retention" />
              <CardBody className="space-y-4">
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={adminPrompts}
                    onChange={(e) => setAdminPrompts(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-emerald-500"
                  />
                  <span>
                    <span className="block text-sm text-zinc-200">Admins may view prompt content</span>
                    <span className="mt-0.5 block text-xs text-zinc-500">
                      When off, admins see costs and metadata but never the text of employee prompts. The flip itself is
                      audit-logged.
                    </span>
                  </span>
                </label>
                <div>
                  <Label htmlFor="org-retention">Log retention (days)</Label>
                  <Input id="org-retention" value={retention} onChange={(e) => setRetention(e.target.value)} inputMode="numeric" className="w-32" />
                  <p className="mt-1 text-2xs text-zinc-600">
                    Whole monthly partitions older than this are dropped — cheap at any volume.
                  </p>
                </div>
              </CardBody>
            </Card>

            <div className="flex justify-end">
              <Button type="submit" variant="primary" loading={busy}>
                Save settings
              </Button>
            </div>
          </form>
        )}
      </PageBody>
    </>
  );
}
