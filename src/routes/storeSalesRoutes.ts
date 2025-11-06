import { Router } from "express";
import { getStores, getStoreBranchSales, importStoresBranches, upload, importStoresBranchesSample } from "../controllers/storeSalesController";

const router = Router();

router.get("/stores", getStores);
router.get("/branch-sales", getStoreBranchSales);
router.post("/stores/import", upload.single("file"), importStoresBranches);
router.post("/stores/import/sample", importStoresBranchesSample);

export default router;