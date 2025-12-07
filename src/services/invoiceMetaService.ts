import prisma from "../db/prisma";

export type InvoiceMeta = {
  invoiceId: string;
  invoiceNumber?: string | null;
  tenantId?: string;
};

export async function upsertInvoiceMeta(entry: InvoiceMeta): Promise<void> {
  const tenantId = entry.tenantId || "default";
  await prisma.invoiceMeta.upsert({
    where: { invoiceId: entry.invoiceId },
    create: {
      id: cryptoRandom(),
      tenantId,
      invoiceId: entry.invoiceId,
      invoiceNumber: entry.invoiceNumber ?? null,
    },
    update: {
      invoiceNumber: entry.invoiceNumber ?? null,
      tenantId,
    },
  });
}

export async function getInvoiceMeta(id: string, tenantId?: string): Promise<InvoiceMeta | undefined> {
  const rec = await prisma.invoiceMeta.findUnique({ where: { invoiceId: id } });
  if (!rec) return undefined;
  if (tenantId && rec.tenantId !== tenantId) return undefined;
  return { invoiceId: rec.invoiceId, invoiceNumber: rec.invoiceNumber ?? null, tenantId: rec.tenantId };
}

export async function removeInvoiceMeta(id: string): Promise<void> {
  try { await prisma.invoiceMeta.delete({ where: { invoiceId: id } }); } catch {}
}

function cryptoRandom(): string {
  try {
    const { randomUUID } = require("crypto");
    return randomUUID();
  } catch {
    return Math.random().toString(36).slice(2);
  }
}
