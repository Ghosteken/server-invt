import { Router } from "express";
import { getPurchases, deletePurchase, createPurchase, addPurchasePayment, updatePurchaseMeta, updatePurchase } from "../controllers/purchasesController";

const router = Router();

router.get("/", getPurchases);
router.post("/", createPurchase);
router.delete("/:id", deletePurchase);
router.post("/:id/payments", addPurchasePayment);
router.put("/:id/meta", updatePurchaseMeta);
router.put("/:id", updatePurchase);

export default router;