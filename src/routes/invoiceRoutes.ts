import { Router } from "express";
import { addPayment, createInvoice, getInvoiceById, getInvoices, updateInvoice, deleteInvoice, getInvoicePrintOptions, getInvoiceStats } from "../controllers/invoiceController";
import { authenticateToken } from "../middleware/authMiddleware";

const router = Router();

router.get("/", authenticateToken, getInvoices);
router.get("/stats", authenticateToken, getInvoiceStats);
router.get("/:id", authenticateToken, getInvoiceById);
router.get("/:id/print-options", authenticateToken, getInvoicePrintOptions);
router.post("/", authenticateToken, createInvoice);
router.put("/:id", authenticateToken, updateInvoice);
router.post("/:id/payments", authenticateToken, addPayment);
router.delete("/:id", authenticateToken, deleteInvoice);

export default router;
