import { Request, Response } from "express";
import prisma from "../db/prisma";

export const downloadBackup = async (req: Request, res: Response) => {
  try {
    const headerTenant = String((req.headers["x-tenant-id"] || "")).trim();
    const tenantId = headerTenant || (req as any).tenantId || (req as any).user?.tenantId || "default";

    if (!tenantId) {
      res.status(400).json({ message: "Tenant ID is required for backup." });
      return;
    }

    const [
      users,
      products,
      sales,
      purchases,
      expenses,
      customers,
      customerPurchases,
      invoices,
      invoiceItems,
      payments,
      customerGroups,
      salesAgents,
      locations,
      stores,
      branches,
      featureFlags,
      userPermissions,
      invoiceMeta,
      pcsInventory,
      supportMessages,
      expenseCategories,
      banks,
      expenseBanks,
      supplierPurchaseMeta,
      supplierPayments,
      suppliers,
    ] = await Promise.all([
      prisma.users.findMany({ where: { tenantId } }),
      prisma.products.findMany({ where: { tenantId } }),
      prisma.sales.findMany({ where: { tenantId } }),
      prisma.purchases.findMany({ where: { tenantId } }),
      prisma.expenses.findMany({ where: { tenantId } }),
      prisma.customers.findMany({ where: { tenantId } }),
      prisma.customerPurchases.findMany({ where: { tenantId } }),
      prisma.invoices.findMany({ where: { tenantId } }),
      prisma.invoiceItems.findMany({ where: { tenantId } }),
      prisma.payments.findMany({ where: { tenantId } }),
      prisma.customerGroups.findMany({ where: { tenantId } }),
      prisma.salesAgents.findMany({ where: { tenantId } }),
      prisma.locations.findMany({ where: { tenantId } }),
      prisma.stores.findMany({ where: { tenantId } }),
      prisma.branches.findMany({ where: { tenantId } }),
      prisma.featureFlags.findMany({ where: { tenantId } }),
      prisma.userPermissions.findMany({ where: { tenantId } }),
      prisma.invoiceMeta.findMany({ where: { tenantId } }),
      prisma.pcsInventory.findMany({ where: { tenantId } }),
      prisma.supportMessages.findMany({ where: { tenantId } }),
      prisma.expenseCategories.findMany({ where: { tenantId } }),
      prisma.banks.findMany({ where: { tenantId } }),
      prisma.expenseBanks.findMany({ where: { tenantId } }),
      prisma.supplierPurchaseMeta.findMany({ where: { tenantId } }),
      prisma.supplierPayments.findMany({ where: { tenantId } }),
      prisma.suppliers.findMany({ where: { tenantId } }),
    ]);

    const backupData = {
      meta: {
        timestamp: new Date().toISOString(),
        tenantId,
        version: "1.0.0",
      },
      data: {
        users,
        products,
        sales,
        purchases,
        expenses,
        customers,
        customerPurchases,
        invoices,
        invoiceItems,
        payments,
        customerGroups,
        salesAgents,
        locations,
        stores,
        branches,
        featureFlags,
        userPermissions,
        invoiceMeta,
        pcsInventory,
        supportMessages,
        expenseCategories,
        banks,
        expenseBanks,
        supplierPurchaseMeta,
        supplierPayments,
        suppliers,
      },
    };

    const fileName = `backup-${tenantId}-${new Date().toISOString().split("T")[0]}.json`;

    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Content-Type", "application/json");
    res.send(JSON.stringify(backupData, null, 2));
  } catch (error) {
    console.error("Backup failed:", error);
    res.status(500).json({ message: "Failed to generate backup." });
  }
};

export const restoreBackup = async (req: Request, res: Response) => {
  try {
    const headerTenant = String((req.headers["x-tenant-id"] || "")).trim();
    const tenantId = headerTenant || (req as any).tenantId || (req as any).user?.tenantId || "default";

    if (!tenantId) {
      res.status(400).json({ message: "Tenant ID is required for restore." });
      return;
    }

    const backup = req.body;
    
    if (!backup || !backup.meta || !backup.data) {
      res.status(400).json({ message: "Invalid backup file format." });
      return;
    }

    // Security check: Ensure backup tenant matches current tenant (unless super admin override, but let's be safe)
    if (backup.meta.tenantId !== tenantId) {
      res.status(403).json({ message: `Tenant mismatch: Backup is for '${backup.meta.tenantId}' but you are restoring to '${tenantId}'.` });
      return;
    }

    const { data } = backup;
    let restoredCount = 0;

    // Helper to restore a model using upsert (create or update)
    // We process sequentially to respect foreign key constraints
    
    // Batch 1: Independent Tables
    // Users
    if (Array.isArray(data.users)) {
      for (const item of data.users) {
        await prisma.users.upsert({
          where: { userId: item.userId },
          update: item,
          create: item,
        });
        restoredCount++;
      }
    }

    // Products
    if (Array.isArray(data.products)) {
      for (const item of data.products) {
        await prisma.products.upsert({
          where: { productId: item.productId },
          update: item,
          create: item,
        });
        restoredCount++;
      }
    }

    // Customers
    if (Array.isArray(data.customers)) {
      for (const item of data.customers) {
        await prisma.customers.upsert({
          where: { customerId: item.customerId },
          update: item,
          create: item,
        });
        restoredCount++;
      }
    }

    // Sales Agents
    if (Array.isArray(data.salesAgents)) {
      for (const item of data.salesAgents) {
        await prisma.salesAgents.upsert({
          where: { id: item.id },
          update: item,
          create: item,
        });
        restoredCount++;
      }
    }

    // Locations
    if (Array.isArray(data.locations)) {
      for (const item of data.locations) {
        await prisma.locations.upsert({
          where: { id: item.id },
          update: item,
          create: item,
        });
        restoredCount++;
      }
    }

    // Stores
    if (Array.isArray(data.stores)) {
      for (const item of data.stores) {
        await prisma.stores.upsert({
          where: { id: item.id },
          update: item,
          create: item,
        });
        restoredCount++;
      }
    }

    // Feature Flags
    if (Array.isArray(data.featureFlags)) {
      for (const item of data.featureFlags) {
        await prisma.featureFlags.upsert({
          where: { id: item.id },
          update: item,
          create: item,
        });
        restoredCount++;
      }
    }

    // User Permissions
    if (Array.isArray(data.userPermissions)) {
      for (const item of data.userPermissions) {
        await prisma.userPermissions.upsert({
          where: { id: item.id },
          update: item,
          create: item,
        });
        restoredCount++;
      }
    }

    // PCS Inventory
    if (Array.isArray(data.pcsInventory)) {
      for (const item of data.pcsInventory) {
        await prisma.pcsInventory.upsert({
          where: { id: item.id },
          update: item,
          create: item,
        });
        restoredCount++;
      }
    }

    // Support Messages
    if (Array.isArray(data.supportMessages)) {
      for (const item of data.supportMessages) {
        await prisma.supportMessages.upsert({
          where: { id: item.id },
          update: item,
          create: item,
        });
        restoredCount++;
      }
    }

    // Expense Categories
    if (Array.isArray(data.expenseCategories)) {
      for (const item of data.expenseCategories) {
        await prisma.expenseCategories.upsert({
          where: { id: item.id },
          update: item,
          create: item,
        });
        restoredCount++;
      }
    }

    // Banks
    if (Array.isArray(data.banks)) {
      for (const item of data.banks) {
        await prisma.banks.upsert({
          where: { id: item.id },
          update: item,
          create: item,
        });
        restoredCount++;
      }
    }
    
    // Expense Banks
    if (Array.isArray(data.expenseBanks)) {
      for (const item of data.expenseBanks) {
        await prisma.expenseBanks.upsert({
          where: { id: item.id },
          update: item,
          create: item,
        });
        restoredCount++;
      }
    }

    // Suppliers
    if (Array.isArray(data.suppliers)) {
      for (const item of data.suppliers) {
        await prisma.suppliers.upsert({
          where: { id: item.id },
          update: item,
          create: item,
        });
        restoredCount++;
      }
    }

    // Customer Groups (Note: Membership link is implicit m-n and might be lost if not exported separately, but groups themselves are restored)
    if (Array.isArray(data.customerGroups)) {
      for (const item of data.customerGroups) {
        await prisma.customerGroups.upsert({
          where: { groupId: item.groupId },
          update: item,
          create: item,
        });
        restoredCount++;
      }
    }

    // Batch 2: First-Level Dependencies (depend on Batch 1)
    
    // Branches (depends on Stores)
    if (Array.isArray(data.branches)) {
      for (const item of data.branches) {
        try {
          await prisma.branches.upsert({
            where: { id: item.id },
            update: item,
            create: item,
          });
          restoredCount++;
        } catch (e) { console.warn(`Skipping branch ${item.id}: parent store missing?`); }
      }
    }

    // Sales (depends on Products)
    if (Array.isArray(data.sales)) {
      for (const item of data.sales) {
        try {
          await prisma.sales.upsert({
            where: { saleId: item.saleId },
            update: item,
            create: item,
          });
          restoredCount++;
        } catch (e) { console.warn(`Skipping sale ${item.saleId}: parent product missing?`); }
      }
    }

    // Purchases (depends on Products)
    if (Array.isArray(data.purchases)) {
      for (const item of data.purchases) {
        try {
          await prisma.purchases.upsert({
            where: { purchaseId: item.purchaseId },
            update: item,
            create: item,
          });
          restoredCount++;
        } catch (e) { console.warn(`Skipping purchase ${item.purchaseId}: parent product missing?`); }
      }
    }

    // Expenses (depends on ExpenseBanks - optional)
    if (Array.isArray(data.expenses)) {
      for (const item of data.expenses) {
        try {
          await prisma.expenses.upsert({
            where: { expenseId: item.expenseId },
            update: item,
            create: item,
          });
          restoredCount++;
        } catch (e) { console.warn(`Skipping expense ${item.expenseId}`); }
      }
    }

    // Customer Purchases (depends on Customers, Products)
    if (Array.isArray(data.customerPurchases)) {
      for (const item of data.customerPurchases) {
        try {
          await prisma.customerPurchases.upsert({
            where: { id: item.id },
            update: item,
            create: item,
          });
          restoredCount++;
        } catch (e) { console.warn(`Skipping customer purchase ${item.id}`); }
      }
    }

    // Invoices (depends on Customers, SalesAgents, Locations)
    if (Array.isArray(data.invoices)) {
      for (const item of data.invoices) {
        try {
          await prisma.invoices.upsert({
            where: { invoiceId: item.invoiceId },
            update: item,
            create: item,
          });
          restoredCount++;
        } catch (e) { console.warn(`Skipping invoice ${item.invoiceId}: parent missing?`); }
      }
    }

    // Batch 3: Second-Level Dependencies (depend on Batch 2)

    // Invoice Items (depends on Invoices)
    if (Array.isArray(data.invoiceItems)) {
      for (const item of data.invoiceItems) {
        try {
          await prisma.invoiceItems.upsert({
            where: { id: item.id },
            update: item,
            create: item,
          });
          restoredCount++;
        } catch (e) { console.warn(`Skipping invoice item ${item.id}: parent invoice missing?`); }
      }
    }

    // Payments (depends on Invoices)
    if (Array.isArray(data.payments)) {
      for (const item of data.payments) {
        try {
          await prisma.payments.upsert({
            where: { id: item.id },
            update: item,
            create: item,
          });
          restoredCount++;
        } catch (e) { console.warn(`Skipping payment ${item.id}: parent invoice missing?`); }
      }
    }

    // Supplier Purchase Meta (depends on Purchases)
    if (Array.isArray(data.supplierPurchaseMeta)) {
      for (const item of data.supplierPurchaseMeta) {
        try {
          await prisma.supplierPurchaseMeta.upsert({
            where: { id: item.id },
            update: item,
            create: item,
          });
          restoredCount++;
        } catch (e) { console.warn(`Skipping supplier meta ${item.id}`); }
      }
    }

    // Supplier Payments (depends on Purchases)
    if (Array.isArray(data.supplierPayments)) {
      for (const item of data.supplierPayments) {
        try {
          await prisma.supplierPayments.upsert({
            where: { id: item.id },
            update: item,
            create: item,
          });
          restoredCount++;
        } catch (e) { console.warn(`Skipping supplier payment ${item.id}`); }
      }
    }

    // Invoice Meta (depends on Invoices)
    if (Array.isArray(data.invoiceMeta)) {
      for (const item of data.invoiceMeta) {
        try {
          await prisma.invoiceMeta.upsert({
            where: { id: item.id },
            update: item,
            create: item,
          });
          restoredCount++;
        } catch (e) { console.warn(`Skipping invoice meta ${item.id}`); }
      }
    }

    res.json({ message: "Restore completed successfully.", restoredCount });
  } catch (error) {
    console.error("Restore failed:", error);
    res.status(500).json({ message: "Failed to restore backup." });
  }
};
