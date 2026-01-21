"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startClosingStockSnapshotJob = void 0;
const prisma_1 = __importDefault(require("../db/prisma"));
const crypto_1 = require("crypto");
const isLastDayOfMonth = (d) => {
    const test = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return d.getDate() === test.getDate();
};
const endOfMonth = (base) => new Date(base.getFullYear(), base.getMonth() + 1, 0, 23, 59, 59, 999);
const startOfMonth = (base) => new Date(base.getFullYear(), base.getMonth(), 1, 0, 0, 0, 0);
async function generateForTenant(tenantId, date) {
    const start = startOfMonth(date);
    const end = endOfMonth(date);
    const products = await prisma_1.default.products.findMany({ where: { tenantId }, select: { productId: true, stockQuantity: true } });
    if (!products.length)
        return 0;
    const existing = await prisma_1.default.stockResets.findMany({
        where: { tenantId, type: "closing", timestamp: { gte: start, lte: end } },
        select: { productId: true },
    });
    const seen = new Set(existing.map((e) => String(e.productId)));
    const payload = products
        .filter((p) => !seen.has(p.productId))
        .map((p) => ({
        id: (0, crypto_1.randomUUID)(),
        productId: p.productId,
        timestamp: end,
        quantity: p.stockQuantity,
        tenantId,
        type: "closing",
    }));
    if (!payload.length)
        return 0;
    await prisma_1.default.stockResets.createMany({ data: payload });
    return payload.length;
}
const startClosingStockSnapshotJob = () => {
    // Run every hour; when last day-of-month near midnight, generate snapshots
    const tick = async () => {
        try {
            const now = new Date();
            if (!isLastDayOfMonth(now))
                return;
            // Run between 23:00 and 23:59 to avoid multiple executions
            const hour = now.getHours();
            if (hour !== 23)
                return;
            // Get distinct tenantIds from Products
            const rows = await prisma_1.default.$queryRaw `SELECT DISTINCT "tenantId" FROM "Products"`;
            let total = 0;
            for (const r of rows) {
                total += await generateForTenant(r.tenantId, now);
            }
            if (total > 0) {
                console.log(`Closing snapshot job: generated ${total} snapshots for ${rows.length} tenants`);
            }
            else {
                console.log(`Closing snapshot job: no new snapshots needed`);
            }
        }
        catch (err) {
            console.error("Closing snapshot job error:", err);
        }
    };
    // initial delay to avoid racing server startup
    setTimeout(() => {
        void tick();
        setInterval(() => { void tick(); }, 60 * 60 * 1000); // hourly
    }, 5 * 60 * 1000);
};
exports.startClosingStockSnapshotJob = startClosingStockSnapshotJob;
