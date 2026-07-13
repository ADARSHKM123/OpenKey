import type { Prisma, PrismaClient } from "@prisma/client";
import type { Logger } from "pino";

// Step 9 of the hot path — everything here happens AFTER the response has
// closed and must never block a client. Writes are batched (flush every
// 500ms or 100 rows) and fail OPEN: if Postgres is down we keep serving and
// keep buffering, dropping the oldest telemetry first. Ledger rows are the
// financial record; log/payload rows are observability.

export interface LedgerInsert {
  requestId: string;
  orgId: string;
  teamId: string | null;
  userId: string;
  keyId: string;
  reservedUsd: string;
  createdAt: Date;
}

export interface LedgerSettle {
  requestId: string;
  state: "SETTLED" | "RELEASED";
  actualUsd: string;
}

export interface LogInsert {
  id: string;
  orgId: string;
  teamId: string | null;
  userId: string;
  keyId: string;
  aliasId: string | null;
  provider: string;
  upstreamModel: string;
  status: number;
  errorCode: string | null;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  costUsd: string;
  cacheHit: boolean;
  fellBackFrom: string | null;
  latencyMs: number;
  ttftMs: number | null;
  streamed: boolean;
  approximateCost: boolean;
  redactionsApplied: number;
  createdAt: Date;
}

export interface PayloadInsert {
  requestId: string;
  requestBody: unknown;
  responseBody: unknown | null;
  createdAt: Date;
}

const FLUSH_INTERVAL_MS = 500;
const FLUSH_BATCH_SIZE = 100;
const MAX_BUFFER = 10_000;

export class SettleQueue {
  private ledgerInserts: LedgerInsert[] = [];
  private ledgerSettles: LedgerSettle[] = [];
  private logs: LogInsert[] = [];
  private payloads: PayloadInsert[] = [];
  private timer: NodeJS.Timeout | null = null;
  private flushing = false;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger: Logger,
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.flush();
  }

  enqueueLedgerInsert(row: LedgerInsert): void {
    this.push(this.ledgerInserts, row);
  }

  enqueueLedgerSettle(row: LedgerSettle): void {
    this.push(this.ledgerSettles, row);
  }

  enqueueLog(row: LogInsert, payload?: PayloadInsert): void {
    this.push(this.logs, row);
    if (payload) this.push(this.payloads, payload);
  }

  private push<T>(buf: T[], row: T): void {
    if (buf.length >= MAX_BUFFER) buf.shift(); // drop oldest telemetry, never crash
    buf.push(row);
    if (this.logs.length + this.ledgerInserts.length + this.ledgerSettles.length >= FLUSH_BATCH_SIZE) {
      void this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    // Take local snapshots so new enqueues during the awaits aren't lost.
    const inserts = this.ledgerInserts.splice(0);
    const settles = this.ledgerSettles.splice(0);
    const logs = this.logs.splice(0);
    const payloads = this.payloads.splice(0);
    try {
      // Inserts strictly before settles: a settle in this batch may target a
      // ledger row that is also in this batch.
      if (inserts.length > 0) {
        await this.prisma.spendLedger.createMany({
          data: inserts.map((r) => ({
            requestId: r.requestId,
            orgId: r.orgId,
            teamId: r.teamId,
            userId: r.userId,
            keyId: r.keyId,
            state: "RESERVED",
            reservedUsd: r.reservedUsd,
            createdAt: r.createdAt,
          })),
          skipDuplicates: true,
        });
      }
      for (const s of settles) {
        await this.prisma.$executeRaw`
          UPDATE spend_ledger
          SET state = ${s.state}, actual_usd = ${s.actualUsd}::decimal, settled_at = now()
          WHERE request_id = ${s.requestId} AND state = 'RESERVED'`;
      }
      if (logs.length > 0) {
        await this.prisma.requestLog.createMany({
          data: logs.map((l) => ({ ...l })),
          skipDuplicates: true,
        });
      }
      if (payloads.length > 0) {
        await this.prisma.requestPayload.createMany({
          data: payloads.map((p) => ({
            requestId: p.requestId,
            requestBody: p.requestBody as Prisma.InputJsonValue,
            ...(p.responseBody === null ? {} : { responseBody: p.responseBody as Prisma.InputJsonValue }),
            createdAt: p.createdAt,
          })),
          skipDuplicates: true,
        });
      }
    } catch (err) {
      // Fail open: requeue at the front and try again on the next tick.
      this.ledgerInserts.unshift(...inserts.slice(0, MAX_BUFFER));
      this.ledgerSettles.unshift(...settles.slice(0, MAX_BUFFER));
      this.logs.unshift(...logs.slice(0, MAX_BUFFER));
      this.payloads.unshift(...payloads.slice(0, MAX_BUFFER));
      this.logger.error(err, "settle queue flush failed; buffering");
    } finally {
      this.flushing = false;
    }
  }
}
