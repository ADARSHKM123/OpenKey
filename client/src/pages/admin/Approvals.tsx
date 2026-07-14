import { PageBody, PageHeader } from "../../components/layout/AppShell";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardBody } from "../../components/ui/card";
import { invalidateQueries, useQuery } from "../../hooks/useQuery";
import { api } from "../../lib/api";
import { useToast } from "../../context/ToastContext";
import { formatRelative, formatUsd } from "../../lib/format";

interface BudgetRequest {
  id: string;
  user: { id: string; name?: string; email?: string };
  currentBudgetUsd: string | null;
  requestedUsd: string;
  reason: string | null;
  status: string;
  createdAt: string;
}

export function AdminApprovals() {
  const { data, loading, error, refetch } = useQuery<BudgetRequest[]>("/api/budget-requests?status=pending");
  const { data: decided } = useQuery<BudgetRequest[]>("/api/budget-requests");
  const toast = useToast();

  const decide = async (req: BudgetRequest, decision: "approved" | "denied") => {
    try {
      await api(`/api/budget-requests/${req.id}/decide`, { method: "POST", body: { decision } });
      toast(
        "success",
        decision === "approved"
          ? `${req.user.name ?? "User"}'s budget is now ${formatUsd(req.requestedUsd)} — live in <5s`
          : "Request denied",
      );
      invalidateQueries("/api/budget-requests");
      void refetch();
    } catch (err) {
      toast("error", (err as Error).message);
    }
  };

  const history = (decided ?? []).filter((r) => r.status !== "pending").slice(0, 10);

  return (
    <>
      <PageHeader title="Budget approvals" description="Employees ask here instead of messaging IT on Slack" />
      <PageBody>
        {loading && <div className="h-24 animate-pulse rounded-lg bg-surface" />}
        {error && <p className="text-sm text-red-400">{error.message}</p>}
        {data && data.length === 0 && (
          <Card className="mb-6">
            <CardBody className="py-10 text-center text-sm text-zinc-500">No pending requests. Inbox zero.</CardBody>
          </Card>
        )}
        <div className="mb-8 space-y-3">
          {data?.map((req) => (
            <Card key={req.id}>
              <CardBody className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-zinc-100">
                    {req.user.name ?? req.user.email ?? req.user.id}
                    <span className="ml-2 text-xs text-zinc-500">{formatRelative(req.createdAt)}</span>
                  </p>
                  <p className="tnum mt-1 text-xs text-zinc-400">
                    {formatUsd(req.currentBudgetUsd) === "—" ? "unlimited" : formatUsd(req.currentBudgetUsd)} →{" "}
                    <span className="font-medium text-accent">{formatUsd(req.requestedUsd)}</span> per month
                  </p>
                  {req.reason && <p className="mt-1 max-w-lg text-xs italic text-zinc-500">“{req.reason}”</p>}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="danger" onClick={() => void decide(req, "denied")}>
                    Deny
                  </Button>
                  <Button size="sm" variant="primary" onClick={() => void decide(req, "approved")}>
                    Approve {formatUsd(req.requestedUsd)}
                  </Button>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>

        {history.length > 0 && (
          <>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Recently decided</h2>
            <div className="space-y-1.5">
              {history.map((r) => (
                <div key={r.id} className="flex items-center justify-between rounded border border-line bg-surface px-3 py-2 text-xs">
                  <span className="text-zinc-400">
                    {r.user.name ?? r.user.email} → <span className="tnum">{formatUsd(r.requestedUsd)}</span>
                  </span>
                  <Badge tone={r.status === "approved" ? "accent" : "red"}>{r.status}</Badge>
                </div>
              ))}
            </div>
          </>
        )}
      </PageBody>
    </>
  );
}
