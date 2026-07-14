import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import type { Logger } from "pino";

// Budget alerts at 50/80/100% of any budget (org, team, user), delivered to
// the org's configured webhook (Slack-compatible {text} payload). Each
// scope+threshold fires once per calendar month, deduped in Redis. The only
// outbound call in the whole product — and it goes to a URL the customer
// configured themselves.

const THRESHOLDS = [50, 80, 100] as const;
const INTERVAL_MS = 5 * 60 * 1000;

interface ScopeSpend {
  scope: "org" | "team" | "user";
  id: string;
  label: string;
  budget: number;
  spent: number;
}

async function collectScopes(prisma: PrismaClient): Promise<Map<string, ScopeSpend[]>> {
  const byOrg = new Map<string, ScopeSpend[]>();
  const push = (orgId: string, s: ScopeSpend) => {
    const list = byOrg.get(orgId) ?? [];
    list.push(s);
    byOrg.set(orgId, list);
  };

  const [orgs, teams, users] = await Promise.all([
    prisma.$queryRaw<{ id: string; name: string; budget: string; spent: string | null }[]>`
      SELECT o.id, o.name, o.monthly_budget_usd::text AS budget,
             (SELECT sum(cost_usd) FROM request_log rl
               WHERE rl.org_id = o.id AND rl.created_at >= date_trunc('month', now()))::text AS spent
      FROM org o WHERE o.monthly_budget_usd IS NOT NULL`,
    prisma.$queryRaw<{ id: string; org_id: string; name: string; budget: string; spent: string | null }[]>`
      SELECT t.id, t.org_id, t.name, t.monthly_budget_usd::text AS budget,
             (SELECT sum(cost_usd) FROM request_log rl
               WHERE rl.team_id = t.id AND rl.created_at >= date_trunc('month', now()))::text AS spent
      FROM team t WHERE t.monthly_budget_usd IS NOT NULL`,
    prisma.$queryRaw<{ id: string; org_id: string; name: string; budget: string; spent: string | null }[]>`
      SELECT u.id, u.org_id, u.name, u.monthly_budget_usd::text AS budget,
             (SELECT sum(cost_usd) FROM request_log rl
               WHERE rl.user_id = u.id AND rl.created_at >= date_trunc('month', now()))::text AS spent
      FROM "user" u WHERE u.monthly_budget_usd IS NOT NULL`,
  ]);

  for (const o of orgs) push(o.id, { scope: "org", id: o.id, label: o.name, budget: Number(o.budget), spent: Number(o.spent ?? 0) });
  for (const t of teams) push(t.org_id, { scope: "team", id: t.id, label: `team ${t.name}`, budget: Number(t.budget), spent: Number(t.spent ?? 0) });
  for (const u of users) push(u.org_id, { scope: "user", id: u.id, label: u.name, budget: Number(u.budget), spent: Number(u.spent ?? 0) });
  return byOrg;
}

export async function runBudgetAlerts(prisma: PrismaClient, redis: Redis, logger: Logger): Promise<void> {
  const orgs = await prisma.org.findMany({ select: { id: true, settings: true } });
  const webhooks = new Map<string, string>();
  for (const org of orgs) {
    const url = (org.settings as { alertWebhookUrl?: string }).alertWebhookUrl;
    if (url) webhooks.set(org.id, url);
  }
  if (webhooks.size === 0) return;

  const month = new Date().toISOString().slice(0, 7);
  const scopes = await collectScopes(prisma);

  for (const [orgId, url] of webhooks) {
    for (const s of scopes.get(orgId) ?? []) {
      if (s.budget <= 0) continue;
      const pct = (s.spent / s.budget) * 100;
      for (const threshold of THRESHOLDS) {
        if (pct < threshold) continue;
        const dedupeKey = `alert:${s.scope}:${s.id}:${month}:${threshold}`;
        const first = await redis.set(dedupeKey, "1", "EX", 45 * 24 * 3600, "NX");
        if (first !== "OK") continue;
        const text =
          threshold === 100
            ? `🔴 OpenKey: ${s.label} has EXHAUSTED its monthly budget ($${s.spent.toFixed(2)} of $${s.budget.toFixed(2)}). Requests are now blocked.`
            : `${threshold === 80 ? "🟠" : "🟡"} OpenKey: ${s.label} has used ${Math.floor(pct)}% of its monthly budget ($${s.spent.toFixed(2)} of $${s.budget.toFixed(2)}).`;
        try {
          await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ text }),
          });
          logger.info({ scope: s.scope, id: s.id, threshold }, "budget alert sent");
        } catch (err) {
          // Fail open on telemetry: undo the dedupe so the next run retries.
          await redis.del(dedupeKey);
          logger.error({ err }, "budget alert webhook failed");
        }
      }
    }
  }
}

export function startAlertJob(prisma: PrismaClient, redis: Redis, logger: Logger): NodeJS.Timeout {
  const run = (): void => {
    void runBudgetAlerts(prisma, redis, logger).catch((err) => logger.error(err, "alert job failed"));
  };
  run();
  const timer = setInterval(run, INTERVAL_MS);
  timer.unref();
  return timer;
}
