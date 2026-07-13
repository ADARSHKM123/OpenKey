import { z } from "zod";

// A recognizable throwaway so local dev works with zero setup, but production
// boot refuses it loudly — shipping a default encryption key is how "encrypted
// at rest" becomes theater.
export const DEV_MASTER_KEY =
  "0000000000000000000000000000000000000000000000000000000000000000";
export const DEV_JWT_SECRET = "openkey-dev-jwt-secret-do-not-use";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
  OPENKEY_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error"]).default("info"),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  OPENKEY_MASTER_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "must be 32 bytes of hex (64 chars) — generate with: openssl rand -hex 32")
    .default(DEV_MASTER_KEY),
  OPENKEY_JWT_SECRET: z.string().min(16).default(DEV_JWT_SECRET),
  OPENKEY_ORG_NAME: z.string().min(1).default("OpenKey"),
  OPENKEY_ADMIN_EMAIL: z.string().email().default("admin@openkey.local"),
  OPENKEY_LOG_RETENTION_DAYS: z.coerce.number().int().min(1).default(90),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment:\n${issues}`);
  }
  const env = parsed.data;

  if (env.NODE_ENV !== "development" && env.NODE_ENV !== "test") {
    if (env.OPENKEY_MASTER_KEY === DEV_MASTER_KEY) {
      throw new Error(
        "REFUSING TO BOOT: OPENKEY_MASTER_KEY is missing or set to the dev default. " +
          "Provider credentials cannot be safely encrypted without a real key. " +
          "Generate one with `openssl rand -hex 32` and set it in your environment.",
      );
    }
    if (env.OPENKEY_JWT_SECRET === DEV_JWT_SECRET) {
      throw new Error(
        "REFUSING TO BOOT: OPENKEY_JWT_SECRET is missing or set to the dev default. " +
          "Generate one with `openssl rand -hex 32` and set it in your environment.",
      );
    }
  }
  return env;
}
