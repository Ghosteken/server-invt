import { Router } from "express";
import multer from "multer";
import { getCustomers, importCustomers } from "../controllers/customerController";

const router = Router();

router.get("/", getCustomers);
const upload = multer({ storage: multer.memoryStorage() });
router.post("/import", upload.single("file"), importCustomers);

export default router;
