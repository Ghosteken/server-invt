import { Router } from "express";
import { getStores, getStoreBranchSales, importStoresBranches, upload, importStoresBranchesSample } from "../controllers/storeSalesController";
import { authenticateToken } from "../middleware/authMiddleware";

const router = Router();

router.get("/stores", authenticateToken, getStores);
router.get("/branch-sales", authenticateToken, getStoreBranchSales);
router.post("/stores/import", authenticateToken, upload.single("file"), importStoresBranches);
router.post("/stores/import/sample", authenticateToken, importStoresBranchesSample);

export default router;
