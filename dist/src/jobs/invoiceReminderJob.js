"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runInvoiceReminderScan = runInvoiceReminderScan;
exports.startInvoiceReminderJob = startInvoiceReminderJob;
const prisma_1 = __importDefault(require("../db/prisma"));
const notificationService_1 = require("../services/notificationService");
const invoiceMetaService_1 = require("../services/invoiceMetaService");
const MS_PER_DAY = 24 * 60 * 60 * 1000;
function startOfLocalDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function diffInCalendarDays(from, to) {
    const a = startOfLocalDay(from).getTime();
    const b = startOfLocalDay(to).getTime();
    return Math.round((b - a) / MS_PER_DAY);
}
async function runInvoiceReminderScan(now = new Date()) {
    const today = startOfLocalDay(now);
    const windowEndExclusive = new Date(today.getTime() + 4 * MS_PER_DAY);
    const candidates = await prisma_1.default.invoices.findMany({
        where: {
            paymentTermType: "due_date",
            status: { in: ["unpaid", "partial"] },
            dueDate: { gte: today, lt: windowEndExclusive },
        },
        select: {
            invoiceId: true,
            customerId: true,
            dueDate: true,
            status: true,
            tenantId: true,
            dueSoonNotifiedAt: true,
            dueDateNotifiedAt: true,
            customer: { select: { name: true } },
        },
    });
    await Promise.all(candidates.map(async (inv) => {
        if (!inv.dueDate)
            return;
        const daysUntilDue = diffInCalendarDays(now, inv.dueDate);
        if (daysUntilDue === 3 && !inv.dueSoonNotifiedAt) {
            const meta = await (0, invoiceMetaService_1.getInvoiceMeta)(inv.invoiceId);
            const invoiceLabel = meta?.invoiceNumber ? `Invoice #${meta.invoiceNumber}` : "Invoice";
            const customerName = inv.customer?.name || "Customer";
            await (0, notificationService_1.appendNotification)({
                type: "invoice",
                message: `${invoiceLabel} for ${customerName} has 3 days remaining to complete payment`,
                tenantId: inv.tenantId,
            });
            await prisma_1.default.invoices.update({ where: { invoiceId: inv.invoiceId }, data: { dueSoonNotifiedAt: new Date() } });
            return;
        }
        if (daysUntilDue === 0 && !inv.dueDateNotifiedAt) {
            const meta = await (0, invoiceMetaService_1.getInvoiceMeta)(inv.invoiceId);
            const invoiceLabel = meta?.invoiceNumber ? `Invoice #${meta.invoiceNumber}` : "Invoice";
            const customerName = inv.customer?.name || "Customer";
            await (0, notificationService_1.appendNotification)({
                type: "invoice",
                message: `${invoiceLabel} for ${customerName} is due today and is still unpaid`,
                tenantId: inv.tenantId,
            });
            await prisma_1.default.invoices.update({ where: { invoiceId: inv.invoiceId }, data: { dueDateNotifiedAt: new Date() } });
        }
    }));
}
let invoiceReminderJobStarted = false;
function startInvoiceReminderJob() {
    if (invoiceReminderJobStarted)
        return;
    invoiceReminderJobStarted = true;
    let intervalId = null;
    let schemaMismatchLogged = false;
    let attemptedAutoFix = false;
    const tick = async () => {
        try {
            await runInvoiceReminderScan();
        }
        catch (e) {
            const maybeCode = e?.code;
            const maybeColumn = e?.meta?.column;
            if (maybeCode === "P2022" && String(maybeColumn || "").includes("dueDateNotifiedAt")) {
                if (!attemptedAutoFix) {
                    attemptedAutoFix = true;
                    try {
                        await prisma_1.default.$executeRaw `ALTER TABLE "Invoices" ADD COLUMN IF NOT EXISTS "dueDateNotifiedAt" TIMESTAMP(3)`;
                        await runInvoiceReminderScan();
                        return;
                    }
                    catch (fixErr) {
                        if (!schemaMismatchLogged) {
                            schemaMismatchLogged = true;
                            console.warn("Invoice reminder job disabled: missing DB column dueDateNotifiedAt and auto-fix failed.", fixErr);
                        }
                        if (intervalId)
                            clearInterval(intervalId);
                        return;
                    }
                }
                if (!schemaMismatchLogged) {
                    schemaMismatchLogged = true;
                    console.warn("Invoice reminder job disabled: missing DB column dueDateNotifiedAt. Run Prisma migrations and restart the server.", e);
                }
                if (intervalId)
                    clearInterval(intervalId);
                return;
            }
            console.warn("runInvoiceReminderScan failed", e);
        }
    };
    void tick();
    intervalId = setInterval(() => {
        void tick();
    }, 6 * 60 * 60 * 1000);
}
