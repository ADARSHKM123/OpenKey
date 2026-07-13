// All money moves through this file as INTEGER micro-USD (1e-6 dollars).
// Redis counters and mid-stream arithmetic must never touch floating point:
// a budget system that drifts is a budget system that lies. Postgres columns
// are DECIMAL and receive strings produced here — never a JS float.

export type MicroUsd = number; // integer; 2^53 micro-USD ≈ $9e9, far beyond any budget

export function usdToMicro(usd: number | string): MicroUsd {
  // Parse via string math to dodge float rounding on inputs like "0.1".
  const s = typeof usd === "number" ? usd.toFixed(6) : usd;
  const neg = s.startsWith("-");
  const [wholeRaw = "0", fracRaw = ""] = (neg ? s.slice(1) : s).split(".");
  const frac = (fracRaw + "000000").slice(0, 6);
  const micro = Number(wholeRaw) * 1_000_000 + Number(frac);
  return neg ? -micro : micro;
}

export function microToUsdString(micro: MicroUsd): string {
  const neg = micro < 0;
  const abs = Math.abs(Math.round(micro));
  const whole = Math.floor(abs / 1_000_000);
  const frac = String(abs % 1_000_000).padStart(6, "0");
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

export function microToUsdNumber(micro: MicroUsd): number {
  // Display only. Never feed this back into arithmetic.
  return Number(microToUsdString(micro));
}

// cost = tokens * pricePer1M / 1e6, computed entirely in integers.
// pricePer1M arrives as a Decimal string like "3.0000"; convert to micro-USD
// per 1M tokens (an integer), multiply, then divide by 1M with rounding up —
// reservations must never under-estimate by a rounding step.
export function tokenCostMicro(tokens: number, pricePer1MUsd: string): MicroUsd {
  const pricePer1MMicro = usdToMicro(pricePer1MUsd);
  return Math.ceil((tokens * pricePer1MMicro) / 1_000_000);
}

// First instant of next month, UTC — budget windows are calendar months.
export function nextMonthResetIso(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}

// "2026-07" — the month segment of every Redis spend key.
export function monthKey(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
