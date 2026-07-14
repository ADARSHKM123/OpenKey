import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";

// Hash-chained audit writer. Each row's hash covers the previous row's hash
// plus this row's content, so anyone with raw DB access who edits history
// breaks the chain visibly. Combined with the DB-level append-only triggers,
// tampering is both prevented and evident.

// JSONB does NOT preserve key order, so hashing plain JSON.stringify output
// makes verification diverge from what was written. Canonical form: object
// keys sorted recursively.
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
  return `{${entries.join(",")}}`;
}

export interface AuditEvent {
  orgId: string;
  actorUserId: string | null;
  action: string; // "key.created", "budget.updated", ...
  targetType: string;
  targetId: string;
  before?: unknown;
  after?: unknown;
  ip?: string | undefined;
  userAgent?: string | undefined;
}

export async function writeAudit(prisma: PrismaClient, event: AuditEvent): Promise<void> {
  // Advisory lock serialises writers per org so the chain never forks under
  // concurrent control-plane writes. Control-plane write volume is low; the
  // lock is cheap.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"audit:" + event.orgId}))`;
    const prev = await tx.auditLog.findFirst({
      where: { orgId: event.orgId },
      orderBy: { id: "desc" },
      select: { hash: true },
    });
    const prevHash = prev?.hash ?? null;
    const content = canonicalJson({
      orgId: event.orgId,
      actorUserId: event.actorUserId,
      action: event.action,
      targetType: event.targetType,
      targetId: event.targetId,
      before: event.before ?? null,
      after: event.after ?? null,
    });
    const hash = createHash("sha256")
      .update(prevHash ?? "genesis")
      .update(content)
      .digest("hex");
    await tx.auditLog.create({
      data: {
        orgId: event.orgId,
        actorUserId: event.actorUserId,
        action: event.action,
        targetType: event.targetType,
        targetId: event.targetId,
        ...(event.before !== undefined && event.before !== null
          ? { before: event.before as Prisma.InputJsonValue }
          : {}),
        ...(event.after !== undefined && event.after !== null
          ? { after: event.after as Prisma.InputJsonValue }
          : {}),
        ip: event.ip ?? null,
        userAgent: event.userAgent ?? null,
        prevHash,
        hash,
      },
    });
  });
}

// Walk the chain and recompute — used by tests and the audit export.
export async function verifyAuditChain(prisma: PrismaClient, orgId: string): Promise<boolean> {
  const rows = await prisma.auditLog.findMany({ where: { orgId }, orderBy: { id: "asc" } });
  let prevHash: string | null = null;
  for (const row of rows) {
    const content = canonicalJson({
      orgId: row.orgId,
      actorUserId: row.actorUserId,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      before: row.before ?? null,
      after: row.after ?? null,
    });
    const expected: string = createHash("sha256")
      .update(prevHash ?? "genesis")
      .update(content)
      .digest("hex");
    if (row.hash !== expected || row.prevHash !== prevHash) return false;
    prevHash = row.hash;
  }
  return true;
}
