"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const storesController_1 = require("../controllers/storesController");
const router = (0, express_1.Router)();
// Stores CRUD
router.get("/", storesController_1.listStores);
router.post("/", storesController_1.createStore);
router.put("/:id", storesController_1.updateStore);
router.delete("/:id", storesController_1.deleteStore);
// Branches under a store
router.get("/:storeId/branches", storesController_1.listBranches);
router.post("/:storeId/branches", storesController_1.createBranch);
// Branch direct operations
router.put("/branches/:id", storesController_1.updateBranch);
router.delete("/branches/:id", storesController_1.deleteBranch);
exports.default = router;
