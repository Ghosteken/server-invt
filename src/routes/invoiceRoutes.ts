import { Router } from "express";
import { addPayment, createInvoice, getInvoiceById, getInvoices, updateInvoice, deleteInvoice, getInvoicePrintOptions } from "../controllers/invoiceController";

const router = Router();

router.get("/", getInvoices);
router.get("/:id", getInvoiceById);
router.get("/:id/print-options", getInvoicePrintOptions);
router.post("/", createInvoice);
router.put("/:id", updateInvoice);
router.post("/:id/payments", addPayment);
router.delete("/:id", deleteInvoice);

export default router;
