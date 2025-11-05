import { Router } from "express";
import { getCustomers, purgeCustomerPurchases } from "../controllers/customerController";

const router = Router();

router.get("/", getCustomers);
router.delete("/purchases/purge", purgeCustomerPurchases);

export default router;