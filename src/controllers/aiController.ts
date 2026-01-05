import { Request, Response } from "express";
import prisma from "../db/prisma";
import { getPurchasingAdvice, AIAdviceMode } from "../services/aiService";
import { createErrorResponse } from "../utils/errorHandler";

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
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "Failed to generate AI analysis"));
  }
};

export const getExpenseAnomalies = async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = (req as any).tenantId || req.user?.tenantId || "default";
    
    // Fetch all expenses
    const expenses = await prisma.expenses.findMany({
      where: { tenantId },
      orderBy: { timestamp: "desc" }
    });

    const anomalies: any[] = [];
    const recurring: any[] = [];

    // Group by category for anomaly detection
    const byCategory: Record<string, typeof expenses> = {};
    for (const e of expenses) {
      const cat = e.category || "Uncategorized";
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(e);
    }

    // Detect Anomalies (Statistical Outliers)
    for (const [cat, items] of Object.entries(byCategory)) {
      if (items.length < 3) continue; // Need minimum data points
      
      const amounts = items.map(i => Number(i.amount));
      const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
      const variance = amounts.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / amounts.length;
      const stdDev = Math.sqrt(variance);

      // Flag if > 2 stdDev from mean and significantly higher than mean
      for (const item of items) {
        if (Number(item.amount) > mean + (2 * stdDev)) {
          anomalies.push({
            ...item,
            reason: `Unusually high amount for ${cat} (Mean: ${mean.toFixed(2)})`,
            confidence: "High"
          });
        }
      }
    }

    // Detect Continuous/Recurring Expenses
    // Look for identical amounts within similar time intervals or just frequent same-amount items
    const byAmount: Record<string, typeof expenses> = {};
    for (const e of expenses) {
        const key = `${e.amount}-${e.category}`;
        if (!byAmount[key]) byAmount[key] = [];
        byAmount[key].push(e);
    }

    for (const [key, items] of Object.entries(byAmount)) {
        if (items.length >= 3) {
            // Sort by date desc
            items.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
            
            // Check for regularity? For now, just flagging frequent identical expenses is a good start for "continuous"
            recurring.push({
                groupKey: key,
                count: items.length,
                category: items[0].category,
                amount: items[0].amount,
                lastOccurred: items[0].timestamp,
                examples: items.slice(0, 5)
            });
        }
    }

    res.json({ anomalies, recurring });

  } catch (err) {
    res.status(500).json(createErrorResponse(err, "Failed to detect anomalies"));
  }
};
