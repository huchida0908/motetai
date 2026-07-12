// サーバー側でライブ状態（現在のレース/スティント/燃料/ペース）を組み立てる。
// page（サーバー） と /api/live の両方から使う。
import { prisma } from '@/lib/prisma';
import {
  computeStintState,
  recentGreenAverage,
  averageByCondition,
  raceClock,
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

  const [stints, riders, laps] = await Promise.all([
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
      lapsInStint: currentState?.lapsInStint ?? 0,
      fuelRemainingL: currentState?.fuelRemainingL ?? null,
      possibleLaps: currentState?.possibleLaps ?? null,
      recent3Avg: recentGreenAverage(allLapLikes, 3),
      avgDry: averageByCondition(allLapLikes, 'D'),
      avgWet: averageByCondition(allLapLikes, 'W'),
      clock,
    },
    recentLaps,
  };
}

export type LiveState = Awaited<ReturnType<typeof getLiveState>>;
