import type { FastifyInstance } from "fastify";
import { CreateBudgetRequestBody, DecideBudgetRequestBody } from "@openkey/shared";
import { AppError } from "../lib/errors.js";
import { writeAudit } from "../lib/audit.js";
import { requireAdmin, requireAuth } from "./session.js";
import { publishInvalidate, type ControlDeps } from "./types.js";

// "Request more budget": the employee hits a wall and asks IN the product
// instead of messaging IT on Slack. Approval sets the new personal ceiling,
// invalidates the gateway cache, and lands in the audit log with the reason.

export function budgetRequestRoutes(deps: ControlDeps) {
  return async function register(app: FastifyInstance): Promise<void> {
    app.post("/api/budget-requests", { preHandler: requireAuth(deps) }, async (request, reply) => {
      const session = request.session!;
      const body = CreateBudgetRequestBody.parse(request.body);
      const open = await deps.prisma.budgetRequest.findFirst({
        where: { userId: session.sub, status: "pending" },
      });
      if (open) throw new AppError(409, "conflict", "You already have a pending budget request.");
      const req = await deps.prisma.budgetRequest.create({
        data: {
          orgId: session.org,
          userId: session.sub,
          requestedUsd: body.requestedUsd,
          reason: body.reason ?? null,
        },
      });
      void reply.status(201);
      return req;
    });

    app.get("/api/budget-requests", { preHandler: requireAuth(deps) }, async (request) => {
      const session = request.session!;
      const isAdmin = session.role === "ADMIN" || session.role === "OWNER";
      const { status } = request.query as { status?: string };
      const rows = await deps.prisma.budgetRequest.findMany({
        where: {
          orgId: session.org,
          ...(isAdmin ? {} : { userId: session.sub }),
          ...(status ? { status } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: 200,
      });
      const users = await deps.prisma.user.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.userId))] } },
        select: { id: true, name: true, email: true, monthlyBudgetUsd: true },
      });
      const byId = new Map(users.map((u) => [u.id, u]));
      return rows.map((r) => ({
        id: r.id,
        user: byId.get(r.userId) ?? { id: r.userId },
        currentBudgetUsd: byId.get(r.userId)?.monthlyBudgetUsd?.toString() ?? null,
        requestedUsd: r.requestedUsd.toString(),
        reason: r.reason,
        status: r.status,
        decidedBy: r.decidedBy,
        decidedAt: r.decidedAt,
        createdAt: r.createdAt,
      }));
    });

    app.post("/api/budget-requests/:id/decide", { preHandler: requireAdmin(deps) }, async (request) => {
      const session = request.session!;
      const { id } = request.params as { id: string };
      const body = DecideBudgetRequestBody.parse(request.body);
      const req = await deps.prisma.budgetRequest.findFirst({ where: { id, orgId: session.org } });
      if (!req) throw new AppError(404, "not_found", "Budget request not found.");
      if (req.status !== "pending") throw new AppError(409, "conflict", "Already decided.");

      await deps.prisma.$transaction(async (tx) => {
        await tx.budgetRequest.update({
          where: { id },
          data: { status: body.decision, decidedBy: session.sub, decidedAt: new Date() },
        });
        if (body.decision === "approved") {
          await tx.user.update({
            where: { id: req.userId },
            data: { monthlyBudgetUsd: req.requestedUsd },
          });
        }
      });
      if (body.decision === "approved") publishInvalidate(deps, { kind: "user", id: req.userId });
      await writeAudit(deps.prisma, {
        orgId: session.org,
        actorUserId: session.sub,
        action: `budget_request.${body.decision}`,
        targetType: "budget_request",
        targetId: id,
        after: { userId: req.userId, requestedUsd: req.requestedUsd.toString(), reason: body.reason ?? null },
        ip: request.ip,
        userAgent: request.headers["user-agent"],
      });
      return { ok: true };
    });
  };
}
