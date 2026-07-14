import { createHash } from "node:crypto";
import type { Redis } from "ioredis";
import type { PrismaClient } from "@prisma/client";
import ipaddr from "ipaddr.js";
import { AppError } from "../lib/errors.js";

// Step 1 of the hot path. Target: one Redis GET (~0.2ms) per request.
// Postgres is touched only on cache miss; the resolved context — key, user,
// team, org, all four budget ceilings, allowlists — is cached for 60s and
// invalidated in <5s via pub/sub when the control plane writes.

const CTX_TTL_SECONDS = 60;
// Index sets let user/team/org-level invalidations find every cached key
// context they affect without a SCAN. TTL slightly above the ctx TTL.
const IDX_TTL_SECONDS = 90;

export interface KeyContext {
  keyId: string;
  orgId: string;
  userId: string;
  teamId: string | null;
  userStatus: string;
  expiresAt: string | null;
  ipAllowlist: string[];
  rpmLimit: number | null;
  tpmLimit: number | null;
  // USD decimal strings straight from Postgres; null = unlimited.
  budgets: { org: string | null; team: string | null; user: string | null; key: string | null };
  allowedModels: { key: string[]; team: string[] };
  contact: string | null;
  // Org policy toggles (guardrails, raw-prompt retention) ride the cached
  // context so the hot path never does extra I/O to read them.
  orgSettings: Record<string, unknown>;
}

interface KeyRow {
  key_id: string;
  org_id: string;
  user_id: string;
  team_id: string | null;
  key_models: string[];
  key_budget: string | null;
  rpm_limit: number | null;
  tpm_limit: number | null;
  ip_allowlist: string[];
  expires_at: Date | null;
  revoked_at: Date | null;
  user_status: string;
  user_budget: string | null;
  team_budget: string | null;
  team_models: string[] | null;
  org_budget: string | null;
  org_settings: unknown;
  contact: string | null;
}

export function hashKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

export class KeyAuthService {
  constructor(
    private readonly redis: Redis,
    private readonly prisma: PrismaClient,
  ) {}

  async resolve(bearer: string, clientIp: string): Promise<KeyContext> {
    const hash = hashKey(bearer);
    const cacheKey = `keyctx:${hash}`;

    let ctx: KeyContext | null = null;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      ctx = JSON.parse(cached) as KeyContext;
    } else {
      ctx = await this.loadFromDb(hash);
      if (ctx) {
        // Fire-and-forget: caching must not add latency to the miss path.
        void this.cache(cacheKey, ctx).catch(() => {});
      }
    }

    if (!ctx) throw AppError.unauthorized("Invalid API key.");
    if (ctx.expiresAt && new Date(ctx.expiresAt).getTime() < Date.now()) {
      throw AppError.unauthorized("This API key has expired.");
    }
    if (ctx.userStatus !== "active") {
      throw AppError.forbidden("The user that owns this key is suspended.", "user_suspended");
    }
    if (ctx.ipAllowlist.length > 0 && !ipAllowed(clientIp, ctx.ipAllowlist)) {
      throw AppError.forbidden("Requests from this IP address are not allowed for this key.", "ip_not_allowed");
    }
    return ctx;
  }

  // Raw parameterised SQL: one round trip resolves the entire context.
  private async loadFromDb(hash: string): Promise<KeyContext | null> {
    const rows = await this.prisma.$queryRaw<KeyRow[]>`
      SELECT vk.id            AS key_id,
             vk.org_id, vk.user_id, vk.team_id,
             vk.allowed_models AS key_models,
             vk.monthly_budget_usd::text AS key_budget,
             vk.rpm_limit, vk.tpm_limit, vk.ip_allowlist,
             vk.expires_at, vk.revoked_at,
             u.status  AS user_status,
             u.monthly_budget_usd::text AS user_budget,
             t.monthly_budget_usd::text AS team_budget,
             t.allowed_models AS team_models,
             o.monthly_budget_usd::text AS org_budget,
             o.settings AS org_settings,
             (SELECT email FROM "user" ow
               WHERE ow.org_id = vk.org_id AND ow.role = 'OWNER'
               ORDER BY ow.created_at LIMIT 1) AS contact
      FROM virtual_key vk
      JOIN "user" u ON u.id = vk.user_id
      JOIN org    o ON o.id = vk.org_id
      LEFT JOIN team t ON t.id = vk.team_id
      WHERE vk.key_hash = ${hash}
      LIMIT 1`;

    const row = rows[0];
    if (!row) return null;
    // Revoked keys are never cached — revocation must stick even if the
    // pub/sub invalidation raced the cache write.
    if (row.revoked_at) return null;

    return {
      keyId: row.key_id,
      orgId: row.org_id,
      userId: row.user_id,
      teamId: row.team_id,
      userStatus: row.user_status,
      expiresAt: row.expires_at ? row.expires_at.toISOString() : null,
      // Rows created without list values hold SQL NULL, not '{}'.
      ipAllowlist: row.ip_allowlist ?? [],
      rpmLimit: row.rpm_limit,
      tpmLimit: row.tpm_limit,
      budgets: {
        org: row.org_budget,
        team: row.team_budget,
        user: row.user_budget,
        key: row.key_budget,
      },
      allowedModels: { key: row.key_models ?? [], team: row.team_models ?? [] },
      contact: row.contact,
      orgSettings: (row.org_settings ?? {}) as Record<string, unknown>,
    };
  }

  private async cache(cacheKey: string, ctx: KeyContext): Promise<void> {
    const pipe = this.redis.pipeline();
    pipe.set(cacheKey, JSON.stringify(ctx), "EX", CTX_TTL_SECONDS);
    pipe.sadd(`idx:user:${ctx.userId}`, cacheKey);
    pipe.expire(`idx:user:${ctx.userId}`, IDX_TTL_SECONDS);
    pipe.sadd(`idx:org:${ctx.orgId}`, cacheKey);
    pipe.expire(`idx:org:${ctx.orgId}`, IDX_TTL_SECONDS);
    if (ctx.teamId) {
      pipe.sadd(`idx:team:${ctx.teamId}`, cacheKey);
      pipe.expire(`idx:team:${ctx.teamId}`, IDX_TTL_SECONDS);
    }
    await pipe.exec();
  }

  // last_used_at is a UI nicety, not billing data: fire-and-forget, throttled
  // to one write per key per minute via SET NX.
  touchLastUsed(keyId: string): void {
    void this.redis
      .set(`lastused:${keyId}`, "1", "EX", 60, "NX")
      .then(async (set) => {
        if (set === "OK") {
          await this.prisma.$executeRaw`UPDATE virtual_key SET last_used_at = now() WHERE id = ${keyId}`;
        }
      })
      .catch(() => {});
  }

  // Called by the pub/sub subscriber when the control plane announces a write.
  async invalidate(msg: { kind: string; id?: string; keyHash?: string }): Promise<void> {
    if (msg.kind === "key" && msg.keyHash) {
      await this.redis.del(`keyctx:${msg.keyHash}`);
      return;
    }
    if ((msg.kind === "user" || msg.kind === "team" || msg.kind === "org") && msg.id) {
      const members = await this.redis.smembers(`idx:${msg.kind}:${msg.id}`);
      if (members.length > 0) await this.redis.del(...members, `idx:${msg.kind}:${msg.id}`);
    }
  }
}

// The effective allowlist is the tightest non-empty scope: key ?? team ?? all.
export function effectiveAllowedModels(ctx: KeyContext): string[] | null {
  if (ctx.allowedModels.key.length > 0) return ctx.allowedModels.key;
  if (ctx.allowedModels.team.length > 0) return ctx.allowedModels.team;
  return null; // no restriction
}

function ipAllowed(clientIp: string, cidrs: string[]): boolean {
  let addr: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    addr = ipaddr.process(clientIp); // unwraps ::ffff:a.b.c.d
  } catch {
    return false;
  }
  for (const cidr of cidrs) {
    try {
      const range = ipaddr.parseCIDR(cidr);
      if (addr.kind() === range[0].kind() && addr.match(range)) return true;
    } catch {
      // A malformed CIDR row must fail closed for that entry, not crash auth.
    }
  }
  return false;
}
