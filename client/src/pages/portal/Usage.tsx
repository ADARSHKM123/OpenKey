import { PageBody, PageHeader } from "../../components/layout/AppShell";
import { Card, CardBody, CardHeader } from "../../components/ui/card";
import { SpendAreaChart } from "../../components/charts/viz";
import { useQuery } from "../../hooks/useQuery";
import { formatUsd } from "../../lib/format";

interface UsageMe {
  monthToDateUsd: string;
  monthlyBudgetUsd: string | null;
  byDay: { day: string; spendUsd: string; requests: number }[];
  byModel: { aliasId: string | null; model: string; spendUsd: string; requests: number }[];
}

export function PortalUsage() {
  const { data, loading, error } = useQuery<UsageMe>("/api/usage/me?days=30");

  return (
    <>
      <PageHeader title="My usage" description="Your last 30 days — chat and API traffic combined" />
      <PageBody>
        {error && <p className="mb-4 text-sm text-red-400">{error.message}</p>}
        <div className="mb-4 grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
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
                <div className="flex h-[120px] items-center justify-center rounded border border-dashed border-line text-xs text-zinc-600">
                  Nothing yet — your first request will show up here.
                </div>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Month to date" />
            <CardBody>
              <p className="tnum text-3xl font-semibold tracking-tight text-zinc-50">{formatUsd(data?.monthToDateUsd)}</p>
              <p className="mt-1 text-xs text-zinc-500">
                {data?.monthlyBudgetUsd ? `of your ${formatUsd(data.monthlyBudgetUsd)} budget` : "no personal limit set"}
              </p>
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardHeader title="By model" />
          <CardBody className="p-0">
            {loading ? (
              <div className="m-4 h-24 animate-pulse rounded bg-surface-2" />
            ) : data && data.byModel.length > 0 ? (
              <ul>
                {data.byModel.map((m) => (
                  <li key={m.model} className="flex items-center justify-between border-b border-line/60 px-4 py-2.5 text-xs last:border-0">
                    <span className="font-mono text-zinc-300">{m.model}</span>
                    <span className="text-zinc-600">{m.requests.toLocaleString()} requests</span>
                    <span className="tnum w-24 text-right font-medium text-zinc-200">{formatUsd(m.spendUsd)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-6 text-center text-xs text-zinc-600">No usage yet this month.</p>
            )}
          </CardBody>
        </Card>
      </PageBody>
    </>
  );
}
