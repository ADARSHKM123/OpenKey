import { useState } from "react";
import { Download } from "lucide-react";
import { PageBody, PageHeader } from "../../components/layout/AppShell";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Table, TableState, Td, Th } from "../../components/ui/table";
import { useQuery } from "../../hooks/useQuery";
import { formatDateTime } from "../../lib/format";

interface AuditRow {
  id: string;
  actorUserId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  before: unknown;
  after: unknown;
  ip: string | null;
  hash: string;
  createdAt: string;
}

export function AdminAudit() {
  const { data, loading, error, refetch } = useQuery<AuditRow[]>("/api/audit?limit=200");
  const [expanded, setExpanded] = useState<string | null>(null);

  const exportJson = () => {
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `openkey-audit-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Append-only and hash-chained — tampering is rejected by the database and evident in the chain"
        actions={
          <Button size="sm" onClick={exportJson} disabled={!data?.length}>
            <Download className="h-3.5 w-3.5" /> Export JSON
          </Button>
        }
      />
      <PageBody className="max-w-none">
        <div className="rounded-lg border border-line bg-surface">
          <Table>
            <thead>
              <tr>
                <Th>Time</Th>
                <Th>Action</Th>
                <Th>Target</Th>
                <Th>Actor</Th>
                <Th>IP</Th>
                <Th>Chain</Th>
              </tr>
            </thead>
            <tbody>
              <TableState
                loading={loading}
                error={error}
                empty={!data || data.length === 0}
                emptyMessage="Nothing audited yet."
                colSpan={6}
                onRetry={() => void refetch()}
              />
              {data?.map((row) => (
                <>
                  <tr
                    key={row.id}
                    className="cursor-pointer hover:bg-surface-2/50"
                    onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                  >
                    <Td className="tnum whitespace-nowrap text-xs text-zinc-500">{formatDateTime(row.createdAt)}</Td>
                    <Td>
                      <ActionBadge action={row.action} />
                    </Td>
                    <Td className="text-xs">
                      <span className="text-zinc-500">{row.targetType}</span>{" "}
                      <span className="font-mono text-2xs text-zinc-400">{row.targetId.slice(0, 12)}…</span>
                    </Td>
                    <Td className="font-mono text-2xs text-zinc-500">{row.actorUserId?.slice(0, 12) ?? "system"}</Td>
                    <Td className="font-mono text-2xs text-zinc-500">{row.ip ?? "—"}</Td>
                    <Td className="font-mono text-2xs text-zinc-600" title={row.hash}>
                      {row.hash.slice(0, 10)}…
                    </Td>
                  </tr>
                  {expanded === row.id && (
                    <tr key={`${row.id}-detail`}>
                      <Td colSpan={6} className="bg-[#0c0c0e]">
                        <div className="grid gap-3 py-1 md:grid-cols-2">
                          <DiffBlock label="Before" value={row.before} />
                          <DiffBlock label="After" value={row.after} />
                        </div>
                      </Td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </Table>
        </div>
      </PageBody>
    </>
  );
}

function ActionBadge({ action }: { action: string }) {
  const tone = action.includes("delete") || action.includes("revoked") || action.includes("suspended")
    ? "red"
    : action.includes("created") || action.includes("approved")
      ? "accent"
      : "neutral";
  return <Badge tone={tone}>{action}</Badge>;
}

function DiffBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <p className="mb-1 text-2xs font-semibold uppercase tracking-wide text-zinc-600">{label}</p>
      <pre className="max-h-40 overflow-auto rounded border border-line p-2 font-mono text-2xs text-zinc-400">
        {value ? JSON.stringify(value, null, 2) : "—"}
      </pre>
    </div>
  );
}
