import { useMemo, useState } from "react";
import { PageBody, PageHeader } from "../../components/layout/AppShell";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input, Select } from "../../components/ui/input";
import { Table, TableState, Td, Th } from "../../components/ui/table";
import { useQuery } from "../../hooks/useQuery";
import { api } from "../../lib/api";
import { formatDateTime, formatMs, formatUsd } from "../../lib/format";

interface LogRow {
  id: string;
  user_id: string;
  team_id: string | null;
  provider: string;
  upstream_model: string;
  status: number;
  error_code: string | null;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  cost_usd: string;
  cache_hit: boolean;
  fell_back_from: string | null;
  latency_ms: number;
  ttft_ms: number | null;
  streamed: boolean;
  approximate_cost: boolean;
  created_at: string;
}

interface LogsResponse {
  rows: LogRow[];
  nextCursor: string | null;
}

export function AdminLogs() {
  const [status, setStatus] = useState("");
  const [model, setModel] = useState("");
  const [minCost, setMinCost] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [pages, setPages] = useState<LogRow[][]>([]);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    p.set("limit", "50");
    if (status) p.set("status", status);
    if (model) p.set("model", model);
    if (minCost) p.set("minCost", minCost);
    if (cursor) p.set("cursor", cursor);
    return `/api/logs?${p.toString()}`;
  }, [status, model, minCost, cursor]);

  const { data, loading, error, refetch } = useQuery<LogsResponse>(query);
  const [selected, setSelected] = useState<LogRow | null>(null);

  const rows = [...pages.flat(), ...(data?.rows ?? [])];

  const resetFilters = () => {
    setCursor(null);
    setPages([]);
  };

  return (
    <>
      <PageHeader
        title="Request logs"
        description="Every request, chat or API, in one place — your data, your Postgres"
        actions={
          <div className="flex items-center gap-2">
            <Input
              value={model}
              onChange={(e) => {
                setModel(e.target.value);
                resetFilters();
              }}
              placeholder="upstream model…"
              className="h-8 w-44"
            />
            <Select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                resetFilters();
              }}
              className="h-8 w-32"
            >
              <option value="">any status</option>
              <option value="200">200 OK</option>
              <option value="429">429 limited</option>
              <option value="499">499 disconnect</option>
              <option value="502">502 upstream</option>
            </Select>
            <Input
              value={minCost}
              onChange={(e) => {
                setMinCost(e.target.value);
                resetFilters();
              }}
              placeholder="min $"
              inputMode="decimal"
              className="h-8 w-20"
            />
          </div>
        }
      />
      <PageBody className="max-w-none">
        <div className="rounded-lg border border-line bg-surface">
          <Table>
            <thead>
              <tr>
                <Th>Time</Th>
                <Th>Model</Th>
                <Th>Status</Th>
                <Th className="text-right">Tokens in/out</Th>
                <Th className="text-right">Cost</Th>
                <Th className="text-right">Latency</Th>
                <Th>Flags</Th>
              </tr>
            </thead>
            <tbody>
              <TableState
                loading={loading && rows.length === 0}
                error={error}
                empty={!loading && rows.length === 0}
                emptyMessage="No requests match. Traffic appears here within seconds of hitting /v1."
                colSpan={7}
                onRetry={() => void refetch()}
              />
              {rows.map((r) => (
                <tr key={r.id} className="cursor-pointer hover:bg-surface-2/50" onClick={() => setSelected(r)}>
                  <Td className="tnum whitespace-nowrap text-xs text-zinc-500">{formatDateTime(r.created_at)}</Td>
                  <Td>
                    <span className="font-mono text-xs text-zinc-300">{r.upstream_model}</span>
                    <span className="ml-1.5 text-2xs text-zinc-600">{r.provider}</span>
                  </Td>
                  <Td>
                    <StatusBadge status={r.status} errorCode={r.error_code} />
                  </Td>
                  <Td className="tnum text-right text-xs">
                    {r.input_tokens.toLocaleString()} / {r.output_tokens.toLocaleString()}
                  </Td>
                  <Td className="tnum text-right text-xs">
                    {formatUsd(r.cost_usd)}
                    {r.approximate_cost && <span className="ml-0.5 text-zinc-600" title="tokenizer estimate">≈</span>}
                  </Td>
                  <Td className="tnum text-right text-xs text-zinc-400">{formatMs(r.latency_ms)}</Td>
                  <Td>
                    <div className="flex gap-1">
                      {r.streamed && <Badge>stream</Badge>}
                      {r.cache_hit && <Badge tone="accent">cache</Badge>}
                      {r.fell_back_from && <Badge tone="amber">fallback</Badge>}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {data?.nextCursor && (
            <div className="border-t border-line p-2 text-center">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setPages((p) => [...p, data.rows]);
                  setCursor(data.nextCursor);
                }}
              >
                Load more
              </Button>
            </div>
          )}
        </div>
      </PageBody>
      {selected && <LogDrawer row={selected} onClose={() => setSelected(null)} />}
    </>
  );
}

function StatusBadge({ status, errorCode }: { status: number; errorCode: string | null }) {
  if (status < 400) return <Badge tone="accent">{status}</Badge>;
  if (status === 499) return <Badge tone="neutral">499</Badge>;
  return (
    <Badge tone={status === 429 ? "amber" : "red"}>
      {status}
      {errorCode ? ` ${errorCode}` : ""}
    </Badge>
  );
}

function LogDrawer({ row, onClose }: { row: LogRow; onClose: () => void }) {
  const [payload, setPayload] = useState<{ requestBody: unknown; responseBody: unknown } | "loading" | "denied" | null>(null);

  const loadPayload = async () => {
    setPayload("loading");
    try {
      setPayload(await api(`/api/logs/${row.id}/payload`));
    } catch (err) {
      setPayload((err as { status?: number }).status === 403 ? "denied" : null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      <div className="flex-1 bg-black/50 backdrop-blur-[1px]" />
      <aside
        className="w-full max-w-lg overflow-y-auto border-l border-line-strong bg-surface p-5 shadow-2xl animate-fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="font-mono text-xs text-zinc-500">{row.id}</h2>
            <p className="mt-1 text-sm font-medium text-zinc-100">
              {row.upstream_model} <span className="text-zinc-500">via {row.provider}</span>
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
        <dl className="mb-5 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          <Meta label="Status" value={String(row.status)} />
          <Meta label="Error" value={row.error_code ?? "—"} />
          <Meta label="Input tokens" value={row.input_tokens.toLocaleString()} />
          <Meta label="Output tokens" value={row.output_tokens.toLocaleString()} />
          <Meta label="Cached tokens" value={row.cached_tokens.toLocaleString()} />
          <Meta label="Cost" value={`${formatUsd(row.cost_usd)}${row.approximate_cost ? " (approx.)" : ""}`} />
          <Meta label="Latency" value={formatMs(row.latency_ms)} />
          <Meta label="Time to first token" value={formatMs(row.ttft_ms)} />
          <Meta label="Fell back from" value={row.fell_back_from ?? "—"} />
          <Meta label="When" value={formatDateTime(row.created_at)} />
        </dl>
        {payload === null && (
          <Button size="sm" onClick={() => void loadPayload()}>
            View request / response
          </Button>
        )}
        {payload === "loading" && <div className="h-24 animate-pulse rounded bg-surface-2" />}
        {payload === "denied" && (
          <p className="rounded border border-amber-900/40 bg-amber-950/20 px-3 py-2 text-xs text-amber-300">
            This org's policy does not allow admins to view prompt content.
          </p>
        )}
        {payload !== null && payload !== "loading" && payload !== "denied" && (
          <>
            <p className="mb-1 text-2xs font-semibold uppercase tracking-wide text-zinc-500">Request</p>
            <pre className="mb-3 max-h-64 overflow-auto rounded border border-line bg-[#0c0c0e] p-3 font-mono text-2xs leading-relaxed text-zinc-300">
              {JSON.stringify(payload.requestBody, null, 2)}
            </pre>
            <p className="mb-1 text-2xs font-semibold uppercase tracking-wide text-zinc-500">Response</p>
            <pre className="max-h-64 overflow-auto rounded border border-line bg-[#0c0c0e] p-3 font-mono text-2xs leading-relaxed text-zinc-300">
              {JSON.stringify(payload.responseBody, null, 2)}
            </pre>
          </>
        )}
      </aside>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-zinc-600">{label}</dt>
      <dd className="tnum mt-0.5 text-zinc-300">{value}</dd>
    </div>
  );
}
