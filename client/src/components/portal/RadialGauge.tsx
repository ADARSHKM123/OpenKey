// Spend meter: a half-circle radial gauge. Accent below 80%, amber at 80%,
// red at 95% — the color is always paired with the numeric label, never
// meaning-bearing alone.

export function RadialGauge({ spent, budget }: { spent: number; budget: number | null }) {
  const pct = budget && budget > 0 ? Math.min(spent / budget, 1) : 0;
  const color = pct >= 0.95 ? "#f87171" : pct >= 0.8 ? "#fbbf24" : "#34d399";
  const r = 64;
  const circumference = Math.PI * r; // half circle
  const filled = circumference * pct;

  return (
    <div className="flex flex-col items-center">
      <svg width="160" height="92" viewBox="0 0 160 92" role="img" aria-label={`Used ${Math.round(pct * 100)}% of monthly budget`}>
        <path d={`M 16 84 A ${r} ${r} 0 0 1 144 84`} fill="none" stroke="#1e1e22" strokeWidth="10" strokeLinecap="round" />
        {budget !== null && budget > 0 && (
          <path
            d={`M 16 84 A ${r} ${r} 0 0 1 144 84`}
            fill="none"
            stroke={color}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={`${filled} ${circumference}`}
            style={{ transition: "stroke-dasharray 500ms ease-out" }}
          />
        )}
        <text x="80" y="66" textAnchor="middle" className="fill-zinc-50" style={{ font: "600 22px 'Inter Variable', sans-serif" }}>
          {budget !== null && budget > 0 ? `${Math.round(pct * 100)}%` : "∞"}
        </text>
        <text x="80" y="82" textAnchor="middle" className="fill-zinc-500" style={{ font: "11px 'Inter Variable', sans-serif" }}>
          of monthly budget
        </text>
      </svg>
    </div>
  );
}
