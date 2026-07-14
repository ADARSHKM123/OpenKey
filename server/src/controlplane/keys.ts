import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { CreateKeyBody, OPENKEY_KEY_PREFIX } from "@openkey/shared";
import { AppError } from "../lib/errors.js";
import { writeAudit } from "../lib/audit.js";
import { requireAuth, requireAdmin } from "./session.js";
import { publishInvalidate, type ControlDeps } from "./types.js";

// Virtual keys are the employee's own resource: create, name, rotate, revoke.
// The raw secret exists in memory for exactly one response — only the SHA-256
// is stored, so neither a DB leak nor a curious admin can recover it.

function mintKey(): { raw: string; hash: string; prefix: string } {
  const raw = `${OPENKEY_KEY_PREFIX}${randomBytes(24).toString("hex")}`;
  return {
    raw,
    hash: createHash("sha256").update(raw).digest("hex"),
    prefix: raw.slice(0, OPENKEY_KEY_PREFIX.length + 4),
  };
}

const keyView = (k: {
  id: string;
  name: string;
  keyPrefix: string;
  teamId: string | null;
  allowedModels: string[];
  monthlyBudgetUsd: unknown;
  rpmLimit: number | null;
  tpmLimit: number | null;
  ipAllowlist: string[];
  expiresAt: Date | null;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
}) => ({
  id: k.id,
  name: k.name,
  keyPrefix: k.keyPrefix,
  teamId: k.teamId,
  allowedModels: k.allowedModels,
  monthlyBudgetUsd: k.monthlyBudgetUsd?.toString() ?? null,
  rpmLimit: k.rpmLimit,
  tpmLimit: k.tpmLimit,
  ipAllowlist: k.ipAllowlist,
  expiresAt: k.expiresAt,
  revokedAt: k.revokedAt,
  lastUsedAt: k.lastUsedAt,
  createdAt: k.createdAt,
});

export function keyRoutes(deps: ControlDeps) {
  return async function register(app: FastifyInstance): Promise<void> {
    app.get("/api/keys", { preHandler: requireAuth(deps) }, async (request) => {
      const session = request.session!;
      const query = request.query as { userId?: string };
      const isAdmin = session.role === "ADMIN" || session.role === "OWNER";
      const userId = isAdmin && query.userId ? query.userId : session.sub;
      const keys = await deps.prisma.virtualKey.findMany({
        where: { userId, orgId: session.org },
        orderBy: { createdAt: "desc" },
      });
      return keys.map(keyView);
    });

    app.post("/api/keys", { preHandler: requireAuth(deps) }, async (request, reply) => {
      const session = request.session!;
      const body = CreateKeyBody.parse(request.body);

      if (body.teamId) {
        const member = await deps.prisma.membership.findUnique({
          where: { userId_teamId: { userId: session.sub, teamId: body.teamId } },
        });
        const isAdmin = session.role === "ADMIN" || session.role === "OWNER";
        if (!member && !isAdmin) {
          throw new AppError(403, "forbidden", "You are not a member of that team.");
        }
      }

      const { raw, hash, prefix } = mintKey();
      const key = await deps.prisma.virtualKey.create({
        data: {
          orgId: session.org,
          userId: session.sub,
          teamId: body.teamId ?? null,
          name: body.name,
          keyPrefix: prefix,
          keyHash: hash,
          allowedModels: body.allowedModels ?? [],
          monthlyBudgetUsd: body.monthlyBudgetUsd ?? null,
          rpmLimit: body.rpmLimit ?? null,
          tpmLimit: body.tpmLimit ?? null,
          ipAllowlist: body.ipAllowlist ?? [],
          expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
        },
      });
      await writeAudit(deps.prisma, {
        orgId: session.org,
        actorUserId: session.sub,
        action: "key.created",
        targetType: "virtual_key",
        targetId: key.id,
        after: { name: key.name, teamId: key.teamId },
        ip: request.ip,
        userAgent: request.headers["user-agent"],
      });
      void reply.status(201);
      // `key` (raw) appears in this response and never again.
      return { ...keyView(key), key: raw };
    });

    app.post("/api/keys/:id/rotate", { preHandler: requireAuth(deps) }, async (request) => {
      const session = request.session!;
      const { id } = request.params as { id: string };
      const existing = await deps.prisma.virtualKey.findFirst({ where: { id, orgId: session.org } });
      if (!existing) throw new AppError(404, "not_found", "Key not found.");
      const isAdmin = session.role === "ADMIN" || session.role === "OWNER";
      if (existing.userId !== session.sub && !isAdmin) {
        throw new AppError(403, "forbidden", "Not your key.");
      }
      if (existing.revokedAt) throw new AppError(400, "bad_request", "Key is revoked.");

      const oldHash = existing.keyHash;
      const { raw, hash, prefix } = mintKey();
      const updated = await deps.prisma.virtualKey.update({
        where: { id },
        data: { keyHash: hash, keyPrefix: prefix },
      });
      // The old secret must die everywhere within seconds.
      publishInvalidate(deps, { kind: "key", keyHash: oldHash });
      await writeAudit(deps.prisma, {
        orgId: session.org,
        actorUserId: session.sub,
        action: "key.rotated",
        targetType: "virtual_key",
        targetId: id,
        ip: request.ip,
        userAgent: request.headers["user-agent"],
      });
      return { ...keyView(updated), key: raw };
    });

    app.delete("/api/keys/:id", { preHandler: requireAuth(deps) }, async (request) => {
      const session = request.session!;
      const { id } = request.params as { id: string };
      const existing = await deps.prisma.virtualKey.findFirst({ where: { id, orgId: session.org } });
      if (!existing) throw new AppError(404, "not_found", "Key not found.");
      const isAdmin = session.role === "ADMIN" || session.role === "OWNER";
      if (existing.userId !== session.sub && !isAdmin) {
        throw new AppError(403, "forbidden", "Not your key.");
      }
      await deps.prisma.virtualKey.update({ where: { id }, data: { revokedAt: new Date() } });
      publishInvalidate(deps, { kind: "key", keyHash: existing.keyHash });
      await writeAudit(deps.prisma, {
        orgId: session.org,
        actorUserId: session.sub,
        action: "key.revoked",
        targetType: "virtual_key",
        targetId: id,
        before: { name: existing.name },
        ip: request.ip,
        userAgent: request.headers["user-agent"],
      });
      return { ok: true };
    });

    // Admin: revoke every key a user owns (offboarding).
    app.post("/api/users/:id/revoke-keys", { preHandler: requireAdmin(deps) }, async (request) => {
      const session = request.session!;
      const { id } = request.params as { id: string };
      const keys = await deps.prisma.virtualKey.findMany({
        where: { userId: id, orgId: session.org, revokedAt: null },
      });
      await deps.prisma.virtualKey.updateMany({
        where: { userId: id, orgId: session.org, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      for (const k of keys) publishInvalidate(deps, { kind: "key", keyHash: k.keyHash });
      await writeAudit(deps.prisma, {
        orgId: session.org,
        actorUserId: session.sub,
        action: "user.keys_revoked",
        targetType: "user",
        targetId: id,
        after: { count: keys.length },
        ip: request.ip,
        userAgent: request.headers["user-agent"],
      });
      return { revoked: keys.length };
    });
  };
}
