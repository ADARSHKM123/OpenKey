import { randomBytes } from "node:crypto";
import argon2 from "argon2";
import type { FastifyInstance } from "fastify";
import { CreateUserBody, UpdateUserBody } from "@openkey/shared";
import { AppError } from "../lib/errors.js";
import { writeAudit } from "../lib/audit.js";
import { requireAdmin } from "./session.js";
import { publishInvalidate, type ControlDeps } from "./types.js";

export function userRoutes(deps: ControlDeps) {
  return async function register(app: FastifyInstance): Promise<void> {
    app.get("/api/users", { preHandler: requireAdmin(deps) }, async (request) => {
      const session = request.session!;
      const { q } = request.query as { q?: string };
      const users = await deps.prisma.user.findMany({
        where: {
          orgId: session.org,
          ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } : {}),
        },
        include: { memberships: { include: { team: { select: { id: true, name: true } } } } },
        orderBy: { createdAt: "asc" },
      });
      return users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        status: u.status,
        authProvider: u.authProvider,
        monthlyBudgetUsd: u.monthlyBudgetUsd?.toString() ?? null,
        teams: u.memberships.map((m) => m.team),
        createdAt: u.createdAt,
      }));
    });

    app.post("/api/users", { preHandler: requireAdmin(deps) }, async (request, reply) => {
      const session = request.session!;
      const body = CreateUserBody.parse(request.body);
      // Only an OWNER can mint another OWNER.
      if (body.role === "OWNER" && session.role !== "OWNER") {
        throw new AppError(403, "forbidden", "Only the owner can create owner accounts.");
      }
      const tempPassword = randomBytes(9).toString("base64url");
      const user = await deps.prisma.user
        .create({
          data: {
            orgId: session.org,
            email: body.email.toLowerCase(),
            name: body.name,
            role: body.role,
            passwordHash: await argon2.hash(tempPassword, { type: argon2.argon2id }),
            monthlyBudgetUsd: body.monthlyBudgetUsd ?? null,
            ...(body.teamIds
              ? { memberships: { create: body.teamIds.map((teamId) => ({ teamId })) } }
              : {}),
          },
        })
        .catch(() => {
          throw new AppError(409, "conflict", "A user with that email already exists.");
        });
      await writeAudit(deps.prisma, {
        orgId: session.org,
        actorUserId: session.sub,
        action: "user.created",
        targetType: "user",
        targetId: user.id,
        after: { email: user.email, role: user.role },
        ip: request.ip,
        userAgent: request.headers["user-agent"],
      });
      void reply.status(201);
      // Temp password appears exactly once; the admin hands it to the employee.
      return { id: user.id, email: user.email, name: user.name, role: user.role, tempPassword };
    });

    app.patch("/api/users/:id", { preHandler: requireAdmin(deps) }, async (request) => {
      const session = request.session!;
      const { id } = request.params as { id: string };
      const body = UpdateUserBody.parse(request.body);
      const before = await deps.prisma.user.findFirst({ where: { id, orgId: session.org } });
      if (!before) throw new AppError(404, "not_found", "User not found.");
      if (before.role === "OWNER" && session.role !== "OWNER") {
        throw new AppError(403, "forbidden", "Only the owner can modify the owner account.");
      }
      if (body.role === "OWNER" && session.role !== "OWNER") {
        throw new AppError(403, "forbidden", "Only the owner can grant the owner role.");
      }

      const user = await deps.prisma.user.update({
        where: { id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.role !== undefined ? { role: body.role } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.monthlyBudgetUsd !== undefined ? { monthlyBudgetUsd: body.monthlyBudgetUsd } : {}),
          ...(body.teamIds !== undefined
            ? {
                memberships: {
                  deleteMany: {},
                  create: body.teamIds.map((teamId) => ({ teamId })),
                },
              }
            : {}),
        },
      });
      // Suspension and budget changes must hit the gateway in <5s.
      publishInvalidate(deps, { kind: "user", id });
      await writeAudit(deps.prisma, {
        orgId: session.org,
        actorUserId: session.sub,
        action: body.status === "suspended" ? "user.suspended" : "user.updated",
        targetType: "user",
        targetId: id,
        before: {
          role: before.role,
          status: before.status,
          monthlyBudgetUsd: before.monthlyBudgetUsd?.toString() ?? null,
        },
        after: body,
        ip: request.ip,
        userAgent: request.headers["user-agent"],
      });
      return { id: user.id, email: user.email, role: user.role, status: user.status };
    });
  };
}
