import { PrismaClient } from "@prisma/client";
import { appendNotification } from "../services/notificationService";
import OpenAI from "openai";

const getClient = () => {
  // Deprecated: Internal logic now handles key rotation per request
  return new OpenAI({
    apiKey: "dummy",
    baseURL: "https://openrouter.ai/api/v1",
  });
};

export type AIAdviceMode = 
  | "general" 
  | "restock" 
  | "dead_stock" 
  | "customer_insight" 
  | "profit_optimization" 
  | "chat";

export const getPurchasingAdvice = async (
  prisma: PrismaClient,
  tenantId: string,
  mode: AIAdviceMode = "general",
  userQuery?: string
): Promise<{ analysis: string; timestamp: string }> => {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // Base Context: Inventory Data
  // We'll fetch this for most modes
  let contextData = "";
  
  if (mode === "customer_insight") {
    // Special fetching for customer insights
    const topCustomers = await prisma.customers.findMany({
      where: { tenantId },
      include: {
        purchases: {
          take: 5,
          orderBy: { timestamp: "desc" },
          include: { product: { select: { name: true } } }
        }
      },
      take: 20, // Analyze top 20 recent customers or active ones
    });
    
    contextData = topCustomers.map(c => {
        const bought = c.purchases.map(p => p.product.name).join(", ");
        return `Customer: ${c.name} | Location: ${c.city || 'Unknown'} | Recent Purchases: ${bought}`;
    }).join("\n");
  } else {
    // Standard Inventory Context
    const productsWithId = await prisma.products.findMany({
      where: { tenantId },
      select: {
        productId: true,
        name: true,
        stockQuantity: true,
        price: true,
        purchasePrice: true,
        category: true,
      },
    });

    const recentSales = await prisma.sales.groupBy({
      by: ["productId"],
      where: {
        tenantId,
        timestamp: { gte: thirtyDaysAgo },
      },
      _sum: {
        quantity: true,
      },
    });

    const salesMap = new Map<string, number>();
    recentSales.forEach((s) => {
      salesMap.set(s.productId, s._sum.quantity || 0);
    });

    contextData = productsWithId.map((p) => {
      const sold = salesMap.get(p.productId) || 0;
      return `Product: ${p.name} | Stock: ${p.stockQuantity} | Sales(30d): ${sold} | Cost: ${p.purchasePrice} | Price: ${p.price}`;
    }).join("\n");
  }

  // Construct Prompt based on Mode
  let prompt = "";
  
  const baseInstruction = `
    You are an expert inventory purchasing advisor named 'Spark'. 
    Your tone is friendly, professional, and deeply personalized. You sound like a dedicated partner who cares about the business's success.
    
    IMPORTANT RULES:
    1. NEVER mention "Markdown", "formatting", "JSON", or how you are structuring the response.
    2. Provide detailed, thoughtful explanations. Do not be overly brief.
    3. Use specific data points from the context to back up every claim.
    4. Use a natural, conversational style. Feel free to use analogies if helpful.
    5. Use bolding for key figures and product names to make it scannable.
  `;

  switch (mode) {
    case "restock":
      prompt = `
        ${baseInstruction}
        Analyze the inventory data to identify items that urgently need restocking.
        Focus on high-velocity items (high sales) that are running low on stock.
        Provide a comprehensive list of what to buy, explaining WHY for each item based on its sales performance.
        Suggest specific quantities to order to cover the next 30 days of demand.
        
        Data:
        ${contextData}
      `;
      break;
      
    case "dead_stock":
      prompt = `
        ${baseInstruction}
        Identify "Dead Stock" - items that are tying up capital with little to no sales in the last 30 days.
        Analyze why these might not be selling (e.g., high price compared to similar items?).
        Provide a detailed strategy for clearing this stock, such as specific discount percentages or bundle ideas.
        
        Data:
        ${contextData}
      `;
      break;
      
    case "profit_optimization":
      prompt = `
        ${baseInstruction}
        Analyze the margins (Price - Cost) across the inventory.
        Identify the most profitable items that should be promoted more aggressively.
        Also, flag low-margin items that are consuming resources and suggest pricing adjustments.
        Provide a clear financial rationale for your recommendations.
        
        Data:
        ${contextData}
      `;
      break;
      
    case "customer_insight":
      prompt = `
        ${baseInstruction}
        Analyze the purchase history to find meaningful patterns.
        Identify key customer segments or buying behaviors (e.g., "Customers who buy X often also buy Y").
        Suggest personalized marketing or sales strategies based on these insights.
        
        Data:
        ${contextData}
      `;
      break;
      
    case "chat":
      prompt = `
        ${baseInstruction}
        Answer the user's question with depth and context using the provided data.
        If the data supports it, offer additional insights related to their query that they might not have thought of.
        
        User Question: "${userQuery}"
        
        Data:
        ${contextData}
      `;
      break;
      
    case "general":
    default:
      prompt = `
        ${baseInstruction}
        Conduct a comprehensive health check on the inventory.
        Provide a detailed summary of the current state of affairs.
        Highlight the top 3 critical areas requiring immediate attention (e.g., stockouts, overstock, margin issues).
        Explain the potential business impact of these issues if left unaddressed.
        
        Data:
        ${contextData}
      `;
      break;
  }

  const MODELS = [
    "deepseek/deepseek-r1-distill-llama-70b:free",
    "deepseek/deepseek-r1:free",
    "meta-llama/llama-3.2-11b-vision-instruct:free",
    "qwen/qwen-2.5-72b-instruct:free",
    "meta-llama/llama-3.1-8b-instruct:free",
    "google/gemini-2.0-flash-lite-preview-02-05:free",
    "google/gemini-2.0-flash-thinking-exp:free",
    "mistralai/mistral-small-24b-instruct-2501:free",
    "microsoft/phi-3.5-mini-128k-instruct:free",
    "nvidia/llama-3.1-nemotron-70b-instruct:free"
  ];

  let analysis = "No analysis generated.";
  let error: any = null;
  
  // Get all available keys
  const keys = [
    process.env.OPENROUTER_API_KEY,
    process.env.OPENROUTER_API_KEY_2,
    process.env.OPENROUTER_API_KEY_3,
    ...(process.env.OPENROUTER_API_KEYS ? process.env.OPENROUTER_API_KEYS.split(",") : [])
  ].filter(Boolean);

  if (keys.length === 0) {
    throw new Error("No OpenRouter API keys found.");
  }

  // Key rotation counter
  let keyIndex = Math.floor(Math.random() * keys.length);

  for (const model of MODELS) {
    try {
      // Rotate key for each attempt to maximize success rate
      const currentKey = keys[keyIndex % keys.length];
      keyIndex++;

      const openai = new OpenAI({
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: currentKey,
        defaultHeaders: {
          "HTTP-Referer": "http://localhost:3000",
          "X-Title": "InventorySaaS",
        },
      });

      console.log(`Trying model: ${model} with key ending in ...${String(currentKey).slice(-4)}`);

      const completion = await openai.chat.completions.create({
        model: model,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      });

      analysis = completion.choices[0]?.message?.content || "No analysis generated.";
      
      // If we got a valid response, break the loop
      if (analysis && analysis.length > 50) {
        break;
      }
    } catch (err: any) {
      console.error(`Error with model ${model}:`, err.message);
      
      // Check for specific error codes to inform future logic (optional logging)
      if (err.status === 404 || err.code === 404) {
        console.warn(`Model ${model} not found (404).`);
      } else if (err.status === 400 || err.code === 400) {
        console.warn(`Model ${model} request invalid (400).`);
      } else if (err.status === 429 || err.code === 429) {
        console.warn(`Model ${model} rate limited (429).`);
      }

      error = err;
      // Continue to next model
      continue;
    }
  }

  // If all models failed
  if (analysis === "No analysis generated." && error) {
    console.error("All AI models failed:", error);
    throw new Error("Unable to generate advice at this time. Please try again later.");
  }

  return {
    analysis,
    timestamp: new Date().toISOString(),
  };
};
