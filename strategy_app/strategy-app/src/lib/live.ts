// サーバー側でライブ状態（現在のレース/スティント/燃料/ペース）を組み立てる。
// page（サーバー） と /api/live の両方から使う。
import { prisma } from '@/lib/prisma';
import {
  computeStintState,
  recentGreenAverage,
  averageByCondition,
  normalRateForCondition,
  raceClock,
  projectRace,
  projectRaceByPlan,
  scheduleBank,
  type FuelRates,
  type LapLike,
} from '@/lib/race-calc';
import { computePlanState, type PlanStintInput } from '@/lib/plan-calc';

export async function getActiveRace() {
  return prisma.raceConfig.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getLiveState(nowMs: number) {
  const race = await getActiveRace();
  if (!race) return { race: null } as const;

  const [stints, riders, laps, planLaps, planStints] = await Promise.all([
    prisma.stint.findMany({
      where: { raceConfigId: race.id },
      orderBy: { stintNumber: 'asc' },
      include: { rider: true },
    }),
    prisma.rider.findMany({ orderBy: { displayOrder: 'asc' } }),
    prisma.actualLap.findMany({
      where: { raceConfigId: race.id },
      orderBy: { lapNumber: 'asc' },
    }),
    prisma.planLap.findMany({
      where: { raceConfigId: race.id },
      orderBy: { lapNumber: 'asc' },
    }),
    prisma.planStint.findMany({
      where: { raceConfigId: race.id },
      orderBy: { stintNumber: 'asc' },
    }),
  ]);

  const rates: FuelRates = {
    fuelRateDry: race.fuelRateDry,
    fuelRateWet: race.fuelRateWet,
    fuelRateSc: race.fuelRateSc,
    fuelRateOutIn: race.fuelRateOutIn,
  };

  // 各スティントの燃料推移を計算し、lapId -> 燃料情報 のマップを作る
  const fuelByLapId = new Map<string, { fuelUsedL: number; fuelRemainingL: number }>();
  for (const stint of stints) {
    const stintLaps = laps.filter((l) => l.stintId === stint.id) as unknown as LapLike[];
    const state = computeStintState(stint.refuelL, stintLaps, rates);
    for (const pl of state.perLap) {
      if (pl.id) fuelByLapId.set(pl.id, { fuelUsedL: pl.fuelUsedL, fuelRemainingL: pl.fuelRemainingL });
    }
  }

  // 現在のスティント = 未終了のうち最後、無ければ最後のスティント
  const openStints = stints.filter((s) => s.endedAt == null);
  const currentStint = openStints.length > 0 ? openStints[openStints.length - 1] : stints[stints.length - 1] ?? null;

  // 次スティント（現在の番号 +1）の計画上のライダー。ピット時のデフォルト走者に使う
  const nextStintNumber = (currentStint?.stintNumber ?? 0) + 1;
  const nextPlannedRiderId = planStints.find((s) => s.stintNumber === nextStintNumber)?.riderId ?? null;

  let currentState = null as ReturnType<typeof computeStintState> | null;
  if (currentStint) {
    const stintLaps = laps.filter((l) => l.stintId === currentStint.id) as unknown as LapLike[];
    currentState = computeStintState(currentStint.refuelL, stintLaps, rates);
  }

  const allLapLikes = laps as unknown as LapLike[];
  const clock = raceClock(race.startedAt?.toISOString() ?? null, race.raceDurationMin, nowMs);

  // ペース: 直近3周 → ドライ平均 → 想定値 の順でフォールバック
  const recent3 = recentGreenAverage(allLapLikes, 3);
  const avgLapSec = recent3 ?? averageByCondition(allLapLikes, 'D') ?? race.assumedLapSec;

  // 次ピットまで / スティント容量（燃料 or 上限の小さい方）
  const lastCondition = laps.length > 0 ? laps[laps.length - 1].condition : 'D';
  const normalRate = normalRateForCondition(lastCondition, rates);
  const stintLapsFull = Math.min(race.maxStintLap, Math.floor(race.tankCapacityL / (normalRate || 0.35)));
  const possibleLaps = currentState?.possibleLaps ?? 0;
  const lapsInStint = currentState?.lapsInStint ?? 0;
  const lapsUntilNextPit = Math.max(0, Math.min(Math.floor(possibleLaps), race.maxStintLap - lapsInStint));

  const projection = clock
    ? projectRace({
        remainingSec: clock.remainingSec,
        avgLapSec,
        totalLaps: laps.length,
        lapsUntilNextPit,
        stintLaps: stintLapsFull,
        pitLossSec: race.pitLossSec,
      })
    : null;

  const bankSec = scheduleBank(allLapLikes, race.assumedLapSec);

  // 周単位計画との突き合わせ（計画がある場合のみ）
  const planByLap = new Map(planLaps.map((p) => [p.lapNumber, p]));
  let planBankSec: number | null = null;
  if (planLaps.length > 0 && laps.length > 0) {
    // Σ(計画 − 実績)。＋=計画より速い（貯金）/ −=遅い（借金）
    planBankSec = laps.reduce((acc, l) => {
      const p = planByLap.get(l.lapNumber);
      return p ? acc + (p.plannedTimeSec - l.lapTimeSec) : acc;
    }, 0);
  }
  const nextPlannedPit = planLaps.find((p) => p.outIn === 'IN' && p.lapNumber > laps.length) ?? null;
  // 次の計画ピットでタイヤ交換するか = そのピット明けに始まるスティント（IN 周の次スティント）のフラグ
  let nextPitTireChange: boolean | null = null;
  if (nextPlannedPit) {
    const inStintNo = planStints.find((s) => s.id === nextPlannedPit.planStintId)?.stintNumber;
    const nextStint = inStintNo != null ? planStints.find((s) => s.stintNumber === inStintNo + 1) : undefined;
    nextPitTireChange = nextStint?.tireChange ?? null;
  }

  // ── Pit Window（次ピットまで/残ピット/着地予測）───────────────────────
  // 周単位計画がある場合は、汎用の燃料/maxStintLap モデルではなく計画から算出する。
  // （maxStintLap は「燃料と無関係の安全上限」で、可変スティントの計画とは別概念のため
  //  計画がある局面ではこちらを正とする。計画が無い場合のみ従来の projectRace を使う。）
  const hasPlanLaps = planLaps.length > 0;
  // 次ピットまで = 次の計画 IN 周 − 通算周回（IN が無い＝以降ピット無しなら null）
  const planLapsUntilNextPit = nextPlannedPit ? Math.max(0, nextPlannedPit.lapNumber - laps.length) : null;
  // 残ピット回数 = 通算周回より先にある計画 IN 周の数
  const plannedRemainingPits = hasPlanLaps
    ? planLaps.filter((p) => p.outIn === 'IN' && p.lapNumber > laps.length).length
    : null;
  // 着地予測 / 次ピットまでの所要時間 = 計画のスティント割りを残り時間ぶん前方シミュレート
  const planProjection =
    hasPlanLaps && clock
      ? projectRaceByPlan({
          remainingSec: clock.remainingSec,
          totalLaps: laps.length,
          planLaps: planLaps.map((p) => ({
            lapNumber: p.lapNumber,
            planStintId: p.planStintId,
            outIn: p.outIn ?? null,
            condition: p.condition,
            plannedTimeSec: p.plannedTimeSec,
          })),
          greenPaceSec: recent3,
          pitLossSec: race.pitLossSec,
        })
      : null;

  // 次ピットまでの残り時間（秒）と、その絶対時刻（epoch ms）。
  // clock（= nowMs 起点の残り時間）に残り時間を足して「次ピットが起きる実時刻」を求める。
  // 実クロック・実績周回・実ペースで前方シミュレートした値なので実績に追従する。
  // 表示側（クライアント）でローカルTZの H:MM に整形する。
  const nextPitInSec = hasPlanLaps ? planProjection?.nextPitInSec ?? null : projection?.nextPitInSec ?? null;
  const nextPitClockMs = nextPitInSec != null ? Math.round(nowMs + nextPitInSec * 1000) : null;

  // チャート用の系列（計画 vs 実績）
  const series = laps.map((l) => ({
    lap: l.lapNumber,
    timeSec: l.lapTimeSec,
    condition: l.condition,
    outIn: l.outIn ?? null,
    riderId: l.riderId,
  }));
  const planSeries = planLaps.map((p) => ({
    lap: p.lapNumber,
    timeSec: p.plannedTimeSec,
    outIn: p.outIn ?? null,
  }));

  // 周回数推移（横軸=経過秒、縦軸=通算周回）用の系列。
  // 計画: Σ計画ラップ + スティント境界ごとの想定ピットロス（計画累積時間と同じ定義）
  let planCum = 0;
  let prevPlanStintId: string | undefined;
  const planProgress = planLaps.map((p) => {
    if (prevPlanStintId !== undefined && p.planStintId !== prevPlanStintId) planCum += race.pitLossSec;
    prevPlanStintId = p.planStintId;
    planCum += p.plannedTimeSec;
    return { t: planCum, laps: p.lapNumber };
  });
  // 実績: レース開始済みなら記録時刻 − 開始時刻（実経過。実際のピット所要も反映される）。
  // 未開始（事前入力など）は計画と同じ「Σラップ + 想定ピットロス」で概算。
  const startMs = race.startedAt?.getTime() ?? null;
  let actualCum = 0;
  let prevStintId: string | null | undefined;
  const actualProgress = laps.map((l) => {
    if (prevStintId !== undefined && l.stintId !== prevStintId) actualCum += race.pitLossSec;
    prevStintId = l.stintId;
    actualCum += l.lapTimeSec;
    const t = startMs != null ? (l.timestamp.getTime() - startMs) / 1000 : actualCum;
    return { t: Math.max(0, t), laps: l.lapNumber };
  });

  // 燃料推移チャート用の系列（計画=持ち越しモデルで再計算、実績=スティント燃料推移を流用）
  let fuelPlan: Array<{ lap: number; fuelL: number }> = [];
  if (planLaps.length > 0 && planStints.length > 0) {
    const stintInputs: PlanStintInput[] = planStints.map((s) => ({
      stintNumber: s.stintNumber,
      riderId: s.riderId,
      plannedLaps: s.plannedLaps,
      targetLapSec: s.targetLapSec,
      refuelL: s.refuelL,
    }));
    const stintNoById = new Map(planStints.map((s) => [s.id, s.stintNumber]));
    const expandedLike = planLaps.map((l) => ({
      lapNumber: l.lapNumber,
      lapInStint: l.lapInStint,
      stintNumber: stintNoById.get(l.planStintId) ?? 0,
      riderId: l.riderId,
      condition: l.condition,
      outIn: (l.outIn as 'OUT' | 'IN' | null) ?? null,
      plannedTimeSec: l.plannedTimeSec,
      isOverride: l.isOverride,
    }));
    const { laps: planComputed } = computePlanState(expandedLike, stintInputs, rates, {
      pitLossSec: race.pitLossSec,
      startFuelL: race.startFuelL,
      tankCapacityL: race.tankCapacityL,
    });
    fuelPlan = planComputed.map((l) => ({ lap: l.lapNumber, fuelL: l.fuelRemainingL }));
  }
  const fuelActual = laps.flatMap((l) => {
    const f = l.id ? fuelByLapId.get(l.id) : null;
    return f ? [{ lap: l.lapNumber, fuelL: f.fuelRemainingL }] : [];
  });

  // 直近ラップ一覧（最大 20 件）に燃料情報を付与
  const recentLaps = laps
    .slice(-20)
    .reverse()
    .map((l) => ({
      ...l,
      timestamp: l.timestamp.toISOString(),
      createdAt: l.createdAt.toISOString(),
      fuel: l.id ? fuelByLapId.get(l.id) ?? null : null,
    }));

  return {
    race: {
      ...race,
      startedAt: race.startedAt?.toISOString() ?? null,
      createdAt: race.createdAt.toISOString(),
      updatedAt: race.updatedAt.toISOString(),
    },
    riders,
    nextPlannedRiderId,
    currentStint: currentStint
      ? {
          ...currentStint,
          startedAt: currentStint.startedAt?.toISOString() ?? null,
          endedAt: currentStint.endedAt?.toISOString() ?? null,
          createdAt: currentStint.createdAt.toISOString(),
          updatedAt: currentStint.updatedAt.toISOString(),
        }
      : null,
    tiles: {
      totalLaps: laps.length,
      lapsInStint,
      fuelRemainingL: currentState?.fuelRemainingL ?? null,
      possibleLaps: currentState?.possibleLaps ?? null,
      recent3Avg: recent3,
      avgLapSec,
      avgDry: averageByCondition(allLapLikes, 'D'),
      avgWet: averageByCondition(allLapLikes, 'W'),
      clock,
      // 計画がある場合は計画準拠、無い場合は従来の燃料/maxStintLap モデル
      lapsUntilNextPit: hasPlanLaps ? planLapsUntilNextPit ?? 0 : lapsUntilNextPit,
      projectedTotalLaps: hasPlanLaps
        ? planProjection?.projectedTotalLaps ?? null
        : projection?.projectedTotalLaps ?? null,
      remainingPits: hasPlanLaps ? plannedRemainingPits : projection?.remainingPits ?? null,
      nextPitInSec,
      nextPitClockMs,
      bankSec,
      assumedLapSec: race.assumedLapSec,
      planBankSec,
      nextPlannedPitLap: nextPlannedPit?.lapNumber ?? null,
      nextPitTireChange,
      planTotalLaps: planLaps.length > 0 ? planLaps.length : null,
    },
    series,
    planSeries,
    progress: { plan: planProgress, actual: actualProgress },
    fuelSeries: {
      plan: fuelPlan,
      actual: fuelActual,
      startFuelL: race.startFuelL,
      tankCapacityL: race.tankCapacityL,
    },
    recentLaps,
  };
}

export type LiveState = Awaited<ReturnType<typeof getLiveState>>;
