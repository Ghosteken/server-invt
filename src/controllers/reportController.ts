import { Request, Response } from "express";
import prisma from "../db/prisma";
import { withCache } from "../services/cache";
import { createErrorResponse } from "../utils/errorHandler";
import * as XLSX from "xlsx";

export const getSalesReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = (req as any).tenantId || req.user?.tenantId || "default";
    const fromRaw = req.query?.from as string | undefined;
    const toRaw = req.query?.to as string | undefined;
    const from = fromRaw ? new Date(fromRaw) : undefined;
    const to = toRaw ? new Date(toRaw) : undefined;

    let dateFilter: any | undefined = undefined;
    if (from) dateFilter = { ...(dateFilter || {}), gte: from };
    if (to) dateFilter = { ...(dateFilter || {}), lte: to };
    const where: any = dateFilter ? { tenantId, date: dateFilter } : { tenantId };

    const cacheKey = `t=${tenantId}:report:sales:from=${fromRaw || ""}:to=${toRaw || ""}`;

    const payload = await withCache(cacheKey, 60, async () => {
      const invoices = await prisma.invoices.findMany({
        where,
        orderBy: { date: "desc" },
        include: {
          items: {
            select: {
              id: true,
              productId: true,
              name: true,
              quantity: true,
              unitPrice: true,
              subtotal: true,
            },
          },
          customer: { select: { name: true } },
          salesAgentRef: { select: { name: true } },
        },
      });

      const invoiceIds = invoices.map((i) => i.invoiceId);
      const metas = invoiceIds.length
        ? await prisma.invoiceMeta.findMany({
            where: { invoiceId: { in: invoiceIds } },
            select: { invoiceId: true, invoiceNumber: true },
          })
        : [];
      const metaMap = new Map(metas.map((m) => [m.invoiceId, m.invoiceNumber]));

      const productIds = Array.from(
        new Set(
          invoices.flatMap((inv) => inv.items.map((it) => it.productId)).filter(Boolean)
        )
      );
      const productExpiryMap = new Map<string, string | undefined>();
      if (productIds.length) {
        const prods = await prisma.products.findMany({
          where: { tenantId, productId: { in: productIds as string[] } },
          select: { productId: true, expiryDate: true },
        });
        for (const p of prods as any[]) {
          productExpiryMap.set(p.productId, p.expiryDate ? new Date(p.expiryDate).toISOString().slice(0, 10) : undefined);
        }
      }

      const items = invoices.flatMap((inv) =>
        inv.items.map((item) => ({
          id: item.id,
          invoiceNumber: metaMap.get(inv.invoiceId) || inv.invoiceId,
          productId: item.productId,
          productName: item.name,
          customerId: inv.customerId,
          customerName: inv.customer?.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalCost: item.subtotal,
          timestamp: inv.date,
          salesAgentName: (inv as any).salesAgentRef?.name || (inv as any).salesAgent || undefined,
          expiryDate: item.productId ? productExpiryMap.get(item.productId) : undefined,
        }))
      );

      const total = items.reduce((sum: number, it: any) => sum + Number(it.totalCost || 0), 0);

      const dailyMap = new Map<string, number>();
      for (const it of items as any[]) {
        const d = new Date((it as any).timestamp);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
          d.getDate()
        ).padStart(2, "0")}`;
        dailyMap.set(key, (dailyMap.get(key) || 0) + Number((it as any).totalCost || 0));
      }
      const daily = Array.from(dailyMap.entries()).map(([date, totalCost]) => ({ date, totalCost }));

      return { total, count: items.length, items, daily };
    });

    res.set("Cache-Control", "public, max-age=60");
    res.json(payload);
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "Failed to load sales report"));
  }
};

export const getFinancialReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = (req as any).tenantId || req.user?.tenantId || "default";
    const fromRaw = req.query?.from as string | undefined;
    const toRaw = req.query?.to as string | undefined;
    const from = fromRaw ? new Date(fromRaw) : undefined;
    const to = toRaw ? new Date(toRaw) : undefined;

    const cacheKey = `t=${tenantId}:report:financial:from=${fromRaw || ""}:to=${toRaw || ""}`;

    const payload = await withCache(cacheKey, 60, async () => {
      let timestampFilter: any | undefined = undefined;
      if (from) timestampFilter = { ...(timestampFilter || {}), gte: from };
      if (to) timestampFilter = { ...(timestampFilter || {}), lte: to };

      const salesWhere: any = timestampFilter ? { tenantId, date: timestampFilter } : { tenantId };
      const salesInvoices = await prisma.invoices.findMany({
        where: salesWhere,
        orderBy: { date: "desc" },
        include: {
          items: {
            select: {
              id: true,
              productId: true,
              name: true,
              quantity: true,
              unitPrice: true,
              subtotal: true,
            },
          },
          customer: { select: { name: true } },
        },
      });

      const salesInvoiceIds = salesInvoices.map((i) => i.invoiceId);
      const salesMetas = salesInvoiceIds.length
        ? await prisma.invoiceMeta.findMany({
            where: { invoiceId: { in: salesInvoiceIds } },
            select: { invoiceId: true, invoiceNumber: true },
          })
        : [];
      const salesMetaMap = new Map(salesMetas.map((m) => [m.invoiceId, m.invoiceNumber]));

      const salesItems = salesInvoices.flatMap((inv) =>
        inv.items.map((item) => ({
          id: item.id,
          invoiceNumber: salesMetaMap.get(inv.invoiceId) || inv.invoiceId,
          productId: item.productId,
          productName: item.name,
          customerId: inv.customerId,
          customerName: inv.customer?.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalCost: item.subtotal,
          timestamp: inv.date,
        }))
      );
      const salesTotal = salesItems.reduce((sum: number, r: any) => sum + Number(r.totalCost || 0), 0);

      const purchasesWhere: any = timestampFilter
        ? { tenantId, timestamp: timestampFilter }
        : { tenantId };
      const purchaseRowsFull = await prisma.purchases.findMany({
        where: purchasesWhere,
        orderBy: { timestamp: "desc" },
        select: {
          purchaseId: true,
          productId: true,
          timestamp: true,
          quantity: true,
          unitCost: true,
          totalCost: true,
        },
      });
      const purchaseProductIds = Array.from(
        new Set(purchaseRowsFull.map((p: any) => p.productId).filter(Boolean))
      );
      const purchaseProducts = purchaseProductIds.length
        ? await prisma.products.findMany({
            where: { tenantId, productId: { in: purchaseProductIds } },
            select: { productId: true, name: true },
          })
        : [];
      const purchaseProductNameMap = new Map<string, string>(
        purchaseProducts.map((p: any) => [p.productId, p.name] as const)
      );
      const metaRows = purchaseRowsFull.length
        ? await prisma.supplierPurchaseMeta.findMany({
            where: { purchaseId: { in: purchaseRowsFull.map((p: any) => p.purchaseId) } },
            select: { purchaseId: true, supplierName: true, invoiceNumber: true },
          })
        : [];
      const metaMap = new Map<string, any>(metaRows.map((m: any) => [m.purchaseId, m]));
      const purchaseItems = purchaseRowsFull.map((p: any) => ({
        purchaseId: p.purchaseId,
        productId: p.productId,
        productName: purchaseProductNameMap.get(p.productId) || undefined,
        quantity: p.quantity,
        unitCost: Number(p.unitCost || 0),
        totalCost: Number(p.totalCost || 0),
        timestamp: p.timestamp,
        supplierName: metaMap.get(p.purchaseId)?.supplierName || undefined,
        invoiceNumber: metaMap.get(p.purchaseId)?.invoiceNumber || undefined,
      }));
      const purchasesTotal = purchaseItems.reduce(
        (sum: number, r: any) => sum + Number(r.totalCost || 0),
        0
      );

      const expensesRows = await prisma.expenses.findMany({
        where: {
          tenantId,
          ...(from || to
            ? {
                timestamp: {
                  ...(from ? { gte: from } : {}),
                  ...(to ? { lte: to } : {}),
                },
              }
            : {}),
        },
        orderBy: { timestamp: "desc" },
        select: {
          expenseId: true,
          category: true,
          name: true,
          amount: true,
          timestamp: true,
        },
      });
      const expenseItems = expensesRows.map((e: any) => ({
        id: e.expenseId,
        name: e.name || e.category,
        category: e.category,
        amount: Number(e.amount || 0),
        date: e.timestamp.toISOString(),
      }));
      const expensesTotal = expenseItems.reduce(
        (sum: number, e: any) => sum + Number(e.amount || 0),
        0
      );

      const net = salesTotal - purchasesTotal - expensesTotal;

      return {
        salesTotal,
        purchasesTotal,
        expensesTotal,
        net,
        from: fromRaw || null,
        to: toRaw || null,
        salesItems,
        purchaseItems,
        expenseItems,
      };
    });

    res.set("Cache-Control", "public, max-age=60");
    res.json(payload);
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "Failed to load financial report"));
  }
};

export const getPurchasesReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = (req as any).tenantId || req.user?.tenantId || "default";
    const fromRaw = req.query?.from as string | undefined;
    const toRaw = req.query?.to as string | undefined;
    const from = fromRaw ? new Date(fromRaw) : undefined;
    const to = toRaw ? new Date(toRaw) : undefined;

    let timestampFilter: any | undefined = undefined;
    if (from) timestampFilter = { ...(timestampFilter || {}), gte: from };
    if (to) timestampFilter = { ...(timestampFilter || {}), lte: to };
    const where: any = timestampFilter
      ? { tenantId, timestamp: timestampFilter }
      : { tenantId };

    const cacheKey = `t=${tenantId}:report:purchases:from=${fromRaw || ""}:to=${toRaw || ""}`;

    const payload = await withCache(cacheKey, 60, async () => {
      const purchases = await prisma.purchases.findMany({
        where,
        orderBy: { timestamp: "desc" },
        select: {
          purchaseId: true,
          productId: true,
          timestamp: true,
          quantity: true,
          unitCost: true,
          totalCost: true,
          expiryDate: true,
        },
      });

      const productIds = Array.from(
        new Set(purchases.map((p: any) => p.productId).filter(Boolean))
      );
      const products = productIds.length
        ? await prisma.products.findMany({
            where: { tenantId, productId: { in: productIds } },
            select: { productId: true, name: true },
          })
        : [];
      const productNameMap = new Map<string, string>(
        products.map((p: any) => [p.productId, p.name] as const)
      );

      const purchaseIds = purchases.map((p: any) => p.purchaseId);
      const metaRows2 = purchaseIds.length
        ? await prisma.supplierPurchaseMeta.findMany({
            where: { purchaseId: { in: purchaseIds } },
            select: { purchaseId: true, supplierName: true, invoiceNumber: true },
          })
        : [];
      const metaMap2 = new Map<string, any>(metaRows2.map((m: any) => [m.purchaseId, m]));
      const items = purchases.map((p: any) => ({
        purchaseId: p.purchaseId,
        productId: p.productId,
        productName: productNameMap.get(p.productId) || undefined,
        supplierName: metaMap2.get(p.purchaseId)?.supplierName || undefined,
        invoiceNumber: metaMap2.get(p.purchaseId)?.invoiceNumber || undefined,
        quantity: p.quantity,
        unitCost: Number(p.unitCost || 0),
        totalCost: Number(p.totalCost || 0),
        timestamp: p.timestamp,
        expiryDate: p.expiryDate ? new Date(p.expiryDate).toISOString().slice(0, 10) : undefined,
      }));

      const total = items.reduce((sum: number, it: any) => sum + Number(it.totalCost || 0), 0);

      const dailyMap = new Map<string, number>();
      for (const it of items as any[]) {
        const d = new Date((it as any).timestamp);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
          d.getDate()
        ).padStart(2, "0")}`;
        dailyMap.set(key, (dailyMap.get(key) || 0) + Number((it as any).totalCost || 0));
      }
      const daily = Array.from(dailyMap.entries()).map(([date, totalCost]) => ({ date, totalCost }));

      return { total, count: items.length, items, daily };
    });

    res.set("Cache-Control", "public, max-age=60");
    res.json(payload);
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "Failed to load purchases report"));
  }
};

// Export Sales Report to Excel
export const exportSalesReportExcel = async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = (req as any).tenantId || req.user?.tenantId || "default";
    const fromRaw = req.query?.from as string | undefined;
    const toRaw = req.query?.to as string | undefined;
    const from = fromRaw ? new Date(fromRaw) : undefined;
    const to = toRaw ? new Date(toRaw) : undefined;
    let dateFilter: any | undefined = undefined;
    if (from) dateFilter = { ...(dateFilter || {}), gte: from };
    if (to) dateFilter = { ...(dateFilter || {}), lte: to };
    const where: any = dateFilter ? { tenantId, date: dateFilter } : { tenantId };

    const invoices = await prisma.invoices.findMany({
      where,
      orderBy: { date: "desc" },
      include: {
        items: {
          select: {
            id: true,
            productId: true,
            name: true,
            quantity: true,
            unitPrice: true,
            subtotal: true,
          },
        },
        customer: { select: { name: true } },
        salesAgentRef: { select: { name: true } },
      },
    });
    const invoiceIds = invoices.map((i) => i.invoiceId);
    const metas = invoiceIds.length
      ? await prisma.invoiceMeta.findMany({
          where: { invoiceId: { in: invoiceIds } },
          select: { invoiceId: true, invoiceNumber: true },
        })
      : [];
    const metaMap = new Map(metas.map((m) => [m.invoiceId, m.invoiceNumber]));
    const productIds = Array.from(
      new Set(invoices.flatMap((inv) => inv.items.map((it) => it.productId)).filter(Boolean))
    );
    const productExpiryMap = new Map<string, string | undefined>();
    if (productIds.length) {
      const prods = await prisma.products.findMany({
        where: { tenantId, productId: { in: productIds as string[] } },
        select: { productId: true, expiryDate: true },
      });
      for (const p of prods as any[]) {
        productExpiryMap.set(p.productId, p.expiryDate ? new Date(p.expiryDate).toISOString().slice(0, 10) : undefined);
      }
    }
    const rows = invoices.flatMap((inv) =>
      inv.items.map((item) => ({
        Date: inv.date instanceof Date ? inv.date.toISOString().slice(0, 10) : "",
        "Invoice Number": metaMap.get(inv.invoiceId) || inv.invoiceId,
        Customer: inv.customer?.name || "",
        Product: item.name || "",
        Quantity: Number(item.quantity || 0),
        "Unit Price": Number(item.unitPrice || 0),
        Total: Number(item.subtotal || 0),
        "Sales Agent": (inv as any).salesAgentRef?.name || (inv as any).salesAgent || "",
        "Expiry Date": item.productId ? (productExpiryMap.get(item.productId) || "") : "",
      }))
    );
    const wb = XLSX.utils.book_new();
    const headers = ["Date", "Invoice Number", "Customer", "Product", "Quantity", "Unit Price", "Total", "Sales Agent", "Expiry Date"];
    const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
    XLSX.utils.book_append_sheet(wb, ws, "Sales");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const fname = `sales-report_${(fromRaw || "all").replace(/:/g, "-")}_to_${(toRaw || "now").replace(/:/g, "-")}.xlsx`;
    res.setHeader("Content-Disposition", `attachment; filename=${fname}`);
    res.status(200).send(buf);
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "Failed to export sales report as Excel"));
  }
};

// Export Purchases Report to Excel
export const exportPurchasesReportExcel = async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = (req as any).tenantId || req.user?.tenantId || "default";
    const fromRaw = req.query?.from as string | undefined;
    const toRaw = req.query?.to as string | undefined;
    const from = fromRaw ? new Date(fromRaw) : undefined;
    const to = toRaw ? new Date(toRaw) : undefined;
    let timestampFilter: any | undefined = undefined;
    if (from) timestampFilter = { ...(timestampFilter || {}), gte: from };
    if (to) timestampFilter = { ...(timestampFilter || {}), lte: to };
    const where: any = timestampFilter ? { tenantId, timestamp: timestampFilter } : { tenantId };

    const purchases = await prisma.purchases.findMany({
      where,
      orderBy: { timestamp: "desc" },
      select: {
        purchaseId: true,
        productId: true,
        timestamp: true,
        quantity: true,
        unitCost: true,
        totalCost: true,
        expiryDate: true,
      },
    });
    const productIds = Array.from(new Set(purchases.map((p: any) => p.productId).filter(Boolean)));
    const products = productIds.length
      ? await prisma.products.findMany({
          where: { tenantId, productId: { in: productIds as string[] } },
          select: { productId: true, name: true },
        })
      : [];
    const productNameMap = new Map<string, string>(products.map((p: any) => [p.productId, p.name] as const));
    const purchaseIds = purchases.map((p: any) => p.purchaseId);
    const metaRows2 = purchaseIds.length
      ? await prisma.supplierPurchaseMeta.findMany({
          where: { purchaseId: { in: purchaseIds } },
          select: { purchaseId: true, supplierName: true, invoiceNumber: true },
        })
      : [];
    const metaMap2 = new Map<string, any>(metaRows2.map((m: any) => [m.purchaseId, m]));
    const rows = purchases.map((p: any) => ({
      Date: p.timestamp instanceof Date ? p.timestamp.toISOString().slice(0, 10) : "",
      "Invoice Number": metaMap2.get(p.purchaseId)?.invoiceNumber || "",
      Supplier: metaMap2.get(p.purchaseId)?.supplierName || "",
      Product: productNameMap.get(p.productId) || "",
      Quantity: Number(p.quantity || 0),
      "Unit Cost": Number(p.unitCost || 0),
      Total: Number(p.totalCost || 0),
      "Expiry Date": p.expiryDate ? new Date(p.expiryDate).toISOString().slice(0, 10) : "",
    }));
    const wb = XLSX.utils.book_new();
    const headers = ["Date", "Invoice Number", "Supplier", "Product", "Quantity", "Unit Cost", "Total", "Expiry Date"];
    const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
    XLSX.utils.book_append_sheet(wb, ws, "Purchases");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const fname = `purchases-report_${(fromRaw || "all").replace(/:/g, "-")}_to_${(toRaw || "now").replace(/:/g, "-")}.xlsx`;
    res.setHeader("Content-Disposition", `attachment; filename=${fname}`);
    res.status(200).send(buf);
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "Failed to export purchases report as Excel"));
  }
};
