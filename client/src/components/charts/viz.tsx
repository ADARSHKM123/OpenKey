import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatUsd } from "../../lib/format";

// Chart layer. Palette validated (dataviz six checks) against surface
// #111113: fixed slot order is the CVD-safety mechanism — assign by entity
// order, never re-sort survivors when filters change. >6 entities fold into
// "Other". Single-series charts use the product accent.

export const SERIES = ["#3987e5", "#199e70", "#c98500", "#008300", "#9085e9", "#e66767"] as const;
export const OTHER_COLOR = "#6b7280";
const GRID = "#26262b";
const MUTED = "#898781";
const ACCENT = "#34d399";

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number | string; color?: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded border border-line-strong bg-surface-2 px-2.5 py-1.5 text-xs shadow-lg shadow-black/40">
      {label && <p className="mb-1 font-medium text-zinc-300">{label}</p>}
      {payload.map((p, i) => (
        <p key={i} className="flex items-center gap-1.5 text-zinc-400">
          {p.color && <span className="inline-block h-2 w-2 rounded-sm" style={{ background: p.color }} />}
          {p.name}: <span className="tnum text-zinc-200">{formatUsd(p.value ?? 0)}</span>
        </p>
      ))}
    </div>
  );
}

export function SpendAreaChart({ data }: { data: { label: string; spend: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="spendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ACCENT} stopOpacity={0.25} />
            <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="label" tick={{ fill: MUTED, fontSize: 11 }} axisLine={{ stroke: GRID }} tickLine={false} minTickGap={28} />
        <YAxis
          tick={{ fill: MUTED, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={52}
          tickFormatter={(v: number) => formatUsd(v, { compact: true })}
        />
        <Tooltip content={<ChartTooltip />} cursor={{ stroke: GRID }} />
        <Area type="monotone" dataKey="spend" name="Spend" stroke={ACCENT} strokeWidth={2} fill="url(#spendFill)" dot={false} activeDot={{ r: 3.5 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function TeamBarChart({ data }: { data: { name: string; spend: number }[] }) {
  const shown = foldOther(data, (d) => d.spend, 6).map((d, i) => ({
    ...d,
    fill: d.name === "Other" ? OTHER_COLOR : (SERIES[i % SERIES.length] as string),
  }));
  return (
    <ResponsiveContainer width="100%" height={Math.max(shown.length * 34 + 16, 120)}>
      <BarChart data={shown} layout="vertical" margin={{ top: 0, right: 48, bottom: 0, left: 8 }}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="name" width={110} tick={{ fill: "#c3c2b7", fontSize: 12 }} axisLine={false} tickLine={false} />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
        <Bar
          dataKey="spend"
          name="Spend"
          radius={[0, 4, 4, 0]}
          barSize={16}
          label={{
            position: "right",
            fill: MUTED,
            fontSize: 11,
            formatter: (v: unknown) => formatUsd(typeof v === "number" ? v : Number(v ?? 0), { compact: true }),
          }}
        >
          {shown.map((d) => (
            <Cell key={d.name} fill={d.fill} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ModelDonut({ data }: { data: { name: string; spend: number }[] }) {
  const shown = foldOther(data, (d) => d.spend, 5);
  const total = shown.reduce((s, d) => s + d.spend, 0);
  return (
    <div className="flex items-center gap-5">
      <div className="relative h-[150px] w-[150px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={shown}
              dataKey="spend"
              nameKey="name"
              innerRadius={48}
              outerRadius={70}
              paddingAngle={2}
              stroke="#111113"
              strokeWidth={2}
            >
              {shown.map((d, i) => (
                <Cell key={d.name} fill={d.name === "Other" ? OTHER_COLOR : (SERIES[i % SERIES.length] as string)} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xs text-zinc-500">total</span>
          <span className="text-sm font-semibold text-zinc-100">{formatUsd(total, { compact: true })}</span>
        </div>
      </div>
      <ul className="min-w-0 flex-1 space-y-1.5">
        {shown.map((d, i) => (
          <li key={d.name} className="flex items-center gap-2 text-xs">
            <span
              className="h-2 w-2 shrink-0 rounded-sm"
              style={{ background: d.name === "Other" ? OTHER_COLOR : SERIES[i % SERIES.length] }}
            />
            <span className="truncate text-zinc-400">{d.name}</span>
            <span className="tnum ml-auto text-zinc-300">{total > 0 ? `${Math.round((d.spend / total) * 100)}%` : "—"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function foldOther<T extends { name: string }>(data: T[], value: (d: T) => number, max: number): { name: string; spend: number }[] {
  const sorted = [...data].sort((a, b) => value(b) - value(a));
  const head = sorted.slice(0, max).map((d) => ({ name: d.name, spend: value(d) }));
  const rest = sorted.slice(max);
  if (rest.length > 0) head.push({ name: "Other", spend: rest.reduce((s, d) => s + value(d), 0) });
  return head;
}

// Budget meter: neutral track, accent fill; amber at 80%, red at 95% — the
// only place charts use status colors, always paired with the % text.
export function BudgetBar({ spent, budget }: { spent: number; budget: number | null }) {
  if (budget === null || budget <= 0) {
    return <p className="text-xs text-zinc-500">No budget set — unlimited.</p>;
  }
  const pct = Math.min(spent / budget, 1);
  const color = pct >= 0.95 ? "#f87171" : pct >= 0.8 ? "#fbbf24" : ACCENT;
  return (
    <div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct * 100}%`, background: color }} />
      </div>
      <p className="tnum mt-1.5 text-xs text-zinc-500">
        <span style={{ color }}>{Math.round(pct * 100)}%</span> of {formatUsd(budget)} this month
      </p>
    </div>
  );
}
