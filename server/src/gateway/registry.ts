import type { PrismaClient } from "@prisma/client";
import type { Logger } from "pino";
import { decryptJson } from "../lib/crypto.js";

// Step 2 of the hot path: alias → ordered route chain, resolved from an
// in-memory map — zero I/O per request. The map is rebuilt from Postgres on
// boot, on every cfg:invalidate pub/sub message touching aliases/providers/
// routes, and on a 60s timer as a safety net for missed messages.
//
// Provider configs are decrypted once at load time, not per request.

export interface ResolvedRoute {
  routeId: string;
  priority: number;
  weight: number;
  providerId: string;
  providerKind: string;
  providerEnabled: boolean;
  config: unknown;
  upstreamModel: string;
  inputCostPer1M: string;
  outputCostPer1M: string;
  cachedInputCostPer1M: string | null;
  defaultMaxTokens: number;
}

export interface AliasEntry {
  aliasId: string;
  orgId: string;
  alias: string;
  displayName: string;
  description: string | null;
  enabled: boolean;
  routes: ResolvedRoute[]; // sorted by priority asc
}

export class ModelRegistry {
  private byOrgAlias = new Map<string, AliasEntry>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly masterKey: string,
    private readonly logger: Logger,
  ) {}

  get(orgId: string, alias: string): AliasEntry | undefined {
    return this.byOrgAlias.get(`${orgId}:${alias}`);
  }

  listForOrg(orgId: string): AliasEntry[] {
    const out: AliasEntry[] = [];
    for (const entry of this.byOrgAlias.values()) {
      if (entry.orgId === orgId && entry.enabled) out.push(entry);
    }
    return out;
  }

  async reload(): Promise<void> {
    const aliases = await this.prisma.modelAlias.findMany({
      where: { enabled: true },
      include: {
        routes: { include: { provider: true }, orderBy: { priority: "asc" } },
      },
    });

    const next = new Map<string, AliasEntry>();
    for (const a of aliases) {
      const routes: ResolvedRoute[] = [];
      for (const r of a.routes) {
        let config: unknown;
        try {
          config = decryptJson(r.provider.configEnc, this.masterKey);
        } catch (err) {
          // A credential that fails to decrypt (rotated master key?) must not
          // take down every other route — skip it loudly.
          this.logger.error({ providerId: r.providerId, err }, "provider config decrypt failed; route skipped");
          continue;
        }
        routes.push({
          routeId: r.id,
          priority: r.priority,
          weight: r.weight,
          providerId: r.providerId,
          providerKind: r.provider.provider,
          providerEnabled: r.provider.enabled,
          config,
          upstreamModel: r.upstreamModel,
          inputCostPer1M: r.inputCostPer1M.toString(),
          outputCostPer1M: r.outputCostPer1M.toString(),
          cachedInputCostPer1M: r.cachedInputCostPer1M?.toString() ?? null,
          defaultMaxTokens: r.defaultMaxTokens,
        });
      }
      next.set(`${a.orgId}:${a.alias}`, {
        aliasId: a.id,
        orgId: a.orgId,
        alias: a.alias,
        displayName: a.displayName,
        description: a.description,
        enabled: a.enabled,
        routes,
      });
    }
    // Atomic swap — in-flight requests keep the map they already resolved from.
    this.byOrgAlias = next;
    this.logger.debug({ aliases: next.size }, "model registry reloaded");
  }

  startPeriodicRefresh(intervalMs = 60_000): void {
    this.timer = setInterval(() => {
      void this.reload().catch((err) => this.logger.error(err, "registry refresh failed"));
    }, intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
