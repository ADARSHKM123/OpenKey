// Proves the audit hash chain survives a real Postgres JSONB round trip
// (key reordering, numeric normalisation) on a fresh org.
import { PrismaClient } from "@prisma/client";
import { verifyAuditChain, writeAudit } from "../src/lib/audit.js";

const prisma = new PrismaClient();
const org = await prisma.org.create({ data: { name: `chain-test-${Date.now()}` } });

await writeAudit(prisma, {
  orgId: org.id,
  actorUserId: null,
  action: "test.one",
  targetType: "test",
  targetId: "t1",
  after: { zebra: 1, alpha: { nested: [3, 2, 1], b: "x" }, money: 12.5 },
});
await writeAudit(prisma, {
  orgId: org.id,
  actorUserId: null,
  action: "test.two",
  targetType: "test",
  targetId: "t2",
  before: { key: "value" },
  after: null,
});

const ok = await verifyAuditChain(prisma, org.id);
console.log("fresh-org chain valid after JSONB round trip:", ok);
await prisma.org.delete({ where: { id: org.id } }); // audit rows are org-scoped but not FK'd; org row itself can go
await prisma.$disconnect();
process.exit(ok ? 0 : 1);
