import { Router } from "express";
import { addPayment, createInvoice, getInvoiceById, getInvoices, updateInvoice, deleteInvoice, getInvoicePrintOptions, getInvoiceStats } from "../controllers/invoiceController";
import { authenticateToken } from "../middleware/authMiddleware";

const router = Router();

router.get("/", authenticateToken, getInvoices);
router.get("/stats", authenticateToken, getInvoiceStats);
router.get("/:id", authenticateToken, getInvoiceById);
router.get("/:id/print-options", authenticateToken, getInvoicePrintOptions);
router.post("/", createInvoice);
router.put("/:id", updateInvoice);
router.post("/:id/payments", addPayment);
router.delete("/:id", deleteInvoice);

export default router;
