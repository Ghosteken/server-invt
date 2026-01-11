import { Router } from "express";
import { addPayment, createInvoice, getInvoiceById, getInvoices, updateInvoice, deleteInvoice, getInvoicePrintOptions, getInvoiceStats } from "../controllers/invoiceController";
import { authenticateToken } from "../middleware/authMiddleware";
import { requirePermission } from "../middleware/permissionMiddleware";

const router = Router();

router.get("/", authenticateToken, getInvoices);
router.get("/stats", authenticateToken, getInvoiceStats);
router.get("/:id", authenticateToken, getInvoiceById);
router.get("/:id/print-options", authenticateToken, getInvoicePrintOptions);
router.post("/", authenticateToken, requirePermission("invoices", "create"), createInvoice);
router.put("/:id", authenticateToken, requirePermission("invoices", "update"), updateInvoice);
router.post("/:id/payments", authenticateToken, requirePermission("invoices", "addPayment"), addPayment);
router.delete("/:id", authenticateToken, requirePermission("invoices", "delete"), deleteInvoice);

export default router;
