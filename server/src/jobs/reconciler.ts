import type { PrismaClient } from "@prisma/client";
import type { Logger } from "pino";
import type { BudgetService } from "../gateway/budget.js";
import { monthKey, usdToMicro } from "../lib/money.js";

// Step 10: a SpendLedger row stuck in RESERVED for > 15 minutes is a crashed
// request. Release it — both the Postgres state and the Redis counters — or
// every crash slowly poisons a team's budget with phantom spend.

const STALE_MINUTES = 15;
const BATCH = 500;

interface StaleRow {
  request_id: string;
  org_id: string;
  team_id: string | null;
  user_id: string;
  key_id: string;
  reserved_usd: string;
  created_at: Date;
}

export async function releaseStaleReservations(
  prisma: PrismaClient,
  budget: BudgetService,
  logger: Logger,
): Promise<number> {
  const rows = await prisma.$queryRaw<StaleRow[]>`
    SELECT request_id, org_id, team_id, user_id, key_id,
           reserved_usd::text AS reserved_usd, created_at
    FROM spend_ledger
    WHERE state = 'RESERVED'
      AND created_at < now() - (${STALE_MINUTES}::int * interval '1 minute')
    LIMIT ${BATCH}`;

  let released = 0;
  for (const row of rows) {
    // Refund Redis first; if the process dies between the two steps the row
    // stays RESERVED and the next run refunds again — but the UPDATE below is
    // conditioned on state, so a double refund requires a crash in exactly
    // this window AND the same row, which the state check then prevents.
    const updated = await prisma.$executeRaw`
      UPDATE spend_ledger SET state = 'RELEASED', settled_at = now()
      WHERE request_id = ${row.request_id} AND state = 'RESERVED'`;
    if (updated === 0) continue; // another node already handled it
    await budget.adjust(
      { orgId: row.org_id, teamId: row.team_id, userId: row.user_id, keyId: row.key_id },
      monthKey(row.created_at),
      -usdToMicro(row.reserved_usd),
    );
    released++;
  }
  if (released > 0) logger.warn({ released }, "reconciler released stale reservations");
  return released;
}

export function startReconciler(prisma: PrismaClient, budget: BudgetService, logger: Logger): NodeJS.Timeout {
  const run = (): void => {
    void releaseStaleReservations(prisma, budget, logger).catch((err) =>
      logger.error(err, "reconciler run failed"),
    );
  };
  run(); // crashes shouldn't wait an hour after a restart
  const timer = setInterval(run, 60 * 60 * 1000);
  timer.unref();
  return timer;
}
