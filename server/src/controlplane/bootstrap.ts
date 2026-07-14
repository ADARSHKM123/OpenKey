import { randomBytes } from "node:crypto";
import argon2 from "argon2";
import type { PrismaClient } from "@prisma/client";
import type { Logger } from "pino";
import type { Env } from "../config/env.js";

// First boot against an empty database: create the org and the OWNER account
// with a randomly generated password printed ONCE to stdout. No default
// passwords, ever — a scanner finding admin/admin is how gateways get owned.

export async function bootstrapFirstBoot(prisma: PrismaClient, env: Env, logger: Logger): Promise<void> {
  const orgCount = await prisma.org.count();
  if (orgCount > 0) return;

  const password = randomBytes(12).toString("base64url");
  const org = await prisma.org.create({ data: { name: env.OPENKEY_ORG_NAME } });
  await prisma.user.create({
    data: {
      orgId: org.id,
      email: env.OPENKEY_ADMIN_EMAIL.toLowerCase(),
      name: "Owner",
      role: "OWNER",
      passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
    },
  });

  // Deliberately plain console output: this must be impossible to miss in
  // `docker compose logs server`, regardless of LOG_LEVEL.
  /* eslint-disable no-console */
  console.log("=".repeat(72));
  console.log("  OpenKey first boot — owner account created");
  console.log(`    org:      ${env.OPENKEY_ORG_NAME}`);
  console.log(`    email:    ${env.OPENKEY_ADMIN_EMAIL.toLowerCase()}`);
  console.log(`    password: ${password}`);
  console.log("  This password is shown ONCE and stored only as a hash.");
  console.log("=".repeat(72));
  /* eslint-enable no-console */
  logger.info({ org: org.id }, "first-boot bootstrap complete");
}
