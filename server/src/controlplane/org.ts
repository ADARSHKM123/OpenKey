import type { FastifyInstance } from "fastify";
import { UpdateOrgBody } from "@openkey/shared";
import { AppError } from "../lib/errors.js";
import { writeAudit } from "../lib/audit.js";
import { requireAdmin } from "./session.js";
import { publishInvalidate, type ControlDeps } from "./types.js";

export function orgRoutes(deps: ControlDeps) {
  return async function register(app: FastifyInstance): Promise<void> {
    app.get("/api/org", { preHandler: requireAdmin(deps) }, async (request) => {
      const session = request.session!;
      const org = await deps.prisma.org.findUnique({ where: { id: session.org } });
      if (!org) throw new AppError(404, "not_found", "Org not found.");
      return {
        id: org.id,
        name: org.name,
        monthlyBudgetUsd: org.monthlyBudgetUsd?.toString() ?? null,
        settings: org.settings,
        createdAt: org.createdAt,
      };
    });

    app.patch("/api/org", { preHandler: requireAdmin(deps) }, async (request) => {
      const session = request.session!;
      const body = UpdateOrgBody.parse(request.body);
      const before = await deps.prisma.org.findUnique({ where: { id: session.org } });
      if (!before) throw new AppError(404, "not_found", "Org not found.");
      const settings =
        body.settings !== undefined
          ? { ...(before.settings as Record<string, unknown>), ...body.settings }
          : undefined;
      const org = await deps.prisma.org.update({
        where: { id: session.org },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.monthlyBudgetUsd !== undefined ? { monthlyBudgetUsd: body.monthlyBudgetUsd } : {}),
          ...(settings !== undefined ? { settings } : {}),
        },
      });
      publishInvalidate(deps, { kind: "org", id: session.org });
      await writeAudit(deps.prisma, {
        orgId: session.org,
        actorUserId: session.sub,
        action: "org.updated",
        targetType: "org",
        targetId: session.org,
        before: { name: before.name, monthlyBudgetUsd: before.monthlyBudgetUsd?.toString() ?? null },
        after: body,
        ip: request.ip,
        userAgent: request.headers["user-agent"],
      });
      return { id: org.id, name: org.name, monthlyBudgetUsd: org.monthlyBudgetUsd?.toString() ?? null, settings: org.settings };
    });

    app.get("/api/audit", { preHandler: requireAdmin(deps) }, async (request) => {
      const session = request.session!;
      const { limit = "100", before } = request.query as { limit?: string; before?: string };
      const take = Math.min(Number(limit) || 100, 500);
      const rows = await deps.prisma.auditLog.findMany({
        where: { orgId: session.org, ...(before ? { id: { lt: BigInt(before) } } : {}) },
        orderBy: { id: "desc" },
        take,
      });
      return rows.map((r) => ({
        id: r.id.toString(),
        actorUserId: r.actorUserId,
        action: r.action,
        targetType: r.targetType,
        targetId: r.targetId,
        before: r.before,
        after: r.after,
        ip: r.ip,
        userAgent: r.userAgent,
        hash: r.hash,
        prevHash: r.prevHash,
        createdAt: r.createdAt,
      }));
    });
  };
}
