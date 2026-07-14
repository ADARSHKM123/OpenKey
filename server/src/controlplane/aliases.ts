import type { FastifyInstance } from "fastify";
import { CreateAliasBody, UpdateAliasBody } from "@openkey/shared";
import { AppError } from "../lib/errors.js";
import { writeAudit } from "../lib/audit.js";
import { requireAdmin, requireAuth } from "./session.js";
import { publishInvalidate, type ControlDeps } from "./types.js";

// Model aliases and their ordered fallback chains. This is the whole
// "employees never see a provider" abstraction, so route changes hot-reload
// into every gateway node via the alias invalidation.

export function aliasRoutes(deps: ControlDeps) {
  return async function register(app: FastifyInstance): Promise<void> {
    // Non-admins can read the catalog (the portal's model cards use it) —
    // but only enabled aliases, without provider internals.
    app.get("/api/aliases", { preHandler: requireAuth(deps) }, async (request) => {
      const session = request.session!;
      const isAdmin = session.role === "ADMIN" || session.role === "OWNER";
      const aliases = await deps.prisma.modelAlias.findMany({
        where: { orgId: session.org, ...(isAdmin ? {} : { enabled: true }) },
        include: {
          routes: {
            include: { provider: { select: { id: true, provider: true, label: true, enabled: true, healthy: true } } },
            orderBy: { priority: "asc" },
          },
        },
        orderBy: { alias: "asc" },
      });
      return aliases.map((a) => ({
        id: a.id,
        alias: a.alias,
        displayName: a.displayName,
        description: a.description,
        enabled: a.enabled,
        ...(isAdmin
          ? {
              routes: a.routes.map((r) => ({
                id: r.id,
                priority: r.priority,
                weight: r.weight,
                upstreamModel: r.upstreamModel,
                inputCostPer1M: r.inputCostPer1M.toString(),
                outputCostPer1M: r.outputCostPer1M.toString(),
                cachedInputCostPer1M: r.cachedInputCostPer1M?.toString() ?? null,
                defaultMaxTokens: r.defaultMaxTokens,
                provider: r.provider,
              })),
            }
          : {}),
      }));
    });

    app.post("/api/aliases", { preHandler: requireAdmin(deps) }, async (request, reply) => {
      const session = request.session!;
      const body = CreateAliasBody.parse(request.body);
      const alias = await deps.prisma.$transaction(async (tx) => {
        const created = await tx.modelAlias.create({
          data: {
            orgId: session.org,
            alias: body.alias,
            displayName: body.displayName,
            description: body.description ?? null,
            enabled: body.enabled,
          },
        });
        await tx.modelRoute.createMany({
          data: body.routes.map((r) => ({
            aliasId: created.id,
            providerId: r.providerId,
            upstreamModel: r.upstreamModel,
            priority: r.priority,
            weight: r.weight,
            inputCostPer1M: r.inputCostPer1M,
            outputCostPer1M: r.outputCostPer1M,
            cachedInputCostPer1M: r.cachedInputCostPer1M ?? null,
            defaultMaxTokens: r.defaultMaxTokens,
          })),
        });
        return created;
      });
      publishInvalidate(deps, { kind: "alias", id: alias.id });
      await writeAudit(deps.prisma, {
        orgId: session.org,
        actorUserId: session.sub,
        action: "alias.created",
        targetType: "model_alias",
        targetId: alias.id,
        after: body,
        ip: request.ip,
        userAgent: request.headers["user-agent"],
      });
      void reply.status(201);
      return alias;
    });

    app.patch("/api/aliases/:id", { preHandler: requireAdmin(deps) }, async (request) => {
      const session = request.session!;
      const { id } = request.params as { id: string };
      const body = UpdateAliasBody.parse(request.body);
      const existing = await deps.prisma.modelAlias.findFirst({ where: { id, orgId: session.org } });
      if (!existing) throw new AppError(404, "not_found", "Alias not found.");

      const alias = await deps.prisma.$transaction(async (tx) => {
        const updated = await tx.modelAlias.update({
          where: { id },
          data: {
            ...(body.alias !== undefined ? { alias: body.alias } : {}),
            ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
            ...(body.description !== undefined ? { description: body.description } : {}),
            ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
          },
        });
        if (body.routes !== undefined) {
          // The visual chain builder submits the whole chain; replace it
          // atomically so the gateway never sees a half-edited chain.
          await tx.modelRoute.deleteMany({ where: { aliasId: id } });
          await tx.modelRoute.createMany({
            data: body.routes.map((r) => ({
              aliasId: id,
              providerId: r.providerId,
              upstreamModel: r.upstreamModel,
              priority: r.priority,
              weight: r.weight,
              inputCostPer1M: r.inputCostPer1M,
              outputCostPer1M: r.outputCostPer1M,
              cachedInputCostPer1M: r.cachedInputCostPer1M ?? null,
              defaultMaxTokens: r.defaultMaxTokens,
            })),
          });
        }
        return updated;
      });
      publishInvalidate(deps, { kind: "alias", id });
      await writeAudit(deps.prisma, {
        orgId: session.org,
        actorUserId: session.sub,
        action: "alias.updated",
        targetType: "model_alias",
        targetId: id,
        after: body,
        ip: request.ip,
        userAgent: request.headers["user-agent"],
      });
      return alias;
    });

    app.delete("/api/aliases/:id", { preHandler: requireAdmin(deps) }, async (request) => {
      const session = request.session!;
      const { id } = request.params as { id: string };
      const existing = await deps.prisma.modelAlias.findFirst({ where: { id, orgId: session.org } });
      if (!existing) throw new AppError(404, "not_found", "Alias not found.");
      await deps.prisma.modelAlias.delete({ where: { id } }); // routes cascade
      publishInvalidate(deps, { kind: "alias", id });
      await writeAudit(deps.prisma, {
        orgId: session.org,
        actorUserId: session.sub,
        action: "alias.deleted",
        targetType: "model_alias",
        targetId: id,
        before: { alias: existing.alias },
        ip: request.ip,
        userAgent: request.headers["user-agent"],
      });
      return { ok: true };
    });
  };
}
