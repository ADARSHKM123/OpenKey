import Fastify, { type FastifyInstance } from "fastify";
import type {
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from "fastify";
import { PrismaClient } from "@prisma/client";
import type { Logger } from "pino";
import type { Redis } from "ioredis";
import type { Env } from "./config/env.js";
import { createRedis, createRedisSubscriber, CFG_INVALIDATE_CHANNEL } from "./redis/client.js";
import { KeyAuthService } from "./gateway/auth.js";
import { ModelRegistry } from "./gateway/registry.js";
import { BudgetService } from "./gateway/budget.js";
import { SettleQueue } from "./gateway/settle.js";
import { CircuitBreaker } from "./gateway/breaker.js";
import { gatewayPlugin } from "./gateway/plugin.js";

// Composition root. Two planes, one process: the gateway (/v1/*) and the
// control plane (/api/*, M3) are separate plugins with separate middleware so
// they can become separate containers later without a rewrite.

export interface AppServices {
  prisma: PrismaClient;
  redis: Redis;
  redisSub: Redis;
  auth: KeyAuthService;
  registry: ModelRegistry;
  budget: BudgetService;
  settle: SettleQueue;
  breaker: CircuitBreaker;
}

// Fastify's instance type carries the logger's concrete type; ours is pino.
export type App = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression,
  RawReplyDefaultExpression,
  Logger
>;

export interface BuiltApp {
  app: App;
  services: AppServices;
  shutdown: () => Promise<void>;
}

export async function buildApp(env: Env, logger: Logger): Promise<BuiltApp> {
  const prisma = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  const redis = createRedis(env.REDIS_URL);
  const redisSub = createRedisSubscriber(env.REDIS_URL);

  const auth = new KeyAuthService(redis, prisma);
  const registry = new ModelRegistry(prisma, env.OPENKEY_MASTER_KEY, logger);
  const budget = new BudgetService(redis);
  const settle = new SettleQueue(prisma, logger);
  const breaker = new CircuitBreaker();

  await budget.load();
  await registry.reload();
  registry.startPeriodicRefresh();
  settle.start();

  // Config invalidation: any control-plane write publishes here; every
  // gateway node drops the affected cache entries within seconds.
  await redisSub.subscribe(CFG_INVALIDATE_CHANNEL);
  redisSub.on("message", (channel, raw) => {
    if (channel !== CFG_INVALIDATE_CHANNEL) return;
    try {
      const msg = JSON.parse(raw) as { kind: string; id?: string; keyHash?: string };
      if (msg.kind === "alias" || msg.kind === "provider" || msg.kind === "route") {
        void registry.reload().catch((err) => logger.error(err, "registry reload failed"));
      } else {
        void auth.invalidate(msg).catch((err) => logger.error(err, "auth invalidate failed"));
      }
    } catch (err) {
      logger.error({ err, raw }, "malformed cfg:invalidate message");
    }
  });

  const app = Fastify({
    logger,
    genReqId: () => crypto.randomUUID(),
    disableRequestLogging: true,
  });

  app.get("/healthz", async () => ({ status: "ok", service: "openkey" }));

  await app.register(gatewayPlugin({ auth, registry, budget, settle, breaker }));

  const services: AppServices = { prisma, redis, redisSub, auth, registry, budget, settle, breaker };

  const shutdown = async (): Promise<void> => {
    registry.stop();
    await settle.stop(); // flush buffered logs/ledger rows before exit
    await app.close();
    redis.disconnect();
    redisSub.disconnect();
    await prisma.$disconnect();
  };

  return { app, services, shutdown };
}
