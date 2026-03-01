import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const newCodes = [];

  // ここで作成する個数を指定（今回は100個）
  for (let i = 0; i < 100; i++) {
    // 4桁のランダムな英数字を作成
    const randomStr = Math.random().toString(36).substring(2, 6).toUpperCase();
    newCodes.push({ code: `WISH-${randomStr}` });
  }

  // データベースに一括追加
  const result = await prisma.promoCode.createMany({
    data: newCodes,
    skipDuplicates: true,
  });

  console.log(`${result.count}個のプロモコードを自動生成しました！`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });