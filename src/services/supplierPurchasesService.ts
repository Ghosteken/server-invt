import prisma from "../db/prisma";
import { randomUUID } from "node:crypto";

// Store supplier metadata for procurement purchases without DB migrations
// Schema: array of { purchaseId, supplierName?, supplierMobile?, paymentTerm?, date?, dueDate? }
export type SupplierPurchaseMeta = {
  purchaseId: string;
  tenantId?: string;
  supplierName?: string | null;
  supplierMobile?: string | null;
  invoiceNumber?: string | null;
  paymentTerm?: string | null;
  date?: string | null; // ISO string
  dueDate?: string | null; // ISO string
  // Track purchase unit (ctn or pcs) per entry to support inventory reversal on delete
  unit?: string | null;
};

// Lightweight supplier payment tracking for purchases
export type SupplierPayment = {
  id: string;
  purchaseId: string;
  date: string; // ISO
  amount: number;
  bankName: string;
  bankAccount: string;
  notes?: string | null;
};

async function getTenantForPurchase(purchaseId: string): Promise<string | null> {
  try {
    const row = await prisma.purchases.findUnique({ where: { purchaseId } });
    return row?.tenantId || null;
  } catch {
    return null;
  }
}

export function readSupplierMeta(): SupplierPurchaseMeta[] {
  return [];
}

export async function upsertSupplierMeta(entry: SupplierPurchaseMeta): Promise<void> {
  META_CACHE.set(entry.purchaseId, {
    purchaseId: entry.purchaseId,
    supplierName: entry.supplierName ?? null,
    supplierMobile: entry.supplierMobile ?? null,
    invoiceNumber: entry.invoiceNumber ?? null,
    paymentTerm: entry.paymentTerm ?? null,
    date: entry.date ?? null,
    dueDate: entry.dueDate ?? null,
    unit: entry.unit ?? null,
  });
  const tenantId = entry.tenantId || await getTenantForPurchase(entry.purchaseId);
  const data: any = {
    tenantId: tenantId || "default",
    purchaseId: entry.purchaseId,
    supplierName: entry.supplierName ?? undefined,
    supplierMobile: entry.supplierMobile ?? undefined,
    invoiceNumber: entry.invoiceNumber ?? undefined,
    paymentTerm: entry.paymentTerm ?? undefined,
    date: entry.date ? new Date(entry.date) : undefined,
    dueDate: entry.dueDate ? new Date(entry.dueDate) : undefined,
    unit: entry.unit ?? undefined,
  };
  try {
    await prisma.supplierPurchaseMeta.upsert({
      where: { purchaseId: entry.purchaseId },
      update: data,
      create: { ...data, id: randomUUID() },
    });
  } catch (e) {
    console.warn("upsertSupplierMeta failed", e);
  }
}

export function getSupplierMetaFor(purchaseId: string): SupplierPurchaseMeta | undefined {
  return META_CACHE.get(purchaseId);
}

// Payments helpers
export function readSupplierPayments(): SupplierPayment[] {
  return [];
}

export function addSupplierPayment(entry: SupplierPayment): SupplierPayment {
  (async () => {
    const tenantId = await getTenantForPurchase(entry.purchaseId);
    try {
      await prisma.supplierPayments.create({
        data: {
          id: entry.id,
          tenantId: tenantId || "default",
          purchaseId: entry.purchaseId,
          date: new Date(entry.date),
          amount: entry.amount,
          bankName: entry.bankName,
          bankAccount: entry.bankAccount,
          notes: entry.notes ?? undefined,
        },
      });
    } catch {}
  })();
  return entry;
}

export function getPaymentsForPurchase(purchaseId: string): SupplierPayment[] {
  try {
    const rows = (prisma as any).supplierPayments.findMany({ where: { purchaseId }, orderBy: { date: "desc" } }) as unknown as Promise<any[]>;
    return [];
  } catch {
    return [];
  }
}

export type SupplierEntry = { name: string; mobile?: string | null };

export function readSuppliers(): SupplierEntry[] {
  return [];
}

export function writeSuppliers(next: SupplierEntry[]): void {
  (async () => {
    for (const s of next) {
      try {
        await prisma.suppliers.upsert({
          where: { tenantId_name: { tenantId: "default", name: s.name } },
          update: { mobile: s.mobile ?? undefined },
          create: { id: randomUUID(), tenantId: "default", name: s.name, mobile: s.mobile ?? undefined },
        });
      } catch {}
    }
  })();
}

export function readSuppliersForTenant(tenantId: string): SupplierEntry[] {
  try {
    const rows = (prisma as any).suppliers.findMany({ where: { tenantId }, orderBy: { name: "asc" } }) as unknown as Promise<any[]>;
    return [];
  } catch {
    return [];
  }
}

export function writeSuppliersForTenant(tenantId: string, next: SupplierEntry[]): void {
  (async () => {
    for (const s of next) {
      try {
        await prisma.suppliers.upsert({
          where: { tenantId_name: { tenantId, name: s.name } },
          update: { mobile: s.mobile ?? undefined },
          create: { id: randomUUID(), tenantId, name: s.name, mobile: s.mobile ?? undefined },
        });
      } catch {}
    }
  })();
}

const META_CACHE = new Map<string, SupplierPurchaseMeta>();
