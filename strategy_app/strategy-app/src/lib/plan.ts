// サーバー側で計画状態を組み立てる／スティント計画を保存して周単位に再展開する。
// /api/plan と /plan ページから使う。
import { prisma } from '@/lib/prisma';
import { getActiveRace } from '@/lib/live';
import type { FuelRates } from '@/lib/race-calc';
import {
  expandPlan,
  expandPlanTail,
  applyOverrides,
  computePlanState,
  basePlannedTime,
  type PlanStintInput,
  type PlanLapOverride,
} from '@/lib/plan-calc';

export async function getPlanState() {
  const race = await getActiveRace();
  if (!race) return { race: null } as const;

  const [stints, laps, riders, actualAgg] = await Promise.all([
    prisma.planStint.findMany({
      where: { raceConfigId: race.id },
      orderBy: { stintNumber: 'asc' },
    }),
    prisma.planLap.findMany({
      where: { raceConfigId: race.id },
      orderBy: { lapNumber: 'asc' },
    }),
    prisma.rider.findMany({ orderBy: { displayOrder: 'asc' } }),
    prisma.actualLap.aggregate({
      where: { raceConfigId: race.id },
      _max: { lapNumber: true },
    }),
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
    tireChange: s.tireChange,
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

  // レース進行状況（レース中の計画変更で消化済み周を凍結するための境界情報）
  const maxActualLap = actualAgg._max.lapNumber ?? 0;
  const planLen = laps.length > 0 ? laps[laps.length - 1].lapNumber : 0;
  const frozenUpTo = Math.min(maxActualLap, planLen);
  let boundaryStintNumber: number | null = null;
  let frozenLapsInBoundary: number | null = null;
  if (frozenUpTo > 0) {
    const lastFrozen = [...laps].filter((l) => l.lapNumber <= frozenUpTo).pop()!;
    boundaryStintNumber = stints.find((s) => s.id === lastFrozen.planStintId)?.stintNumber ?? null;
    frozenLapsInBoundary = lastFrozen.lapInStint;
  }

  return {
    progress: {
      maxActualLap,
      raceStarted: race.startedAt != null,
      frozenUpTo,
      boundaryStintNumber,
      frozenLapsInBoundary,
    },
    race: {
      id: race.id,
      raceName: race.raceName,
      raceDurationMin: race.raceDurationMin,
      startedAt: race.startedAt?.toISOString() ?? null,
      tankCapacityL: race.tankCapacityL,
      startFuelL: race.startFuelL,
      pitLossSec: race.pitLossSec,
      maxStintLap: race.maxStintLap,
      fuelRateDry: race.fuelRateDry,
      fuelRateWet: race.fuelRateWet,
      fuelRateSc: race.fuelRateSc,
      fuelRateOutIn: race.fuelRateOutIn,
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
      tireChange: s.tireChange,
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
// freezeCompleted=true（レース中の保存）なら、消化済み周（実績最大 lapNumber 以下）の
// PlanLap は物理的に残し、それ以降だけを新しいスティント構成で再展開する。
export async function savePlanStints(
  raceConfigId: string,
  inputs: PlanStintInput[],
  keepOverrides: boolean,
  freezeCompleted = false,
) {
  const race = await prisma.raceConfig.findUnique({ where: { id: raceConfigId } });
  if (!race) throw new Error('レース設定が見つかりません');

  // stintNumber を 1..n に振り直し（並べ替え・削除後の穴を詰める）
  const normalized = [...inputs]
    .sort((a, b) => a.stintNumber - b.stintNumber)
    .map((s, i) => ({ ...s, stintNumber: i + 1 }));

  if (freezeCompleted) {
    const done = await savePlanStintsFrozen(raceConfigId, race, normalized, keepOverrides);
    if (done) return;
    // 実績 0 周 or 計画なし → 従来の全置換へフォールバック
  }

  // 既存の上書きを退避（走者はスティントの担当と異なる周だけ retain し、
  // 「タイムだけ上書きした周」の走者を誤って固定しないようにする）
  const overrides: PlanLapOverride[] = keepOverrides
    ? (
        await prisma.planLap.findMany({
          where: { raceConfigId, isOverride: true },
          include: { planStint: true },
        })
      ).map((l) => ({
        lapNumber: l.lapNumber,
        plannedTimeSec: l.plannedTimeSec,
        condition: l.condition,
        riderId: l.riderId !== l.planStint.riderId ? l.riderId : undefined,
      }))
    : [];

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
          tireChange: s.tireChange ?? false,
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

// レース中、実績スティントの周回数に合わせて計画スティントを再アンカーする（方式B: 計画データを修正し続ける）。
// - 完了した実績スティント（endedAt != null）に対応する計画スティントは plannedLaps を「実走周回数」に置換。
// - 走行中＋未来の計画スティントは長さ・走者・給油を保ったまま、周回番号だけ前後にずれる（早く交代=前倒し / 遅い=ところてん後ろ倒し）。
// 実績スティント番号 = 計画スティント番号で対応づける。変化が無ければ何もしない。
// ※ ピット記録経路（POST /api/stints・scrape/commit）から呼ぶ。失敗しても呼び出し側で握りつぶし、記録処理自体は止めない。
export async function realignPlanToActual(raceConfigId: string): Promise<boolean> {
  const [planStints, actualStints, lapCounts] = await Promise.all([
    prisma.planStint.findMany({ where: { raceConfigId }, orderBy: { stintNumber: 'asc' } }),
    prisma.stint.findMany({ where: { raceConfigId }, orderBy: { stintNumber: 'asc' } }),
    prisma.actualLap.groupBy({ by: ['stintId'], where: { raceConfigId }, _count: { _all: true } }),
  ]);
  if (planStints.length === 0 || actualStints.length === 0) return false;

  const countByStintId = new Map(lapCounts.map((c) => [c.stintId, c._count._all]));
  // 完了した実績スティント stintNumber → 実走周回数（0周は据え置き扱いで除外）
  const actualDoneLaps = new Map<number, number>();
  for (const s of actualStints) {
    if (s.endedAt != null) {
      const n = s.id ? countByStintId.get(s.id) ?? 0 : 0;
      if (n > 0) actualDoneLaps.set(s.stintNumber, n);
    }
  }
  if (actualDoneLaps.size === 0) return false;

  // 完了実績のある計画スティントだけ plannedLaps を実走数へ。他は据え置き。
  let changed = false;
  const inputs: PlanStintInput[] = planStints.map((s) => {
    const actual = actualDoneLaps.get(s.stintNumber);
    if (actual != null && actual !== s.plannedLaps) changed = true;
    return {
      stintNumber: s.stintNumber,
      riderId: s.riderId,
      plannedLaps: actual != null ? actual : s.plannedLaps,
      targetLapSec: s.targetLapSec,
      refuelL: s.refuelL,
      tireChange: s.tireChange,
      note: s.note,
    };
  });
  if (!changed) return false; // 計画どおり → 書き換え不要

  await savePlanStints(raceConfigId, inputs, /* keepOverrides */ true, /* freezeCompleted */ false);
  return true;
}

// ユーザー入力起因の計画エラー（API は 400 で返す）
export class PlanInputError extends Error {}

// レース中の保存: 消化済み周を凍結し、境界スティントの続き＋以降のスティントだけ再展開する。
// 凍結境界 frozenUpTo = min(実績最大 lapNumber, 計画最終 lapNumber)。
// 凍結できるものが無い場合は false を返し、呼び出し元が従来の全置換にフォールバックする。
async function savePlanStintsFrozen(
  raceConfigId: string,
  race: NonNullable<Awaited<ReturnType<typeof prisma.raceConfig.findUnique>>>,
  normalized: PlanStintInput[],
  keepOverrides: boolean,
): Promise<boolean> {
  const [existingStints, existingLaps, actualAgg] = await Promise.all([
    prisma.planStint.findMany({ where: { raceConfigId }, orderBy: { stintNumber: 'asc' } }),
    prisma.planLap.findMany({ where: { raceConfigId }, orderBy: { lapNumber: 'asc' } }),
    prisma.actualLap.aggregate({ where: { raceConfigId }, _max: { lapNumber: true } }),
  ]);

  const maxActual = actualAgg._max.lapNumber ?? 0;
  const planLen = existingLaps.length > 0 ? existingLaps[existingLaps.length - 1].lapNumber : 0;
  const frozenUpTo = Math.min(maxActual, planLen);
  if (frozenUpTo === 0) return false;

  const lastFrozen = [...existingLaps].filter((l) => l.lapNumber <= frozenUpTo).pop()!;
  const boundaryStintRow = existingStints.find((s) => s.id === lastFrozen.planStintId);
  if (!boundaryStintRow) throw new Error('計画データが不整合です（凍結境界のスティントが見つかりません）');
  const boundaryNo = boundaryStintRow.stintNumber;

  if (normalized.length < boundaryNo) {
    throw new PlanInputError(`消化済みスティント（ST${boundaryNo} まで）は削除できません`);
  }

  // 境界スティントが消化しきっているか（実績が計画を超過した場合も継続なし扱い）
  const boundaryFullyDone =
    maxActual > planLen || lastFrozen.lapInStint >= boundaryStintRow.plannedLaps;

  // 境界スティントへの入力反映: 周回数は走行済み周数未満に縮められない
  const boundaryInput = normalized[boundaryNo - 1];
  const boundaryTotalLaps = boundaryFullyDone
    ? boundaryStintRow.plannedLaps
    : Math.max(boundaryInput.plannedLaps, lastFrozen.lapInStint);

  const futureStints = normalized
    .slice(boundaryNo)
    .map((s, i) => ({ ...s, stintNumber: boundaryNo + 1 + i }));

  const tail = expandPlanTail({
    startLapNumber: Math.max(maxActual, frozenUpTo),
    boundary: boundaryFullyDone
      ? null
      : {
          stintNumber: boundaryNo,
          riderId: boundaryStintRow.riderId,
          targetLapSec: boundaryInput.targetLapSec,
          doneLapsInStint: lastFrozen.lapInStint,
          totalLaps: boundaryTotalLaps,
        },
    futureStints,
    assumed: race,
  });

  // 凍結周の上書きは行ごと残るので対象外。tail 側の上書きのみ再適用
  // 走者はスティントの担当と異なる周だけ retain（タイムだけの上書き周を誤固定しない）
  const stintRiderById = new Map(existingStints.map((s) => [s.id, s.riderId]));
  const overrides: PlanLapOverride[] = keepOverrides
    ? existingLaps
        .filter((l) => l.isOverride && l.lapNumber > frozenUpTo)
        .map((l) => ({
          lapNumber: l.lapNumber,
          plannedTimeSec: l.plannedTimeSec,
          condition: l.condition,
          riderId: l.riderId !== stintRiderById.get(l.planStintId) ? l.riderId : undefined,
        }))
    : [];
  const tailWithOv = applyOverrides(tail, overrides);

  const lapRow = (l: (typeof tailWithOv)[number], planStintId: string) => ({
    raceConfigId,
    planStintId,
    lapNumber: l.lapNumber,
    lapInStint: l.lapInStint,
    riderId: l.riderId,
    condition: l.condition,
    outIn: l.outIn,
    plannedTimeSec: l.plannedTimeSec,
    isOverride: l.isOverride,
  });

  await prisma.$transaction(async (tx) => {
    await tx.planLap.deleteMany({ where: { raceConfigId, lapNumber: { gt: frozenUpTo } } });
    await tx.planStint.deleteMany({ where: { raceConfigId, stintNumber: { gt: boundaryNo } } });

    // 境界スティント: 周回数と目標ラップのみ反映（担当・給油量は給油済みのため据え置き）
    await tx.planStint.update({
      where: { id: boundaryStintRow.id },
      data: { plannedLaps: boundaryTotalLaps, targetLapSec: boundaryInput.targetLapSec },
    });
    const boundaryLaps = tailWithOv.filter((l) => l.stintNumber === boundaryNo);
    if (boundaryLaps.length > 0) {
      await tx.planLap.createMany({ data: boundaryLaps.map((l) => lapRow(l, boundaryStintRow.id)) });
    }

    for (const s of futureStints) {
      const created = await tx.planStint.create({
        data: {
          raceConfigId,
          stintNumber: s.stintNumber,
          riderId: s.riderId,
          plannedLaps: s.plannedLaps,
          targetLapSec: s.targetLapSec,
          refuelL: s.refuelL,
          tireChange: s.tireChange ?? false,
          note: s.note ?? null,
        },
      });
      const stintLaps = tailWithOv.filter((l) => l.stintNumber === s.stintNumber);
      if (stintLaps.length > 0) {
        await tx.planLap.createMany({ data: stintLaps.map((l) => lapRow(l, created.id)) });
      }
    }
  });

  return true;
}

// 周単位の上書き（または上書き解除）
export async function overridePlanLap(
  raceConfigId: string,
  lapNumber: number,
  patch: { plannedTimeSec?: number; condition?: string; riderId?: string | null; clear?: boolean },
) {
  const lap = await prisma.planLap.findUnique({
    where: { raceConfigId_lapNumber: { raceConfigId, lapNumber } },
    include: { planStint: true, raceConfig: true },
  });
  if (!lap) throw new Error(`計画ラップ Lap ${lapNumber} が見つかりません`);

  if (patch.clear) {
    // 上書き解除 → スティント目標と想定値から基準タイムを再計算。走者もスティントの担当へ戻す
    const base = basePlannedTime(
      (lap.outIn as 'OUT' | 'IN' | null) ?? null,
      'D',
      lap.planStint.targetLapSec,
      lap.raceConfig,
    );
    return prisma.planLap.update({
      where: { id: lap.id },
      data: { plannedTimeSec: base, condition: 'D', riderId: lap.planStint.riderId, isOverride: false },
    });
  }

  const nextCondition = patch.condition ?? lap.condition;
  // タイム未指定で路面だけ変えた場合は、路面に応じた基準タイムへ差し替える
  const nextTime =
    patch.plannedTimeSec ??
    (patch.condition
      ? basePlannedTime((lap.outIn as 'OUT' | 'IN' | null) ?? null, nextCondition, lap.planStint.targetLapSec, lap.raceConfig)
      : lap.plannedTimeSec);
  // 走者は指定があれば差し替え（null=未定へ）。未指定なら据え置き
  const nextRider = patch.riderId !== undefined ? patch.riderId : lap.riderId;

  return prisma.planLap.update({
    where: { id: lap.id },
    data: { plannedTimeSec: nextTime, condition: nextCondition, riderId: nextRider, isOverride: true },
  });
}

// 周単位の走者上書きを「スティント構成」へ反映する。
// あるスティントの全周の riderId が一致したら、PlanStint.riderId をその走者へ合わせる。
// （1スティント=1走者しか表せないため、走者が混在するスティントは据え置き。走行済みスティントの
//  担当を per-lap で丸ごと変えたときに構成表・次走者表示へ伝播させるのが狙い。）
// 更新があったら true を返す。
export async function syncStintRidersFromLaps(raceConfigId: string): Promise<boolean> {
  const [stints, laps] = await Promise.all([
    prisma.planStint.findMany({ where: { raceConfigId } }),
    prisma.planLap.findMany({ where: { raceConfigId }, select: { planStintId: true, riderId: true } }),
  ]);
  let changed = false;
  for (const s of stints) {
    const rs = laps.filter((l) => l.planStintId === s.id).map((l) => l.riderId);
    if (rs.length === 0) continue;
    const uniform = rs.every((r) => r === rs[0]); // 全周が同一走者か（null 一致も含む）
    if (uniform && rs[0] !== s.riderId) {
      await prisma.planStint.update({ where: { id: s.id }, data: { riderId: rs[0] } });
      changed = true;
    }
  }
  return changed;
}
