import Fastify from "fastify";
import { pino } from "pino";
import { loadEnv } from "./config/env.js";

// M0 boot stub: env validation + health endpoint. The gateway (/v1) and
// control plane (/api) mount here as separate Fastify plugins in M1/M3.

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
    ],
    censor: "[REDACTED]",
  },
});

const app = Fastify({
  logger,
  // requestId on every log line — pino + Fastify propagate this automatically.
  genReqId: () => crypto.randomUUID(),
  disableRequestLogging: true,
});

app.get("/healthz", async () => ({ status: "ok", service: "openkey" }));

try {
  await app.listen({ port: env.OPENKEY_PORT, host: "0.0.0.0" });
  logger.info({ port: env.OPENKEY_PORT }, "openkey server listening");
} catch (err) {
  logger.error(err, "failed to start");
  process.exit(1);
}
