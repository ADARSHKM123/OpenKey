import type { FastifyInstance } from "fastify";
import { LogQuery } from "@openkey/shared";
import { Prisma } from "@prisma/client";
import { AppError } from "../lib/errors.js";
import { requireAuth } from "./session.js";
import type { ControlDeps } from "./types.js";

// Log browsing + usage analytics. All reads are raw SQL against the
// partitioned request_log — filtered on (org_id, created_at), which is the
// partition key plus the leading index columns, so these stay fast at any
// log volume.

export function logRoutes(deps: ControlDeps) {
  return async function register(app: FastifyInstance): Promise<void> {
    app.get("/api/logs", { preHandler: requireAuth(deps) }, async (request) => {
      const session = request.session!;
      const isAdmin = session.role === "ADMIN" || session.role === "OWNER" || session.role === "VIEWER";
      const q = LogQuery.parse(request.query);
      // Members see only their own traffic.
      const userFilter = isAdmin ? q.userId : session.sub;

      const conds: Prisma.Sql[] = [Prisma.sql`org_id = ${session.org}`];
      if (userFilter) conds.push(Prisma.sql`user_id = ${userFilter}`);
      if (q.teamId) conds.push(Prisma.sql`team_id = ${q.teamId}`);
      if (q.model) conds.push(Prisma.sql`upstream_model = ${q.model}`);
      if (q.status !== undefined) conds.push(Prisma.sql`status = ${q.status}`);
      if (q.minCost !== undefined) conds.push(Prisma.sql`cost_usd >= ${q.minCost}`);
      if (q.from) conds.push(Prisma.sql`created_at >= ${q.from}`);
      if (q.to) conds.push(Prisma.sql`created_at <= ${q.to}`);
      if (q.cursor) {
        const [iso, id] = q.cursor.split("|");
        if (iso && id) conds.push(Prisma.sql`(created_at, id) < (${new Date(iso)}, ${id})`);
      }

      const rows = await deps.prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
        SELECT id, user_id, team_id, key_id, alias_id, provider, upstream_model,
               status, error_code, input_tokens, output_tokens, cached_tokens,
               cost_usd::text AS cost_usd, cache_hit, fell_back_from,
               latency_ms, ttft_ms, streamed, approximate_cost, created_at
        FROM request_log
        WHERE ${Prisma.join(conds, " AND ")}
        ORDER BY created_at DESC, id DESC
        LIMIT ${q.limit}`);

      const last = rows[rows.length - 1];
      return {
        rows,
        nextCursor:
          rows.length === q.limit && last
            ? `${(last.created_at as Date).toISOString()}|${last.id as string}`
            : null,
      };
    });

    app.get("/api/logs/:id/payload", { preHandler: requireAuth(deps) }, async (request) => {
      const session = request.session!;
      const { id } = request.params as { id: string };
      const rows = await deps.prisma.$queryRaw<{ user_id: string; org_id: string }[]>`
        SELECT user_id, org_id FROM request_log WHERE id = ${id} LIMIT 1`;
      const log = rows[0];
      if (!log || log.org_id !== session.org) throw new AppError(404, "not_found", "Request not found.");

      const isAdmin = session.role === "ADMIN" || session.role === "OWNER";
      const isOwnRequest = log.user_id === session.sub;
      if (!isOwnRequest) {
        if (!isAdmin) throw new AppError(403, "forbidden", "Not your request.");
        // Some companies must not let IT read employee prompts. The org-level
        // toggle wins over admin curiosity, and flipping it is audit-logged.
        const org = await deps.prisma.org.findUnique({ where: { id: session.org } });
        const settings = (org?.settings ?? {}) as { adminCanViewPrompts?: boolean };
        if (settings.adminCanViewPrompts === false) {
          throw new AppError(403, "forbidden", "This org does not allow admins to view prompt content.");
        }
      }
      const payloads = await deps.prisma.$queryRaw<{ request_body: unknown; response_body: unknown }[]>`
        SELECT request_body, response_body FROM request_payload WHERE request_id = ${id} LIMIT 1`;
      const payload = payloads[0];
      if (!payload) throw new AppError(404, "not_found", "Payload not stored for this request.");
      return { requestBody: payload.request_body, responseBody: payload.response_body };
    });

    // Org-wide analytics for the admin dashboard.
    app.get("/api/usage/summary", { preHandler: requireAuth(deps) }, async (request) => {
      const session = request.session!;
      if (session.role === "MEMBER") throw new AppError(403, "forbidden", "Admin access required.");
      const days = Math.min(Number((request.query as { days?: string }).days) || 30, 365);
      const orgId = session.org;

      const [totals, byDay, byTeam, byModel, topUsers, monthSpend] = await Promise.all([
        deps.prisma.$queryRaw<
          { requests: bigint; spend: string | null; input_tokens: bigint | null; output_tokens: bigint | null; errors: bigint; p50: number | null; p95: number | null }[]
        >`
          SELECT count(*) AS requests,
                 sum(cost_usd)::text AS spend,
                 sum(input_tokens) AS input_tokens,
                 sum(output_tokens) AS output_tokens,
                 count(*) FILTER (WHERE status >= 400) AS errors,
                 percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) AS p50,
                 percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95
          FROM request_log
          WHERE org_id = ${orgId} AND created_at > now() - (${days}::int * interval '1 day')`,
        deps.prisma.$queryRaw<{ day: Date; spend: string; requests: bigint }[]>`
          SELECT date_trunc('day', created_at) AS day, sum(cost_usd)::text AS spend, count(*) AS requests
          FROM request_log
          WHERE org_id = ${orgId} AND created_at > now() - (${days}::int * interval '1 day')
          GROUP BY 1 ORDER BY 1`,
        deps.prisma.$queryRaw<{ team_id: string | null; team_name: string | null; spend: string }[]>`
          SELECT rl.team_id, t.name AS team_name, sum(rl.cost_usd)::text AS spend
          FROM request_log rl LEFT JOIN team t ON t.id = rl.team_id
          WHERE rl.org_id = ${orgId} AND rl.created_at > now() - (${days}::int * interval '1 day')
          GROUP BY 1, 2 ORDER BY sum(rl.cost_usd) DESC`,
        deps.prisma.$queryRaw<{ provider: string; upstream_model: string; spend: string; requests: bigint }[]>`
          SELECT provider, upstream_model, sum(cost_usd)::text AS spend, count(*) AS requests
          FROM request_log
          WHERE org_id = ${orgId} AND created_at > now() - (${days}::int * interval '1 day')
          GROUP BY 1, 2 ORDER BY sum(cost_usd) DESC LIMIT 20`,
        deps.prisma.$queryRaw<{ user_id: string; name: string | null; email: string | null; spend: string; requests: bigint }[]>`
          SELECT rl.user_id, u.name, u.email, sum(rl.cost_usd)::text AS spend, count(*) AS requests
          FROM request_log rl LEFT JOIN "user" u ON u.id = rl.user_id
          WHERE rl.org_id = ${orgId} AND rl.created_at > now() - (${days}::int * interval '1 day')
          GROUP BY 1, 2, 3 ORDER BY sum(rl.cost_usd) DESC LIMIT 10`,
        deps.prisma.$queryRaw<{ spend: string | null }[]>`
          SELECT sum(cost_usd)::text AS spend FROM request_log
          WHERE org_id = ${orgId} AND created_at >= date_trunc('month', now())`,
      ]);

      const t = totals[0];
      return {
        window: { days },
        totals: {
          requests: Number(t?.requests ?? 0),
          spendUsd: t?.spend ?? "0",
          inputTokens: Number(t?.input_tokens ?? 0),
          outputTokens: Number(t?.output_tokens ?? 0),
          errorRate: Number(t?.requests ?? 0) > 0 ? Number(t?.errors ?? 0) / Number(t?.requests ?? 0) : 0,
          latencyP50Ms: t?.p50 ?? null,
          latencyP95Ms: t?.p95 ?? null,
        },
        monthToDateUsd: monthSpend[0]?.spend ?? "0",
        byDay: byDay.map((d) => ({ day: d.day, spendUsd: d.spend, requests: Number(d.requests) })),
        byTeam: byTeam.map((r) => ({ teamId: r.team_id, teamName: r.team_name ?? "(no team)", spendUsd: r.spend })),
        byModel: byModel.map((m) => ({ provider: m.provider, model: m.upstream_model, spendUsd: m.spend, requests: Number(m.requests) })),
        topUsers: topUsers.map((u) => ({ userId: u.user_id, name: u.name, email: u.email, spendUsd: u.spend, requests: Number(u.requests) })),
      };
    });

    // Personal usage for the employee portal spend meter + chart.
    app.get("/api/usage/me", { preHandler: requireAuth(deps) }, async (request) => {
      const session = request.session!;
      const days = Math.min(Number((request.query as { days?: string }).days) || 30, 365);

      const [monthSpend, byDay, byModel, user] = await Promise.all([
        deps.prisma.$queryRaw<{ spend: string | null }[]>`
          SELECT sum(cost_usd)::text AS spend FROM request_log
          WHERE user_id = ${session.sub} AND created_at >= date_trunc('month', now())`,
        deps.prisma.$queryRaw<{ day: Date; spend: string; requests: bigint }[]>`
          SELECT date_trunc('day', created_at) AS day, sum(cost_usd)::text AS spend, count(*) AS requests
          FROM request_log
          WHERE user_id = ${session.sub} AND created_at > now() - (${days}::int * interval '1 day')
          GROUP BY 1 ORDER BY 1`,
        deps.prisma.$queryRaw<{ alias_id: string | null; upstream_model: string; spend: string; requests: bigint }[]>`
          SELECT alias_id, upstream_model, sum(cost_usd)::text AS spend, count(*) AS requests
          FROM request_log
          WHERE user_id = ${session.sub} AND created_at > now() - (${days}::int * interval '1 day')
          GROUP BY 1, 2 ORDER BY sum(cost_usd) DESC`,
        deps.prisma.user.findUnique({ where: { id: session.sub }, select: { monthlyBudgetUsd: true } }),
      ]);

      return {
        monthToDateUsd: monthSpend[0]?.spend ?? "0",
        monthlyBudgetUsd: user?.monthlyBudgetUsd?.toString() ?? null,
        byDay: byDay.map((d) => ({ day: d.day, spendUsd: d.spend, requests: Number(d.requests) })),
        byModel: byModel.map((m) => ({ aliasId: m.alias_id, model: m.upstream_model, spendUsd: m.spend, requests: Number(m.requests) })),
      };
    });
  };
}
