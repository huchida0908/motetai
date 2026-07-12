import { PrismaClient } from '@/generated/prisma';

// Next.js の開発時ホットリロードで PrismaClient が多重生成されるのを防ぐシングルトン。
// （グローバルに 1 インスタンスを保持する定番パターン）
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
