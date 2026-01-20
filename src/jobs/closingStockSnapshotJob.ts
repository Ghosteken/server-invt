import prisma from "../db/prisma";
import { randomUUID } from "crypto";

const isLastDayOfMonth = (d: Date) => {
  const test = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return d.getDate() === test.getDate();
};

const endOfMonth = (base: Date) => new Date(base.getFullYear(), base.getMonth() + 1, 0, 23, 59, 59, 999);
const startOfMonth = (base: Date) => new Date(base.getFullYear(), base.getMonth(), 1, 0, 0, 0, 0);

async function generateForTenant(tenantId: string, date: Date) {
  const start = startOfMonth(date);
  const end = endOfMonth(date);
  const products = await prisma.products.findMany({ where: { tenantId }, select: { productId: true, stockQuantity: true } });
  if (!products.length) return 0;
  const existing = await (prisma as any).stockResets.findMany({
    where: { tenantId, type: "closing", timestamp: { gte: start, lte: end } },
    select: { productId: true },
  });
  const seen = new Set<string>(existing.map((e: any) => String(e.productId)));
  const payload = products
    .filter((p) => !seen.has(p.productId))
    .map((p) => ({
      id: randomUUID(),
      productId: p.productId,
      timestamp: end,
      quantity: p.stockQuantity,
      tenantId,
      type: "closing",
    }));
  if (!payload.length) return 0;
  await prisma.stockResets.createMany({ data: payload });
  return payload.length;
}

export const startClosingStockSnapshotJob = () => {
  // Run every hour; when last day-of-month near midnight, generate snapshots
  const tick = async () => {
    try {
      const now = new Date();
      if (!isLastDayOfMonth(now)) return;
      // Run between 23:00 and 23:59 to avoid multiple executions
      const hour = now.getHours();
      if (hour !== 23) return;
      // Get distinct tenantIds from Products
      const rows: Array<{ tenantId: string }> = await prisma.$queryRaw`SELECT DISTINCT "tenantId" FROM "Products"`;
      let total = 0;
      for (const r of rows) {
        total += await generateForTenant(r.tenantId, now);
      }
      if (total > 0) {
        console.log(`Closing snapshot job: generated ${total} snapshots for ${rows.length} tenants`);
      } else {
        console.log(`Closing snapshot job: no new snapshots needed`);
      }
    } catch (err) {
      console.error("Closing snapshot job error:", err);
    }
  };
  // initial delay to avoid racing server startup
  setTimeout(() => {
    void tick();
    setInterval(() => { void tick(); }, 60 * 60 * 1000); // hourly
  }, 5 * 60 * 1000);
};

