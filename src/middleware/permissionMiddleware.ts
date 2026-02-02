import { Request, Response, NextFunction } from "express";
import prisma from "../db/prisma";

export const requireFeature = (moduleName: string) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const { userId, tenantId } = req.user;
      const tid = tenantId || "default";

      const flags = await prisma.featureFlags.findUnique({
        where: { tenantId_userId: { tenantId: tid, userId } }
      });

      let hasFeature = false;
      const features = flags?.features;

      if (Array.isArray(features)) {
        hasFeature = features.includes(moduleName);
      } else if (typeof features === 'object' && features !== null) {
        // @ts-ignore
        hasFeature = !!features[moduleName];
      }

      if (!hasFeature) {
        return res.status(403).json({ message: `Feature '${moduleName}' is not enabled for this user` });
      }

      next();
    } catch (error) {
      console.error("Feature check error:", error);
      res.status(500).json({ message: "Internal server error during feature check" });
    }
  };
};

export const requirePermission = (moduleName: string, action: string) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const { userId, tenantId, role } = req.user;
      const tid = tenantId || "default";

      // 1. Check Feature Flags (Applies to everyone)
      const flags = await prisma.featureFlags.findUnique({
        where: { tenantId_userId: { tenantId: tid, userId } }
      });

      // Features are stored as JSON. Assume it's an array of strings e.g. ["inventory", "invoices"]
      // or an object { inventory: true }. 
      // Based on typical usage, let's support both array of strings or object keys.
      let hasFeature = false;
      const features = flags?.features;

      if (Array.isArray(features)) {
        hasFeature = features.includes(moduleName);
      } else if (typeof features === 'object' && features !== null) {
        // @ts-ignore
        hasFeature = !!features[moduleName];
      }

      // If feature is missing, deny access
      if (!hasFeature) {
        // However, admins might not have feature flags explicitly set if they are implicit? 
        // No, the system says "note that if a feature is not enabled, no permisions will be active".
        // So we strictly enforce this.
        return res.status(403).json({ message: `Feature '${moduleName}' is not enabled for this user` });
      }

      // 2. Check Permissions (Skip for Admins)
      if (role === "admin" || role === "org_admin" || role === "super_admin") {
        return next();
      }

      // 3. Check User Permissions for regular users
      const userPerms = await prisma.userPermissions.findUnique({
        where: { tenantId_userId: { tenantId: tid, userId } }
      });

      const perms = userPerms?.permissions as Record<string, any> || {};
      const modulePerms = perms[moduleName];

      let hasPermission = false;
      if (Array.isArray(modulePerms)) {
        hasPermission = modulePerms.includes(action);
      } else if (typeof modulePerms === 'object' && modulePerms !== null) {
        hasPermission = !!modulePerms[action];
      }

      if (!hasPermission) {
        return res.status(403).json({ message: `Permission denied: ${moduleName}.${action}` });
      }

      next();
    } catch (error) {
      console.error("Permission check error:", error);
      res.status(500).json({ message: "Internal server error during permission check" });
    }
  };
};
