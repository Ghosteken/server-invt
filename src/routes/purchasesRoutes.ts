import { Router } from "express";
import { getPurchases, deletePurchase } from "../controllers/purchasesController";

const router = Router();

router.get("/", getPurchases);
router.delete("/:id", deletePurchase);

export default router;