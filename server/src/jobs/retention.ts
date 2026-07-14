import type { PrismaClient } from "@prisma/client";
import type { Logger } from "pino";
import type { Env } from "../config/env.js";

// Retention: create next month's partitions ahead of time and drop whole
// partitions older than the retention window. DROP TABLE on a partition is
// O(1) — this is what makes free unlimited logging survivable.

const INTERVAL_MS = 24 * 60 * 60 * 1000;

export async function runRetention(prisma: PrismaClient, env: Env, logger: Logger): Promise<void> {
  await prisma.$executeRaw`SELECT openkey_ensure_log_partitions(1)`;

  // The effective window is the LONGEST of the env default and any org's
  // configured retention — dropping a partition another org still needs is
  // not an option in a shared deployment.
  const orgs = await prisma.org.findMany({ select: { settings: true } });
  let days = env.OPENKEY_LOG_RETENTION_DAYS;
  for (const org of orgs) {
    const configured = (org.settings as { logRetentionDays?: number }).logRetentionDays;
    if (typeof configured === "number" && configured > days) days = configured;
  }

  const dropped = await prisma.$queryRaw<{ openkey_drop_expired_log_partitions: number }[]>`
    SELECT openkey_drop_expired_log_partitions(${days}::int)`;
  const count = dropped[0]?.openkey_drop_expired_log_partitions ?? 0;
  if (count > 0) logger.info({ dropped: count, retentionDays: days }, "expired log partitions dropped");
}

export function startRetentionJob(prisma: PrismaClient, env: Env, logger: Logger): NodeJS.Timeout {
  const run = (): void => {
    void runRetention(prisma, env, logger).catch((err) => logger.error(err, "retention job failed"));
  };
  run();
  const timer = setInterval(run, INTERVAL_MS);
  timer.unref();
  return timer;
}
