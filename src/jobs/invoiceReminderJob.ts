import prisma from "../db/prisma";
import { appendNotification } from "../services/notificationService";
import { getInvoiceMeta } from "../services/invoiceMetaService";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function diffInCalendarDays(from: Date, to: Date): number {
  const a = startOfLocalDay(from).getTime();
  const b = startOfLocalDay(to).getTime();
  return Math.round((b - a) / MS_PER_DAY);
}

export async function runInvoiceReminderScan(now: Date = new Date()): Promise<void> {
  const today = startOfLocalDay(now);
  const windowEndExclusive = new Date(today.getTime() + 4 * MS_PER_DAY);

  const candidates = await prisma.invoices.findMany({
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

  await Promise.all(
    candidates.map(async (inv) => {
      if (!inv.dueDate) return;

      const daysUntilDue = diffInCalendarDays(now, inv.dueDate);
      if (daysUntilDue === 3 && !inv.dueSoonNotifiedAt) {
        const meta = await getInvoiceMeta(inv.invoiceId);
        const invoiceLabel = meta?.invoiceNumber ? `Invoice #${meta.invoiceNumber}` : "Invoice";
        const customerName = inv.customer?.name || "Customer";
        await appendNotification({
          type: "invoice",
          message: `${invoiceLabel} for ${customerName} has 3 days remaining to complete payment`,
          tenantId: inv.tenantId,
        });
        await prisma.invoices.update({ where: { invoiceId: inv.invoiceId }, data: { dueSoonNotifiedAt: new Date() } });
        return;
      }

      if (daysUntilDue === 0 && !inv.dueDateNotifiedAt) {
        const meta = await getInvoiceMeta(inv.invoiceId);
        const invoiceLabel = meta?.invoiceNumber ? `Invoice #${meta.invoiceNumber}` : "Invoice";
        const customerName = inv.customer?.name || "Customer";
        await appendNotification({
          type: "invoice",
          message: `${invoiceLabel} for ${customerName} is due today and is still unpaid`,
          tenantId: inv.tenantId,
        });
        await prisma.invoices.update({ where: { invoiceId: inv.invoiceId }, data: { dueDateNotifiedAt: new Date() } });
      }
    })
  );
}

let invoiceReminderJobStarted = false;

export function startInvoiceReminderJob(): void {
  if (invoiceReminderJobStarted) return;
  invoiceReminderJobStarted = true;

  let intervalId: NodeJS.Timeout | null = null;
  let schemaMismatchLogged = false;
  let attemptedAutoFix = false;

  const tick = async () => {
    try {
      await runInvoiceReminderScan();
    } catch (e) {
      const maybeCode = (e as any)?.code;
      const maybeColumn = (e as any)?.meta?.column;
      if (maybeCode === "P2022" && String(maybeColumn || "").includes("dueDateNotifiedAt")) {
        if (!attemptedAutoFix) {
          attemptedAutoFix = true;
          try {
            await prisma.$executeRaw`ALTER TABLE "Invoices" ADD COLUMN IF NOT EXISTS "dueDateNotifiedAt" TIMESTAMP(3)`;
            await runInvoiceReminderScan();
            return;
          } catch (fixErr) {
            if (!schemaMismatchLogged) {
              schemaMismatchLogged = true;
              console.warn("Invoice reminder job disabled: missing DB column dueDateNotifiedAt and auto-fix failed.", fixErr);
            }
            if (intervalId) clearInterval(intervalId);
            return;
          }
        }
        if (!schemaMismatchLogged) {
          schemaMismatchLogged = true;
          console.warn("Invoice reminder job disabled: missing DB column dueDateNotifiedAt. Run Prisma migrations and restart the server.", e);
        }
        if (intervalId) clearInterval(intervalId);
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
