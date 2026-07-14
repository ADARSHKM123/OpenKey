// Recomputes the audit_log hash chain for every org and reports tampering.
// Run: pnpm --filter @openkey/server audit:verify
import { PrismaClient } from "@prisma/client";
import { verifyAuditChain } from "../src/lib/audit.js";

const prisma = new PrismaClient();
const orgs = await prisma.org.findMany({ select: { id: true, name: true } });
let failed = false;
for (const org of orgs) {
  const ok = await verifyAuditChain(prisma, org.id);
  console.log(`${ok ? "OK      " : "TAMPERED"}  ${org.name} (${org.id})`);
  if (!ok) failed = true;
}
await prisma.$disconnect();
process.exit(failed ? 1 : 0);
