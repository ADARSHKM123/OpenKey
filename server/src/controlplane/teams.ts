import type { FastifyInstance } from "fastify";
import { CreateTeamBody, UpdateTeamBody } from "@openkey/shared";
import { AppError } from "../lib/errors.js";
import { writeAudit } from "../lib/audit.js";
import { requireAdmin } from "./session.js";
import { publishInvalidate, type ControlDeps } from "./types.js";

export function teamRoutes(deps: ControlDeps) {
  return async function register(app: FastifyInstance): Promise<void> {
    app.get("/api/teams", { preHandler: requireAdmin(deps) }, async (request) => {
      const session = request.session!;
      const teams = await deps.prisma.team.findMany({
        where: { orgId: session.org },
        include: { members: { include: { user: { select: { id: true, name: true, email: true } } } } },
        orderBy: { name: "asc" },
      });
      return teams.map((t) => ({
        id: t.id,
        name: t.name,
        monthlyBudgetUsd: t.monthlyBudgetUsd?.toString() ?? null,
        allowedModels: t.allowedModels,
        members: t.members.map((m) => m.user),
        createdAt: t.createdAt,
      }));
    });

    app.post("/api/teams", { preHandler: requireAdmin(deps) }, async (request, reply) => {
      const session = request.session!;
      const body = CreateTeamBody.parse(request.body);
      const team = await deps.prisma.team.create({
        data: {
          orgId: session.org,
          name: body.name,
          monthlyBudgetUsd: body.monthlyBudgetUsd ?? null,
          allowedModels: body.allowedModels ?? [],
        },
      });
      await writeAudit(deps.prisma, {
        orgId: session.org,
        actorUserId: session.sub,
        action: "team.created",
        targetType: "team",
        targetId: team.id,
        after: body,
        ip: request.ip,
        userAgent: request.headers["user-agent"],
      });
      void reply.status(201);
      return team;
    });

    app.patch("/api/teams/:id", { preHandler: requireAdmin(deps) }, async (request) => {
      const session = request.session!;
      const { id } = request.params as { id: string };
      const body = UpdateTeamBody.parse(request.body);
      const before = await deps.prisma.team.findFirst({ where: { id, orgId: session.org } });
      if (!before) throw new AppError(404, "not_found", "Team not found.");
      const team = await deps.prisma.team.update({
        where: { id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.monthlyBudgetUsd !== undefined ? { monthlyBudgetUsd: body.monthlyBudgetUsd } : {}),
          ...(body.allowedModels !== undefined ? { allowedModels: body.allowedModels } : {}),
        },
      });
      // Budget/allowlist edits must reach the gateway in <5s.
      publishInvalidate(deps, { kind: "team", id });
      await writeAudit(deps.prisma, {
        orgId: session.org,
        actorUserId: session.sub,
        action: "team.updated",
        targetType: "team",
        targetId: id,
        before: {
          name: before.name,
          monthlyBudgetUsd: before.monthlyBudgetUsd?.toString() ?? null,
          allowedModels: before.allowedModels,
        },
        after: body,
        ip: request.ip,
        userAgent: request.headers["user-agent"],
      });
      return team;
    });

    app.delete("/api/teams/:id", { preHandler: requireAdmin(deps) }, async (request) => {
      const session = request.session!;
      const { id } = request.params as { id: string };
      const team = await deps.prisma.team.findFirst({ where: { id, orgId: session.org } });
      if (!team) throw new AppError(404, "not_found", "Team not found.");
      // Keys billed to this team fall back to user-level attribution.
      await deps.prisma.virtualKey.updateMany({ where: { teamId: id }, data: { teamId: null } });
      await deps.prisma.team.delete({ where: { id } });
      publishInvalidate(deps, { kind: "team", id });
      await writeAudit(deps.prisma, {
        orgId: session.org,
        actorUserId: session.sub,
        action: "team.deleted",
        targetType: "team",
        targetId: id,
        before: { name: team.name },
        ip: request.ip,
        userAgent: request.headers["user-agent"],
      });
      return { ok: true };
    });

    app.post("/api/teams/:id/members", { preHandler: requireAdmin(deps) }, async (request) => {
      const session = request.session!;
      const { id } = request.params as { id: string };
      const { userId } = request.body as { userId?: string };
      if (!userId) throw new AppError(400, "bad_request", "userId is required.");
      const [team, user] = await Promise.all([
        deps.prisma.team.findFirst({ where: { id, orgId: session.org } }),
        deps.prisma.user.findFirst({ where: { id: userId, orgId: session.org } }),
      ]);
      if (!team || !user) throw new AppError(404, "not_found", "Team or user not found.");
      await deps.prisma.membership.upsert({
        where: { userId_teamId: { userId, teamId: id } },
        update: {},
        create: { userId, teamId: id },
      });
      publishInvalidate(deps, { kind: "user", id: userId });
      await writeAudit(deps.prisma, {
        orgId: session.org,
        actorUserId: session.sub,
        action: "team.member_added",
        targetType: "team",
        targetId: id,
        after: { userId },
        ip: request.ip,
        userAgent: request.headers["user-agent"],
      });
      return { ok: true };
    });

    app.delete("/api/teams/:id/members/:userId", { preHandler: requireAdmin(deps) }, async (request) => {
      const session = request.session!;
      const { id, userId } = request.params as { id: string; userId: string };
      await deps.prisma.membership.deleteMany({ where: { teamId: id, userId } });
      publishInvalidate(deps, { kind: "user", id: userId });
      await writeAudit(deps.prisma, {
        orgId: session.org,
        actorUserId: session.sub,
        action: "team.member_removed",
        targetType: "team",
        targetId: id,
        after: { userId },
        ip: request.ip,
        userAgent: request.headers["user-agent"],
      });
      return { ok: true };
    });
  };
}
