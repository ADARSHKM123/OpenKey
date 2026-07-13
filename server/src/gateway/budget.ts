import type { Redis } from "ioredis";
import { AppError } from "../lib/errors.js";
import { microToUsdNumber, monthKey, nextMonthResetIso, type MicroUsd } from "../lib/money.js";

// The pre-flight reservation — the single feature that makes OpenKey stop a
// runaway agent BEFORE the money is gone instead of reporting it after.
//
// One EVALSHA atomically checks and updates all four budget scopes plus the
// RPM/TPM sliding windows in a single Redis round trip. If ANY ceiling would
// be breached, nothing is incremented and the offending scope is returned.
//
// Units: counters are integer micro-USD. Limits: -1 = unlimited (still
// tracked, so adding a budget mid-month enforces against real spend),
// -2 = scope absent (e.g. key not bound to a team).
//
// Rate limiting uses the two-bucket sliding-window approximation:
// effective = prev_bucket * (1 - elapsed/60s) + current_bucket.
const RESERVE_LUA = `
local est = tonumber(ARGV[1])
local limits = { tonumber(ARGV[2]), tonumber(ARGV[3]), tonumber(ARGV[4]), tonumber(ARGV[5]) }
local scopes = { 'org', 'team', 'user', 'key' }
local rpmLimit = tonumber(ARGV[6])
local tpmLimit = tonumber(ARGV[7])
local estTokens = tonumber(ARGV[8])
local nowMs = tonumber(ARGV[9])
local spendTtl = tonumber(ARGV[10])

local curMin = math.floor(nowMs / 60000)
local elapsed = (nowMs % 60000) / 60000

if rpmLimit >= 0 then
  local cur = tonumber(redis.call('GET', KEYS[5] .. ':' .. curMin) or '0')
  local prev = tonumber(redis.call('GET', KEYS[5] .. ':' .. (curMin - 1)) or '0')
  if prev * (1 - elapsed) + cur + 1 > rpmLimit then
    return { 'rate', 'rpm' }
  end
end
if tpmLimit >= 0 then
  local cur = tonumber(redis.call('GET', KEYS[6] .. ':' .. curMin) or '0')
  local prev = tonumber(redis.call('GET', KEYS[6] .. ':' .. (curMin - 1)) or '0')
  if prev * (1 - elapsed) + cur + estTokens > tpmLimit then
    return { 'rate', 'tpm' }
  end
end

for i = 1, 4 do
  if limits[i] >= 0 then
    local spent = tonumber(redis.call('GET', KEYS[i]) or '0')
    if spent + est > limits[i] then
      return { 'budget', scopes[i], tostring(limits[i]), tostring(spent) }
    end
  end
end

for i = 1, 4 do
  if limits[i] ~= -2 then
    redis.call('INCRBY', KEYS[i], est)
    redis.call('EXPIRE', KEYS[i], spendTtl, 'NX')
  end
end
local rpmKey = KEYS[5] .. ':' .. curMin
redis.call('INCR', rpmKey)
redis.call('EXPIRE', rpmKey, 120)
local tpmKey = KEYS[6] .. ':' .. curMin
redis.call('INCRBY', tpmKey, estTokens)
redis.call('EXPIRE', tpmKey, 120)
return { 'ok' }
`;

// Settlement adjustment: delta = actual - reserved, which is negative when we
// over-reserved — that correctly refunds the excess. Clamped at zero so a
// refund landing after a counter expired can't create phantom headroom.
const ADJUST_LUA = `
local delta = tonumber(ARGV[1])
for i = 1, #KEYS do
  local v = redis.call('INCRBY', KEYS[i], delta)
  if v < 0 then redis.call('SET', KEYS[i], '0', 'KEEPTTL') end
end
return 'ok'
`;

const SPEND_TTL_SECONDS = 45 * 24 * 3600; // a full month window plus slack

export interface BudgetScopeIds {
  orgId: string;
  teamId: string | null;
  userId: string;
  keyId: string;
}

export interface BudgetLimitsMicro {
  org: MicroUsd | -1;
  team: MicroUsd | -1 | -2;
  user: MicroUsd | -1;
  key: MicroUsd | -1;
}

export class BudgetService {
  private reserveSha: string | null = null;
  private adjustSha: string | null = null;

  constructor(private readonly redis: Redis) {}

  async load(): Promise<void> {
    this.reserveSha = (await this.redis.script("LOAD", RESERVE_LUA)) as string;
    this.adjustSha = (await this.redis.script("LOAD", ADJUST_LUA)) as string;
  }

  spendKeys(ids: BudgetScopeIds, month: string): string[] {
    return [
      `spend:org:${ids.orgId}:${month}`,
      `spend:team:${ids.teamId ?? "none"}:${month}`,
      `spend:user:${ids.userId}:${month}`,
      `spend:key:${ids.keyId}:${month}`,
    ];
  }

  // Fail CLOSED on money: any Redis error surfaces as a 5xx to the caller
  // rather than letting an unbudgeted request through.
  async reserve(opts: {
    ids: BudgetScopeIds;
    limits: BudgetLimitsMicro;
    estimateMicro: MicroUsd;
    estimateTokens: number;
    rpmLimit: number | null;
    tpmLimit: number | null;
    contact?: string;
  }): Promise<void> {
    if (!this.reserveSha) throw new Error("BudgetService not loaded");
    const now = new Date();
    const keys = [
      ...this.spendKeys(opts.ids, monthKey(now)),
      `rl:rpm:key:${opts.ids.keyId}`,
      `rl:tpm:key:${opts.ids.keyId}`,
    ];
    const res = (await this.redis.evalsha(
      this.reserveSha,
      keys.length,
      ...keys,
      String(opts.estimateMicro),
      String(opts.limits.org),
      String(opts.limits.team),
      String(opts.limits.user),
      String(opts.limits.key),
      String(opts.rpmLimit ?? -1),
      String(opts.tpmLimit ?? -1),
      String(opts.estimateTokens),
      String(now.getTime()),
      String(SPEND_TTL_SECONDS),
    )) as string[];

    const verdict = res[0];
    if (verdict === "ok") return;
    if (verdict === "rate") {
      const kind = res[1] === "tpm" ? "tpm" : "rpm";
      throw AppError.rateLimited(kind, kind === "rpm" ? (opts.rpmLimit ?? 0) : (opts.tpmLimit ?? 0));
    }
    const scope = (res[1] ?? "org") as "org" | "team" | "user" | "key";
    throw AppError.budgetExceeded({
      scope,
      limitUsd: microToUsdNumber(Number(res[2] ?? 0)),
      spentUsd: microToUsdNumber(Number(res[3] ?? 0)),
      resetAt: nextMonthResetIso(now),
      ...(opts.contact ? { contact: opts.contact } : {}),
    });
  }

  // Mid-stream re-check (~every 2s per active stream): one MGET compares the
  // live counters against the CURRENT limits, so a budget an admin just cut
  // kills in-flight streams too — not only new requests.
  async checkCeilings(ids: BudgetScopeIds, limits: BudgetLimitsMicro): Promise<"org" | "team" | "user" | "key" | null> {
    const keys = this.spendKeys(ids, monthKey());
    const values = await this.redis.mget(...keys);
    const scopes = ["org", "team", "user", "key"] as const;
    const limitArr = [limits.org, limits.team, limits.user, limits.key];
    for (let i = 0; i < 4; i++) {
      const limit = limitArr[i] ?? -1;
      if (limit < 0) continue;
      if (Number(values[i] ?? 0) > limit) return scopes[i] ?? null;
    }
    return null;
  }

  // month comes from the reservation's created_at — a request reserved at
  // 23:59 on the 31st must settle against that month's counters, not the next.
  async adjust(ids: BudgetScopeIds, month: string, deltaMicro: MicroUsd): Promise<void> {
    if (!this.adjustSha) throw new Error("BudgetService not loaded");
    if (deltaMicro === 0) return;
    const keys = this.spendKeys(ids, month).filter((k) => !k.includes(":none:"));
    await this.redis.evalsha(this.adjustSha, keys.length, ...keys, String(deltaMicro));
  }
}
