import { useState } from "react";
import { PageBody, PageHeader } from "../../components/layout/AppShell";
import { Card, CardBody, CardHeader } from "../../components/ui/card";
import { useQuery } from "../../hooks/useQuery";
import { formatCount, formatMs, formatUsd } from "../../lib/format";
import { BudgetBar, ModelDonut, SpendAreaChart, TeamBarChart } from "../../components/charts/viz";
import { cn } from "../../lib/cn";

interface Summary {
  totals: {
    requests: number;
    spendUsd: string;
    inputTokens: number;
    outputTokens: number;
    errorRate: number;
    latencyP50Ms: number | null;
    latencyP95Ms: number | null;
  };
  monthToDateUsd: string;
  byDay: { day: string; spendUsd: string; requests: number }[];
  byTeam: { teamId: string | null; teamName: string; spendUsd: string }[];
  byModel: { provider: string; model: string; spendUsd: string; requests: number }[];
  topUsers: { userId: string; name: string | null; email: string | null; spendUsd: string; requests: number }[];
}

interface Org {
  monthlyBudgetUsd: string | null;
}

const WINDOWS = [7, 30, 90] as const;

export function AdminOverview() {
  const [days, setDays] = useState<(typeof WINDOWS)[number]>(30);
  const { data, loading, error } = useQuery<Summary>(`/api/usage/summary?days=${days}`);
  const { data: org } = useQuery<Org>("/api/org");

  return (
    <>
      <PageHeader
        title="Overview"
        description="Org-wide spend, traffic and health"
        actions={
          <div className="flex rounded border border-line-strong bg-surface p-0.5">
            {WINDOWS.map((w) => (
              <button
                key={w}
                onClick={() => setDays(w)}
                className={cn(
                  "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                  days === w ? "bg-surface-3 text-zinc-100" : "text-zinc-500 hover:text-zinc-300",
                )}
              >
                {w}d
              </button>
            ))}
          </div>
        }
      />
      <PageBody>
        {error && <p className="mb-4 text-sm text-red-400">{error.message}</p>}

        {/* Stat tiles */}
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Spend" value={formatUsd(data?.totals.spendUsd)} sub={`last ${days} days`} loading={loading} />
          <StatTile label="Requests" value={formatCount(data?.totals.requests)} sub={`last ${days} days`} loading={loading} />
          <StatTile
            label="Latency p50 / p95"
            value={data ? `${formatMs(data.totals.latencyP50Ms)} / ${formatMs(data.totals.latencyP95Ms)}` : "—"}
            sub="end to end"
            loading={loading}
          />
          <StatTile
            label="Error rate"
            value={data ? `${(data.totals.errorRate * 100).toFixed(1)}%` : "—"}
            sub="status ≥ 400"
            loading={loading}
            alert={!!data && data.totals.errorRate > 0.05}
          />
        </div>

        {/* Month-to-date vs budget */}
        <Card className="mb-4">
          <CardBody className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <p className="text-xs text-zinc-500">Month-to-date spend</p>
              <p className="tnum mt-1 text-3xl font-semibold tracking-tight text-zinc-50">
                {formatUsd(data?.monthToDateUsd)}
              </p>
            </div>
            <div className="w-full max-w-xs">
              <BudgetBar
                spent={Number(data?.monthToDateUsd ?? 0)}
                budget={org?.monthlyBudgetUsd ? Number(org.monthlyBudgetUsd) : null}
              />
            </div>
          </CardBody>
        </Card>

        <div className="mb-4 grid gap-4 lg:grid-cols-5">
          <Card className="lg:col-span-3">
            <CardHeader title="Spend by day" />
            <CardBody>
              {loading ? (
                <div className="h-[220px] animate-pulse rounded bg-surface-2" />
              ) : data && data.byDay.length > 0 ? (
                <SpendAreaChart
                  data={data.byDay.map((d) => ({
                    label: new Date(d.day).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
                    spend: Number(d.spendUsd),
                  }))}
                />
              ) : (
                <EmptyViz message="No traffic yet. Point a client at /v1 to see spend here." />
              )}
            </CardBody>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader title="Spend by model" />
            <CardBody>
              {loading ? (
                <div className="h-[150px] animate-pulse rounded bg-surface-2" />
              ) : data && data.byModel.length > 0 ? (
                <ModelDonut data={data.byModel.map((m) => ({ name: m.model, spend: Number(m.spendUsd) }))} />
              ) : (
                <EmptyViz message="No model usage yet." />
              )}
            </CardBody>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Spend by team" />
            <CardBody>
              {loading ? (
                <div className="h-[120px] animate-pulse rounded bg-surface-2" />
              ) : data && data.byTeam.length > 0 ? (
                <TeamBarChart data={data.byTeam.map((t) => ({ name: t.teamName, spend: Number(t.spendUsd) }))} />
              ) : (
                <EmptyViz message="No team activity yet." />
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Top spenders" />
            <CardBody className="p-0">
              {loading ? (
                <div className="m-4 h-[120px] animate-pulse rounded bg-surface-2" />
              ) : data && data.topUsers.length > 0 ? (
                <ul>
                  {data.topUsers.slice(0, 8).map((u, i) => (
                    <li key={u.userId} className="flex items-center gap-3 border-b border-line/60 px-4 py-2 last:border-0">
                      <span className="w-4 text-2xs text-zinc-600">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-zinc-300">{u.name ?? u.email ?? u.userId}</p>
                      </div>
                      <span className="tnum text-xs text-zinc-500">{formatCount(u.requests)} req</span>
                      <span className="tnum w-20 text-right text-xs font-medium text-zinc-200">{formatUsd(u.spendUsd)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyViz message="Nobody has spent anything yet." className="m-4" />
              )}
            </CardBody>
          </Card>
        </div>
      </PageBody>
    </>
  );
}

function StatTile({
  label,
  value,
  sub,
  loading,
  alert,
}: {
  label: string;
  value: string;
  sub: string;
  loading: boolean;
  alert?: boolean;
}) {
  return (
    <Card>
      <CardBody className="py-3.5">
        <p className="text-2xs font-medium uppercase tracking-wide text-zinc-500">{label}</p>
        {loading ? (
          <div className="mt-2 h-6 w-24 animate-pulse rounded bg-surface-3" />
        ) : (
          <p className={cn("tnum mt-1 text-xl font-semibold tracking-tight", alert ? "text-red-400" : "text-zinc-50")}>
            {value}
          </p>
        )}
        <p className="mt-0.5 text-2xs text-zinc-600">{sub}</p>
      </CardBody>
    </Card>
  );
}

function EmptyViz({ message, className }: { message: string; className?: string }) {
  return (
    <div className={cn("flex h-[120px] items-center justify-center rounded border border-dashed border-line text-xs text-zinc-600", className)}>
      {message}
    </div>
  );
}
