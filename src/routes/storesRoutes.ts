import { Router } from "express";
import { listStores, createStore, updateStore, deleteStore, listBranches, createBranch, updateBranch, deleteBranch } from "../controllers/storesController";

const router = Router();

// Stores CRUD
router.get("/", listStores);
router.post("/", createStore);
router.put("/:id", updateStore);
router.delete("/:id", deleteStore);

// Branches under a store
router.get("/:storeId/branches", listBranches);
router.post("/:storeId/branches", createBranch);

// Branch direct operations
router.put("/branches/:id", updateBranch);
router.delete("/branches/:id", deleteBranch);

export default router;