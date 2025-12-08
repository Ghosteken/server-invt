import { Router } from "express";
import { superAdminLogin, listOrgs, createOrg, listOrgAdmins, createOrgAdmin, getOrg, blockOrg, unblockOrg, blockOrgAdmin, unblockOrgAdmin, deleteOrg } from "../controllers/superAdminController";

const router = Router();

router.post("/login", superAdminLogin);
router.get("/orgs", listOrgs);
router.post("/orgs", createOrg);
router.get("/orgs/:id", getOrg);
router.delete("/orgs/:id", deleteOrg);
router.get("/orgs/:id/admins", listOrgAdmins);
router.post("/orgs/:id/admins", createOrgAdmin);
router.patch("/orgs/:id/block", blockOrg);
router.patch("/orgs/:id/unblock", unblockOrg);
router.patch("/orgs/:orgId/admins/:adminId/block", blockOrgAdmin);
router.patch("/orgs/:orgId/admins/:adminId/unblock", unblockOrgAdmin);

export default router;
