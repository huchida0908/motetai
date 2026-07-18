// Excel「計画」タブ → 計画データ（PlanStint / PlanLap）インポート
// scripts/data/plan-2026-motetai.json（Excel からパース済み）を、
// アクティブな RaceConfig の計画として登録する。既存の計画は置き換える。
//
// - ライダー: 「内田」は既存の Uchida を流用。「もりけん」「小林」は無ければ新規作成
// - Excel の IN ラップはピット停止 240 秒込みのため、JSON 生成時点で差し引き済み
// - isOverride: アプリの展開ロジック（expandPlan）が生成する基準タイムと
//   異なる周のみ true（再展開時に「上書きを保持」で残せるようにする）
//
// 使い方: npx tsx scripts/import-plan-from-excel.ts

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "../src/generated/prisma";
import { expandPlan, computePlanState, type PlanStintInput } from "../src/lib/plan-calc";

const prisma = new PrismaClient();

interface JsonLap {
  lapInStint: number;
  outIn: "OUT" | "IN" | null;
  condition: string;
  timeSec: number;
}
interface JsonStint {
  stintNumber: number;
  riderName: string;
  plannedLaps: number;
  targetLapSec: number;
  refuelL: number;
  laps: JsonLap[];
}

// 「内田」だけ既存ライダー名が英字のためマッピングする
const RIDER_NAME_MAP: Record<string, string> = { 内田: "Uchida" };
const NEW_RIDER_COLORS = ["#ef4444", "#22c55e", "#a855f7", "#eab308"];

async function main() {
  const dataPath = join(__dirname, "data", "plan-2026-motetai.json");
  const data = JSON.parse(readFileSync(dataPath, "utf8"));
  const stints: JsonStint[] = data.stints;
  const riderTargets: Record<string, number> = data.riderTargets;

  const config = await prisma.raceConfig.findFirst({ where: { isActive: true } });
  if (!config) throw new Error("アクティブな RaceConfig がありません");
  console.log(`対象レース: ${config.raceName} (${config.id})`);

  // ── ライダー解決（無ければ作成） ──
  const existing = await prisma.rider.findMany();
  const usedColors = new Set(existing.map((r) => r.color).filter(Boolean));
  const maxOrder = Math.max(0, ...existing.map((r) => r.displayOrder));
  const riderIdByName = new Map<string, string>();
  let created = 0;

  for (const name of [...new Set(stints.map((s) => s.riderName))]) {
    const dbName = RIDER_NAME_MAP[name] ?? name;
    let rider = existing.find((r) => r.name === dbName);
    if (!rider) {
      const color = NEW_RIDER_COLORS.find((c) => !usedColors.has(c)) ?? null;
      if (color) usedColors.add(color);
      rider = await prisma.rider.create({
        data: {
          name: dbName,
          expectedLapTime: riderTargets[name] ?? config.assumedLapSec,
          color,
          displayOrder: maxOrder + ++created,
        },
      });
      console.log(`ライダー作成: ${dbName} (想定 ${rider.expectedLapTime}s)`);
    }
    riderIdByName.set(name, rider.id);
  }

  // ── レース設定の更新（スタート燃料を Excel に合わせる） ──
  const startFuelL: number = data.raceConfig.startFuelL;
  if (config.startFuelL !== startFuelL) {
    await prisma.raceConfig.update({ where: { id: config.id }, data: { startFuelL } });
    console.log(`startFuelL: ${config.startFuelL} → ${startFuelL}`);
  }

  // ── isOverride 判定用: アプリの展開ロジックによる基準ラップを作る ──
  const stintInputs: PlanStintInput[] = stints.map((s) => ({
    stintNumber: s.stintNumber,
    riderId: riderIdByName.get(s.riderName) ?? null,
    plannedLaps: s.plannedLaps,
    targetLapSec: s.targetLapSec,
    refuelL: s.refuelL,
  }));
  const assumed = {
    assumedLapSec: config.assumedLapSec,
    assumedOutLapSec: config.assumedOutLapSec,
    assumedInLapSec: config.assumedInLapSec,
    assumedWetLapSec: config.assumedWetLapSec,
    assumedScLapSec: config.assumedScLapSec,
  };
  const baseByLapNumber = new Map(expandPlan(stintInputs, assumed).map((l) => [l.lapNumber, l]));

  // ── 置き換え登録 ──
  await prisma.$transaction(async (tx) => {
    const delLaps = await tx.planLap.deleteMany({ where: { raceConfigId: config.id } });
    const delStints = await tx.planStint.deleteMany({ where: { raceConfigId: config.id } });
    console.log(`既存計画を削除: stints=${delStints.count} laps=${delLaps.count}`);

    let lapNumber = 0;
    for (const s of stints) {
      const planStint = await tx.planStint.create({
        data: {
          raceConfigId: config.id,
          stintNumber: s.stintNumber,
          riderId: riderIdByName.get(s.riderName) ?? null,
          plannedLaps: s.plannedLaps,
          targetLapSec: s.targetLapSec,
          refuelL: s.refuelL,
        },
      });
      await tx.planLap.createMany({
        data: s.laps.map((lap) => {
          lapNumber += 1;
          const base = baseByLapNumber.get(lapNumber);
          return {
            raceConfigId: config.id,
            planStintId: planStint.id,
            lapNumber,
            lapInStint: lap.lapInStint,
            riderId: riderIdByName.get(s.riderName) ?? null,
            condition: lap.condition,
            outIn: lap.outIn,
            plannedTimeSec: lap.timeSec,
            isOverride: base ? lap.timeSec !== base.plannedTimeSec : true,
          };
        }),
      });
    }
    console.log(`登録完了: stints=${stints.length} laps=${lapNumber}`);
  }, { timeout: 120_000, maxWait: 15_000 }); // リモート DB（Neon）ではデフォルト 5 秒では足りない

  // ── 検証: アプリと同じ計算で燃料・累積時間を確認 ──
  const savedLaps = await prisma.planLap.findMany({
    where: { raceConfigId: config.id },
    orderBy: { lapNumber: "asc" },
  });
  const stintNumberById = new Map(
    (await prisma.planStint.findMany({ where: { raceConfigId: config.id } })).map((s) => [s.id, s.stintNumber]),
  );
  const { totals, stintStartFuel } = computePlanState(
    savedLaps.map((l) => ({
      lapNumber: l.lapNumber,
      lapInStint: l.lapInStint,
      stintNumber: stintNumberById.get(l.planStintId) ?? 0,
      riderId: l.riderId,
      condition: l.condition,
      outIn: l.outIn as "OUT" | "IN" | null,
      plannedTimeSec: l.plannedTimeSec,
      isOverride: l.isOverride,
    })),
    stintInputs,
    {
      fuelRateDry: config.fuelRateDry,
      fuelRateWet: config.fuelRateWet,
      fuelRateSc: config.fuelRateSc,
      fuelRateOutIn: config.fuelRateOutIn,
    },
    { pitLossSec: config.pitLossSec, startFuelL, tankCapacityL: config.tankCapacityL },
  );
  const mm = Math.floor(totals.totalTimeSec / 60);
  const ss = Math.round(totals.totalTimeSec % 60);
  console.log(`検証: 総周回=${totals.totalLaps} 総時間=${mm}分${ss}秒 (レース時間 ${config.raceDurationMin}分) ピット${totals.pitCount}回`);
  console.log("スティント開始燃料:", Object.entries(stintStartFuel).map(([k, v]) => `ST${k}=${v.toFixed(2)}L`).join(" "));
  if (totals.fuelShortStints.length > 0) {
    console.warn("⚠ 燃料不足のスティント:", totals.fuelShortStints.join(", "));
  }
  const overrides = savedLaps.filter((l) => l.isOverride).length;
  console.log(`isOverride の周: ${overrides} / ${savedLaps.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
