// Development seed. Idempotent — safe to run repeatedly.
//
// Creates: a dev org, an OWNER account (random password printed ONCE), the
// zero-cost mock provider, and a "mock-fast" model alias routed to it, priced
// from seed/pricing.json so budget math is exercised end-to-end without
// spending real money.
//
// Production first-boot bootstrap is a separate runtime path (M3) driven by
// OPENKEY_ORG_NAME / OPENKEY_ADMIN_EMAIL — this file is dev tooling.

import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encryptJson } from "../src/lib/crypto.js";
import { DEV_MASTER_KEY } from "../src/config/env.js";

const prisma = new PrismaClient();

interface PricingEntry {
  provider: string;
  match: string;
  inputCostPer1M: number;
  outputCostPer1M: number;
  cachedInputCostPer1M?: number;
  defaultMaxTokens: number;
}

function loadPricing(): PricingEntry[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const raw = readFileSync(join(here, "../../seed/pricing.json"), "utf8");
  return (JSON.parse(raw) as { models: PricingEntry[] }).models;
}

// Glob-lite: pricing entries match upstream model ids with a trailing "*".
export function findPricing(pricing: PricingEntry[], provider: string, model: string): PricingEntry | undefined {
  return pricing.find((p) => {
    if (p.provider !== provider) return false;
    if (p.match === "*") return true;
    if (p.match.endsWith("*")) return model.startsWith(p.match.slice(0, -1));
    return p.match === model;
  });
}

async function main(): Promise<void> {
  const orgName = process.env.OPENKEY_ORG_NAME ?? "OpenKey Dev";
  const adminEmail = process.env.OPENKEY_ADMIN_EMAIL ?? "admin@openkey.local";
  const masterKey = process.env.OPENKEY_MASTER_KEY ?? DEV_MASTER_KEY;
  const pricing = loadPricing();

  let org = await prisma.org.findFirst({ where: { name: orgName } });
  if (!org) {
    org = await prisma.org.create({ data: { name: orgName } });
    console.log(`[seed] created org "${orgName}" (${org.id})`);
  }

  const existingAdmin = await prisma.user.findUnique({
    where: { orgId_email: { orgId: org.id, email: adminEmail } },
  });
  if (!existingAdmin) {
    const password = randomBytes(12).toString("base64url");
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    await prisma.user.create({
      data: { orgId: org.id, email: adminEmail, name: "Admin", role: "OWNER", passwordHash },
    });
    // The only time this password is ever visible. It is not stored anywhere.
    console.log("=".repeat(64));
    console.log(`[seed] OWNER account created`);
    console.log(`[seed]   email:    ${adminEmail}`);
    console.log(`[seed]   password: ${password}`);
    console.log(`[seed] This password is shown ONCE. Store it now.`);
    console.log("=".repeat(64));
  }

  let mockProvider = await prisma.providerCredential.findFirst({
    where: { orgId: org.id, provider: "mock" },
  });
  if (!mockProvider) {
    mockProvider = await prisma.providerCredential.create({
      data: {
        orgId: org.id,
        provider: "mock",
        label: "Mock provider (dev)",
        configEnc: encryptJson({ note: "mock provider has no real credentials" }, masterKey),
      },
    });
    console.log(`[seed] created mock provider (${mockProvider.id})`);
  }

  const mockPrice = findPricing(pricing, "mock", "mock-small");
  if (!mockPrice) throw new Error("seed/pricing.json is missing the mock entry");

  const alias = await prisma.modelAlias.upsert({
    where: { orgId_alias: { orgId: org.id, alias: "mock-fast" } },
    update: {},
    create: {
      orgId: org.id,
      alias: "mock-fast",
      displayName: "Mock (dev only)",
      description: "Streams canned text at zero cost. For development and load testing.",
    },
  });

  const existingRoute = await prisma.modelRoute.findFirst({ where: { aliasId: alias.id } });
  if (!existingRoute) {
    await prisma.modelRoute.create({
      data: {
        aliasId: alias.id,
        priority: 0,
        providerId: mockProvider.id,
        upstreamModel: "mock-small",
        inputCostPer1M: mockPrice.inputCostPer1M,
        outputCostPer1M: mockPrice.outputCostPer1M,
        cachedInputCostPer1M: mockPrice.cachedInputCostPer1M ?? null,
        defaultMaxTokens: mockPrice.defaultMaxTokens,
      },
    });
    console.log(`[seed] created alias "mock-fast" → mock/mock-small`);
  }

  console.log("[seed] done");
}

main()
  .catch((err) => {
    console.error("[seed] failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
