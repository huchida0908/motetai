// レース計算ロジック（燃料・残量・可能周回数・ペース集計）。
// UI と API の両方から使えるよう、DB 非依存のプレーンな関数として実装する。

export interface FuelRates {
  fuelRateDry: number;
  fuelRateWet: number;
  fuelRateSc: number;
  fuelRateOutIn: number;
}

export interface LapLike {
  id?: string;
  lapNumber: number;
  lapTimeSec: number;
  condition: string; // "D" | "W" | "SC" | "EX1" | "EX2"
  outIn?: string | null; // "OUT" | "IN" | null
  fuelUsedL?: number | null; // 明示指定があれば優先
}

// 1 周の燃料使用量。OUT/IN は専用レート、それ以外は路面レート。
// 明示的な fuelUsedL があればそれを最優先（実測値の手入力に対応）。
export function fuelForLap(lap: LapLike, rates: FuelRates): number {
  if (lap.fuelUsedL != null) return lap.fuelUsedL;
  if (lap.outIn === 'OUT' || lap.outIn === 'IN') return rates.fuelRateOutIn;
  return normalRateForCondition(lap.condition, rates);
}

// 「通常周」1 周あたりの消費（可能周回数の分母に使う）
export function normalRateForCondition(condition: string, rates: FuelRates): number {
  switch (condition) {
    case 'W':
      return rates.fuelRateWet;
    case 'SC':
      return rates.fuelRateSc;
    case 'D':
    case 'EX1':
    case 'EX2':
    default:
      return rates.fuelRateDry;
  }
}

export interface StintState {
  lapsInStint: number;
  fuelRemainingL: number; // スティント内の最新残燃料
  fuelUsedTotalL: number;
  possibleLaps: number; // 現在の残燃料であと何周走れるか
  perLap: Array<LapLike & { fuelUsedL: number; fuelRemainingL: number }>;
}

// スティント（給油〜次の給油）の燃料推移を先頭から順に積算する。
export function computeStintState(
  refuelL: number,
  laps: LapLike[],
  rates: FuelRates,
): StintState {
  const sorted = [...laps].sort((a, b) => a.lapNumber - b.lapNumber);
  let remaining = refuelL;
  let usedTotal = 0;
  const perLap = sorted.map((lap) => {
    const used = fuelForLap(lap, rates);
    remaining -= used;
    usedTotal += used;
    return { ...lap, fuelUsedL: used, fuelRemainingL: remaining };
  });

  // 可能周回数は「直近の路面の通常周消費」を分母にする
  const lastCondition = sorted.length > 0 ? sorted[sorted.length - 1].condition : 'D';
  const denom = normalRateForCondition(lastCondition, rates);
  const possibleLaps = denom > 0 ? remaining / denom : 0;

  return {
    lapsInStint: sorted.length,
    fuelRemainingL: remaining,
    fuelUsedTotalL: usedTotal,
    possibleLaps,
    perLap,
  };
}

// 直近 N 周（OUT/IN・SC を除いた通常周）の平均ラップタイム（秒）。ペース把握用。
export function recentGreenAverage(laps: LapLike[], n = 3): number | null {
  const green = laps
    .filter((l) => !l.outIn && l.condition !== 'SC')
    .sort((a, b) => a.lapNumber - b.lapNumber);
  if (green.length === 0) return null;
  const last = green.slice(-n);
  const sum = last.reduce((acc, l) => acc + l.lapTimeSec, 0);
  return sum / last.length;
}

// 路面別の平均ラップタイム（秒）。OUT/IN は除外。
export function averageByCondition(laps: LapLike[], condition: string): number | null {
  const filtered = laps.filter((l) => l.condition === condition && !l.outIn);
  if (filtered.length === 0) return null;
  const sum = filtered.reduce((acc, l) => acc + l.lapTimeSec, 0);
  return sum / filtered.length;
}

// レース経過・残り時間（秒）。startedAt 未設定なら null。
export function raceClock(
  startedAtIso: string | null | undefined,
  raceDurationMin: number,
  nowMs: number,
): { elapsedSec: number; remainingSec: number } | null {
  if (!startedAtIso) return null;
  const start = new Date(startedAtIso).getTime();
  const elapsedSec = Math.max(0, (nowMs - start) / 1000);
  const remainingSec = raceDurationMin * 60 - elapsedSec;
  return { elapsedSec, remainingSec };
}
