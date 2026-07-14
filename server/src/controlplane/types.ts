import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import type { Logger } from "pino";
import type { Env } from "../config/env.js";
import { CFG_INVALIDATE_CHANNEL } from "../redis/client.js";

export interface ControlDeps {
  prisma: PrismaClient;
  redis: Redis;
  env: Env;
  logger: Logger;
}

// Every control-plane write that affects the gateway's caches publishes here.
// <5s propagation to every gateway node is a core product promise (SPEC §2#4).
export type InvalidateKind = "key" | "user" | "team" | "org" | "alias" | "provider" | "route";

export function publishInvalidate(
  deps: ControlDeps,
  msg: { kind: InvalidateKind; id?: string; keyHash?: string },
): void {
  void deps.redis
    .publish(CFG_INVALIDATE_CHANNEL, JSON.stringify(msg))
    .catch((err) => deps.logger.error({ err, msg }, "cfg invalidate publish failed"));
}
