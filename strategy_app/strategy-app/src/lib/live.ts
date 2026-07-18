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
  scheduleBank,
  type FuelRates,
  type LapLike,
} from '@/lib/race-calc';

export async function getActiveRace() {
  return prisma.raceConfig.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getLiveState(nowMs: number) {
  const race = await getActiveRace();
  if (!race) return { race: null } as const;

  const [stints, riders, laps, planLaps] = await Promise.all([
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
      lapsUntilNextPit,
      projectedTotalLaps: projection?.projectedTotalLaps ?? null,
      remainingPits: projection?.remainingPits ?? null,
      nextPitInSec: projection?.nextPitInSec ?? null,
      bankSec,
      assumedLapSec: race.assumedLapSec,
      planBankSec,
      nextPlannedPitLap: nextPlannedPit?.lapNumber ?? null,
      planTotalLaps: planLaps.length > 0 ? planLaps.length : null,
    },
    series,
    planSeries,
    progress: { plan: planProgress, actual: actualProgress },
    recentLaps,
  };
}

export type LiveState = Awaited<ReturnType<typeof getLiveState>>;
