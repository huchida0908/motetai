// DB データインポート（移行用）
// prisma/migration-data.json の内容を、現在アクティブな DB（DATABASE_URL）へ投入する。
// ID はそのまま維持し、外部キーの依存順に挿入する。
// 使い方: db-export.ts → npm run db:use:neon → npx prisma db push --schema prisma/schema.postgres.prisma
//         → npx tsx scripts/db-import.ts

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "../src/generated/prisma";

const prisma = new PrismaClient();

async function main() {
  const dataPath = join(__dirname, "..", "prisma", "migration-data.json");
  const data = JSON.parse(readFileSync(dataPath, "utf8"));

  // 外部キーの依存順（親 → 子）
  await prisma.rider.createMany({ data: data.riders, skipDuplicates: true });
  await prisma.fuelType.createMany({ data: data.fuelTypes, skipDuplicates: true });
  await prisma.raceConfig.createMany({ data: data.raceConfigs, skipDuplicates: true });
  await prisma.segment.createMany({ data: data.segments, skipDuplicates: true });
  await prisma.stint.createMany({ data: data.stints, skipDuplicates: true });
  await prisma.planStint.createMany({ data: data.planStints, skipDuplicates: true });
  await prisma.actualLap.createMany({ data: data.actualLaps, skipDuplicates: true });
  await prisma.planLap.createMany({ data: data.planLaps, skipDuplicates: true });

  const counts = {
    riders: await prisma.rider.count(),
    fuelTypes: await prisma.fuelType.count(),
    raceConfigs: await prisma.raceConfig.count(),
    segments: await prisma.segment.count(),
    stints: await prisma.stint.count(),
    planStints: await prisma.planStint.count(),
    actualLaps: await prisma.actualLap.count(),
    planLaps: await prisma.planLap.count(),
  };
  console.log("インポート後の件数:", counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
