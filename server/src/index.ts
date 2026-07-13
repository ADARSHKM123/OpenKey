import { pino } from "pino";
import { loadEnv } from "./config/env.js";
import { buildApp } from "./app.js";
import { startReconciler } from "./jobs/reconciler.js";

const env = loadEnv();

const logger = pino({
  level: env.LOG_LEVEL,
  // Secrets must never appear in logs. Redact known-sensitive paths globally
  // so a future log line can't leak by accident.
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "*.apiKey",
      "*.password",
      "*.passwordHash",
      "*.secretAccessKey",
      "*.sessionToken",
    ],
    censor: "[REDACTED]",
  },
});

const { app, services, shutdown } = await buildApp(env, logger);
startReconciler(services.prisma, services.budget, logger);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    logger.info({ signal }, "shutting down");
    void shutdown().finally(() => process.exit(0));
  });
}

try {
  await app.listen({ port: env.OPENKEY_PORT, host: "0.0.0.0" });
  logger.info({ port: env.OPENKEY_PORT }, "openkey server listening");
} catch (err) {
  logger.error(err, "failed to start");
  process.exit(1);
}
