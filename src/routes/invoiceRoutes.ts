import { Router } from "express";
import { addPayment, createInvoice, getInvoiceById, getInvoices, updateInvoice } from "../controllers/invoiceController";

const router = Router();

router.get("/", getInvoices);
router.get("/:id", getInvoiceById);
router.post("/", createInvoice);
router.put("/:id", updateInvoice);
router.post("/:id/payments", addPayment);

export default router;