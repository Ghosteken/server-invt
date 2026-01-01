import { Request, Response } from "express";
import prisma from "../db/prisma";
import { getPurchasingAdvice, AIAdviceMode } from "../services/aiService";

export const getPurchasingAdvisorAnalysis = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const tenantId = (req as any).tenantId || req.user?.tenantId || "default";
    const { mode, query } = req.body;
    
    // Validate mode
    const validModes: AIAdviceMode[] = ["general", "restock", "dead_stock", "customer_insight", "profit_optimization", "chat"];
    const safeMode = validModes.includes(mode) ? (mode as AIAdviceMode) : "general";

    const result = await getPurchasingAdvice(prisma, tenantId, safeMode, query);
    res.json(result);
  } catch (error) {
    console.error("Error generating purchasing advice:", error);
    res.status(500).json({ message: "Failed to generate AI analysis" });
  }
};
