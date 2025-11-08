const { PrismaClient } = require("@prisma/client");

async function main() {
  const prisma = new PrismaClient();
  try {
    const products = await prisma.products.count();
    const sales = await prisma.sales.count();
    const purchases = await prisma.purchases.count();
    const users = await prisma.users.count();
    console.log(
      `Counts => products: ${products}, sales: ${sales}, purchases: ${purchases}, users: ${users}`
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});