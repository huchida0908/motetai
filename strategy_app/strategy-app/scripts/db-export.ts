// DB データエクスポート（移行用）
// 現在アクティブな DB（DATABASE_URL）から全テーブルを読み出し、
// prisma/migration-data.json に保存する。
// 使い方: npx tsx scripts/db-export.ts  （SQLite 接続中に実行 → db:use:neon → db-import.ts）

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "../src/generated/prisma";

const prisma = new PrismaClient();

async function main() {
  const data = {
    riders: await prisma.rider.findMany(),
    fuelTypes: await prisma.fuelType.findMany(),
    raceConfigs: await prisma.raceConfig.findMany(),
    segments: await prisma.segment.findMany(),
    stints: await prisma.stint.findMany(),
    planStints: await prisma.planStint.findMany(),
    actualLaps: await prisma.actualLap.findMany(),
    planLaps: await prisma.planLap.findMany(),
  };

  const outPath = join(__dirname, "..", "prisma", "migration-data.json");
  writeFileSync(outPath, JSON.stringify(data, null, 2));

  for (const [table, rows] of Object.entries(data)) {
    console.log(`${table}: ${(rows as unknown[]).length} 件`);
  }
  console.log(`\nエクスポート完了: ${outPath}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
