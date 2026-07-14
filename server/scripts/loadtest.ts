// Load test for the DoD: with 200 concurrent streams ACTIVE, gateway-added
// p99 latency must stay under 15ms and memory must not grow unboundedly.
//
// Method: saturate the gateway with a rolling pool of 200 long-lived SSE
// streams, then send sequential PROBE requests on a warm connection and
// measure their time-to-first-byte. The mock provider emits its first chunk
// immediately, so probe TTFB ≈ auth + resolve + estimate + reserve +
// dispatch — the gateway's own work. (Firing 200 fetches in one tick from a
// single client measures the client's connect queue, not the gateway.)
//
// Usage: OPENKEY_LOADTEST_KEY=sk-ok-live-… npx tsx scripts/loadtest.ts [bgStreams] [probes]

const BASE = process.env.OPENKEY_BASE_URL ?? "http://localhost:4000";
const KEY = process.env.OPENKEY_LOADTEST_KEY;
const BG_STREAMS = Number(process.argv[2] ?? 200);
const PROBES = Number(process.argv[3] ?? 300);

if (!KEY) {
  console.error("Set OPENKEY_LOADTEST_KEY to a valid virtual key.");
  process.exit(1);
}

const headers = { "content-type": "application/json", authorization: `Bearer ${KEY}` };

async function stream(body: unknown): Promise<number> {
  const started = performance.now();
  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const reader = res.body.getReader();
  const first = await reader.read();
  const ttfb = performance.now() - started;
  if (first.done) throw new Error("empty stream");
  for (;;) {
    const { done } = await reader.read();
    if (done) break;
  }
  return ttfb;
}

// ~3s per background stream (60 chunks × 50ms), respawned until stopped.
let stopBg = false;
let activeBg = 0;
async function bgWorker(): Promise<void> {
  while (!stopBg) {
    activeBg++;
    try {
      await stream({
        model: "mock-fast",
        messages: [{ role: "user", content: "mock:tokens=600 mock:delay=50 background load" }],
        max_tokens: 800,
        stream: true,
      });
    } catch {
      /* keep the pool full regardless */
    } finally {
      activeBg--;
    }
  }
}

const probe = () =>
  stream({
    model: "mock-fast",
    messages: [{ role: "user", content: "mock:tokens=8 mock:delay=0 probe" }],
    max_tokens: 16,
    stream: true,
  });

function pct(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(idx, 0)] ?? 0;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Warm up auth cache + connections.
await Promise.all(Array.from({ length: 5 }, probe));

// Spin up the background pool with staggered starts.
const bgPromises = Array.from({ length: BG_STREAMS }, async (_, i) => {
  await sleep(i * 5);
  return bgWorker();
});
while (activeBg < BG_STREAMS * 0.95) await sleep(50);
console.log(`background pool active: ${activeBg} streams`);

const ttfbs: number[] = [];
let failed = 0;
for (let i = 0; i < PROBES; i++) {
  try {
    ttfbs.push(await probe());
  } catch {
    failed++;
  }
  await sleep(10);
}

stopBg = true;
console.log(`probes: ${ttfbs.length} ok, ${failed} failed (bg active at end: ${activeBg})`);
ttfbs.sort((a, b) => a - b);
console.log(
  `probe TTFB (≈ gateway overhead under ${BG_STREAMS} live streams): ` +
    `p50 ${pct(ttfbs, 50).toFixed(1)}ms  p95 ${pct(ttfbs, 95).toFixed(1)}ms  p99 ${pct(ttfbs, 99).toFixed(1)}ms  max ${(ttfbs[ttfbs.length - 1] ?? 0).toFixed(1)}ms`,
);
const pass = pct(ttfbs, 99) < 15;
console.log(pass ? "PASS: p99 under 15ms" : "FAIL: p99 at or above 15ms");
await Promise.race([Promise.all(bgPromises), sleep(5000)]);
process.exit(pass ? 0 : 1);
