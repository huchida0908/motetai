// サーバー側で計画状態を組み立てる／スティント計画を保存して周単位に再展開する。
// /api/plan と /plan ページから使う。
import { prisma } from '@/lib/prisma';
import { getActiveRace } from '@/lib/live';
import type { FuelRates } from '@/lib/race-calc';
import {
  expandPlan,
  applyOverrides,
  computePlanState,
  basePlannedTime,
  type PlanStintInput,
  type PlanLapOverride,
} from '@/lib/plan-calc';

export async function getPlanState() {
  const race = await getActiveRace();
  if (!race) return { race: null } as const;

  const [stints, laps, riders] = await Promise.all([
    prisma.planStint.findMany({
      where: { raceConfigId: race.id },
      orderBy: { stintNumber: 'asc' },
    }),
    prisma.planLap.findMany({
      where: { raceConfigId: race.id },
      orderBy: { lapNumber: 'asc' },
    }),
    prisma.rider.findMany({ orderBy: { displayOrder: 'asc' } }),
  ]);

  const rates: FuelRates = {
    fuelRateDry: race.fuelRateDry,
    fuelRateWet: race.fuelRateWet,
    fuelRateSc: race.fuelRateSc,
    fuelRateOutIn: race.fuelRateOutIn,
  };

  const stintInputs: PlanStintInput[] = stints.map((s) => ({
    stintNumber: s.stintNumber,
    riderId: s.riderId,
    plannedLaps: s.plannedLaps,
    targetLapSec: s.targetLapSec,
    refuelL: s.refuelL,
    note: s.note,
  }));

  // DB の PlanLap（上書き済み値を含む）に燃料推移・累積時間を付与
  const expandedLike = laps.map((l) => ({
    lapNumber: l.lapNumber,
    lapInStint: l.lapInStint,
    stintNumber: stints.find((s) => s.id === l.planStintId)?.stintNumber ?? 0,
    riderId: l.riderId,
    condition: l.condition,
    outIn: (l.outIn as 'OUT' | 'IN' | null) ?? null,
    plannedTimeSec: l.plannedTimeSec,
    isOverride: l.isOverride,
  }));

  const { laps: computed, totals, stintStartFuel } = computePlanState(expandedLike, stintInputs, rates, {
    pitLossSec: race.pitLossSec,
    startFuelL: race.startFuelL,
    tankCapacityL: race.tankCapacityL,
  });

  return {
    race: {
      id: race.id,
      raceName: race.raceName,
      raceDurationMin: race.raceDurationMin,
      tankCapacityL: race.tankCapacityL,
      startFuelL: race.startFuelL,
      pitLossSec: race.pitLossSec,
      maxStintLap: race.maxStintLap,
      assumedLapSec: race.assumedLapSec,
      assumedOutLapSec: race.assumedOutLapSec,
      assumedInLapSec: race.assumedInLapSec,
      assumedWetLapSec: race.assumedWetLapSec,
      assumedScLapSec: race.assumedScLapSec,
    },
    riders,
    stints: stints.map((s) => ({
      id: s.id,
      stintNumber: s.stintNumber,
      riderId: s.riderId,
      plannedLaps: s.plannedLaps,
      targetLapSec: s.targetLapSec,
      refuelL: s.refuelL,
      startFuelL: stintStartFuel[s.stintNumber] ?? null, // 持ち越し計算後の開始燃料
      note: s.note,
    })),
    laps: computed,
    totals: { ...totals, raceDurationSec: race.raceDurationMin * 60 },
    overrideCount: laps.filter((l) => l.isOverride).length,
  };
}

export type PlanState = Awaited<ReturnType<typeof getPlanState>>;

// スティント計画を丸ごと置き換え、周単位計画に再展開して保存する。
// keepOverrides=true なら既存の手動上書き（lapNumber 突き合わせ）を再適用する。
export async function savePlanStints(
  raceConfigId: string,
  inputs: PlanStintInput[],
  keepOverrides: boolean,
) {
  const race = await prisma.raceConfig.findUnique({ where: { id: raceConfigId } });
  if (!race) throw new Error('レース設定が見つかりません');

  // 既存の上書きを退避
  const overrides: PlanLapOverride[] = keepOverrides
    ? (
        await prisma.planLap.findMany({
          where: { raceConfigId, isOverride: true },
        })
      ).map((l) => ({ lapNumber: l.lapNumber, plannedTimeSec: l.plannedTimeSec, condition: l.condition }))
    : [];

  // stintNumber を 1..n に振り直し（並べ替え・削除後の穴を詰める）
  const normalized = [...inputs]
    .sort((a, b) => a.stintNumber - b.stintNumber)
    .map((s, i) => ({ ...s, stintNumber: i + 1 }));

  const expanded = applyOverrides(expandPlan(normalized, race), overrides);

  await prisma.$transaction(async (tx) => {
    await tx.planLap.deleteMany({ where: { raceConfigId } });
    await tx.planStint.deleteMany({ where: { raceConfigId } });

    for (const s of normalized) {
      const created = await tx.planStint.create({
        data: {
          raceConfigId,
          stintNumber: s.stintNumber,
          riderId: s.riderId,
          plannedLaps: s.plannedLaps,
          targetLapSec: s.targetLapSec,
          refuelL: s.refuelL,
          note: s.note ?? null,
        },
      });
      const stintLaps = expanded.filter((l) => l.stintNumber === s.stintNumber);
      if (stintLaps.length > 0) {
        await tx.planLap.createMany({
          data: stintLaps.map((l) => ({
            raceConfigId,
            planStintId: created.id,
            lapNumber: l.lapNumber,
            lapInStint: l.lapInStint,
            riderId: l.riderId,
            condition: l.condition,
            outIn: l.outIn,
            plannedTimeSec: l.plannedTimeSec,
            isOverride: l.isOverride,
          })),
        });
      }
    }
  });
}

// 周単位の上書き（または上書き解除）
export async function overridePlanLap(
  raceConfigId: string,
  lapNumber: number,
  patch: { plannedTimeSec?: number; condition?: string; clear?: boolean },
) {
  const lap = await prisma.planLap.findUnique({
    where: { raceConfigId_lapNumber: { raceConfigId, lapNumber } },
    include: { planStint: true, raceConfig: true },
  });
  if (!lap) throw new Error(`計画ラップ Lap ${lapNumber} が見つかりません`);

  if (patch.clear) {
    // 上書き解除 → スティント目標と想定値から基準タイムを再計算
    const base = basePlannedTime(
      (lap.outIn as 'OUT' | 'IN' | null) ?? null,
      'D',
      lap.planStint.targetLapSec,
      lap.raceConfig,
    );
    return prisma.planLap.update({
      where: { id: lap.id },
      data: { plannedTimeSec: base, condition: 'D', isOverride: false },
    });
  }

  const nextCondition = patch.condition ?? lap.condition;
  // タイム未指定で路面だけ変えた場合は、路面に応じた基準タイムへ差し替える
  const nextTime =
    patch.plannedTimeSec ??
    (patch.condition
      ? basePlannedTime((lap.outIn as 'OUT' | 'IN' | null) ?? null, nextCondition, lap.planStint.targetLapSec, lap.raceConfig)
      : lap.plannedTimeSec);

  return prisma.planLap.update({
    where: { id: lap.id },
    data: { plannedTimeSec: nextTime, condition: nextCondition, isOverride: true },
  });
}
