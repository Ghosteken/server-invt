import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { appendNotification } from "../services/notificationService";

const prisma = new PrismaClient();

export const getProducts = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const rawSearch = req.query.search?.toString() ?? "";
    const search = rawSearch.trim();

    // If a search term is provided, perform a case-insensitive contains match.
    // If no search term, return all products.
    const products = await prisma.products.findMany({
      where: search
        ? {
            name: {
              contains: search,
              mode: "insensitive",
            },
          }
        : undefined,
      orderBy: {
        name: "asc",
      },
    });
    res.json(products);
  } catch (error) {
    res.status(500).json({ message: "Error retrieving products" });
  }
};

export const createProduct = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { productId, name, price, rating, stockQuantity } = req.body;
    const product = await prisma.products.create({
      data: {
        productId,
        name,
        price,
        rating,
        stockQuantity,
      },
    });
    // Log notification for product creation
    appendNotification({
      type: "product",
      message: `Product created: ${name} (qty: ${stockQuantity})`,
      actorUserId: req.user?.userId,
    });
    res.status(201).json(product);
  } catch (error) {
    res.status(500).json({ message: "Error creating product" });
  }
};
