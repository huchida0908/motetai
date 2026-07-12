// テスト/検証用データのクリア。ラップと 2 本目以降のスティントを削除し、
// 1 本目スティントを未終了に戻して初期状態にする（レース設定・ドライバーは残す）。
import { PrismaClient } from '../src/generated/prisma';

const prisma = new PrismaClient();

async function main() {
  const race = await prisma.raceConfig.findFirst({ where: { isActive: true } });
  if (!race) return;
  await prisma.actualLap.deleteMany({ where: { raceConfigId: race.id } });
  await prisma.stint.deleteMany({ where: { raceConfigId: race.id, stintNumber: { gt: 1 } } });
  await prisma.stint.updateMany({
    where: { raceConfigId: race.id, stintNumber: 1 },
    data: { endedAt: null, startedAt: null },
  });
  await prisma.raceConfig.update({ where: { id: race.id }, data: { startedAt: null } });
  console.log('リセット完了: ラップ削除・スティント1本のみ・レース未開始に戻しました。');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
