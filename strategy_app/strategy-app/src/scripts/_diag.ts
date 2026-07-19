// 一時診断スクリプト（原因特定後に削除）。URL は環境変数 DIAG_URL から受け取る。
import { PrismaClient } from '../generated/prisma';

async function main() {
  const url = process.env.DIAG_URL;
  if (!url) { console.error('DIAG_URL 未設定'); return; }
  const prisma = new PrismaClient({ datasourceUrl: url });
  const t0 = Date.now();
  try {
    const r = await prisma.raceConfig.findFirst({ where: { isActive: true } });
    const laps = await prisma.actualLap.count();
    const plan = await prisma.planLap.count();
    console.log(`OK (${Date.now() - t0}ms) race=${r?.raceName} actualLap=${laps} planLap=${plan}`);
  } catch (e) {
    console.error(`ERROR (${Date.now() - t0}ms): ` + (e instanceof Error ? e.message.split('\n')[0] : e));
  } finally {
    await prisma.$disconnect();
  }
}
main();
