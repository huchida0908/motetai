// 初期データ投入。もて耐 2023 の設定値・ドライバーを Excel から採用。
// 既にアクティブなレース設定があれば何もしない（再実行で入力データを消さないため）。
import { PrismaClient } from '../src/generated/prisma';

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.raceConfig.findFirst({ where: { isActive: true } });
  if (existing) {
    console.log('アクティブなレース設定が既にあるためシードをスキップします:', existing.raceName);
    return;
  }

  const race = await prisma.raceConfig.create({
    data: {
      raceName: 'もて耐 2023',
      isActive: true,
      raceDurationMin: 420,
      courseLengthKm: 4.801379,
      tankCapacityL: 15,
      startFuelL: 14.4,
      pitLossSec: 240,
      maxStintLap: 15,
      fuelRateDry: 0.35,
      fuelRateWet: 0.32,
      fuelRateSc: 0.27,
      fuelRateOutIn: 0.33,
      assumedLapSec: 146, // 2:26
      assumedOutLapSec: 160, // 2:40
      assumedInLapSec: 140, // 2:20
      assumedWetLapSec: 170, // 2:50
      assumedScLapSec: 260, // 4:20
    },
  });

  const riders = [
    { name: 'Uchida', expectedLapTime: 144.34, color: '#ef4444', displayOrder: 1 },
    { name: 'Hideto', expectedLapTime: 146.0, color: '#22c55e', displayOrder: 2 },
    { name: 'Fukuoka', expectedLapTime: 145.71, color: '#3b82f6', displayOrder: 3 },
    { name: 'Yoshinaga', expectedLapTime: 147.71, color: '#a855f7', displayOrder: 4 },
  ];
  const createdRiders = [];
  for (const r of riders) {
    createdRiders.push(await prisma.rider.create({ data: r }));
  }

  // 最初のスティント（1本目）を開いておく
  await prisma.stint.create({
    data: {
      raceConfigId: race.id,
      stintNumber: 1,
      riderId: createdRiders[0].id,
      refuelL: race.startFuelL,
      plannedLaps: 20,
    },
  });

  console.log('シード完了: レース設定 / ドライバー4名 / スティント1 を作成しました。');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
