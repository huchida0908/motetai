// 計画（周単位）の展開・自動生成ロジック。
// race-calc.ts と同様、UI と API の両方から使えるよう DB 非依存の純関数として実装する。
import { fuelForLap, type FuelRates } from '@/lib/race-calc';

// スティント計画の編集単位（PlanStint モデルに対応）
export interface PlanStintInput {
  stintNumber: number;
  riderId: string | null;
  plannedLaps: number;
  targetLapSec: number | null; // null → 想定 Lap を使用
  refuelL: number; // ピットでの給油量（追加L）。スティント1では未使用
  note?: string | null;
}

export interface AssumedTimes {
  assumedLapSec: number;
  assumedOutLapSec: number;
  assumedInLapSec: number;
  assumedWetLapSec: number;
  assumedScLapSec: number;
}

// 展開された 1 周ぶんの計画行
export interface ExpandedPlanLap {
  lapNumber: number; // レース通算
  lapInStint: number; // スティント内 1 始まり
  stintNumber: number;
  riderId: string | null;
  condition: string; // "D" | "W" | "SC"
  outIn: 'OUT' | 'IN' | null;
  plannedTimeSec: number;
}

// 周単位の手動上書き（PlanLap.isOverride=true の行）
export interface PlanLapOverride {
  lapNumber: number;
  plannedTimeSec?: number;
  condition?: string;
}

// 計画ラップ 1 周の基準タイム。
// OUT/IN はスティント境界の想定値、通常周は「スティント目標 → 想定 Lap」の順。
// 路面がウェット/SC の周は路面側の想定を優先する（目標ラップはドライ前提のため）。
export function basePlannedTime(
  outIn: 'OUT' | 'IN' | null,
  condition: string,
  targetLapSec: number | null,
  assumed: AssumedTimes,
): number {
  if (outIn === 'OUT') return assumed.assumedOutLapSec;
  if (outIn === 'IN') return assumed.assumedInLapSec;
  if (condition === 'W') return assumed.assumedWetLapSec;
  if (condition === 'SC') return assumed.assumedScLapSec;
  return targetLapSec ?? assumed.assumedLapSec;
}

// スティント計画 → 周単位計画に展開する。
// - スティント 2 本目以降の先頭周 = OUT（ピットアウト）
// - 最終スティント以外の最終周 = IN（ピットイン）
export function expandPlan(stints: PlanStintInput[], assumed: AssumedTimes): ExpandedPlanLap[] {
  const sorted = [...stints].sort((a, b) => a.stintNumber - b.stintNumber);
  const laps: ExpandedPlanLap[] = [];
  let lapNumber = 0;

  sorted.forEach((stint, idx) => {
    const isFirstStint = idx === 0;
    const isLastStint = idx === sorted.length - 1;
    for (let i = 1; i <= stint.plannedLaps; i++) {
      lapNumber += 1;
      const outIn: 'OUT' | 'IN' | null =
        !isFirstStint && i === 1 ? 'OUT' : !isLastStint && i === stint.plannedLaps ? 'IN' : null;
      laps.push({
        lapNumber,
        lapInStint: i,
        stintNumber: stint.stintNumber,
        riderId: stint.riderId,
        condition: 'D',
        outIn,
        plannedTimeSec: basePlannedTime(outIn, 'D', stint.targetLapSec, assumed),
      });
    }
  });

  return laps;
}

// レース中の再展開用: 凍結境界より後だけを展開する。
// - boundary = 走行中スティントの続き（消化済み lapInStint の次から totalLaps まで）
// - futureStints = 境界より後の新スティント（先頭 OUT / 最終以外の末尾 IN）
// lapNumber は startLapNumber+1 から通しで採番する。
export interface TailBoundary {
  stintNumber: number;
  riderId: string | null;
  targetLapSec: number | null;
  doneLapsInStint: number; // 凍結済みのスティント内周数
  totalLaps: number; // クランプ後の予定周回数
}

export function expandPlanTail(params: {
  startLapNumber: number; // 最後の凍結（または実績）周。新規周はこの次から
  boundary: TailBoundary | null; // null = 走行中スティントの続きなし
  futureStints: PlanStintInput[];
  assumed: AssumedTimes;
}): ExpandedPlanLap[] {
  const { startLapNumber, boundary, assumed } = params;
  const futureStints = [...params.futureStints].sort((a, b) => a.stintNumber - b.stintNumber);
  const laps: ExpandedPlanLap[] = [];
  let lapNumber = startLapNumber;

  if (boundary) {
    const isLast = futureStints.length === 0;
    for (let i = boundary.doneLapsInStint + 1; i <= boundary.totalLaps; i++) {
      lapNumber += 1;
      const outIn: 'OUT' | 'IN' | null = !isLast && i === boundary.totalLaps ? 'IN' : null;
      laps.push({
        lapNumber,
        lapInStint: i,
        stintNumber: boundary.stintNumber,
        riderId: boundary.riderId,
        condition: 'D',
        outIn,
        plannedTimeSec: basePlannedTime(outIn, 'D', boundary.targetLapSec, assumed),
      });
    }
  }

  futureStints.forEach((stint, idx) => {
    const isLast = idx === futureStints.length - 1;
    for (let i = 1; i <= stint.plannedLaps; i++) {
      lapNumber += 1;
      const outIn: 'OUT' | 'IN' | null =
        i === 1 ? 'OUT' : !isLast && i === stint.plannedLaps ? 'IN' : null;
      laps.push({
        lapNumber,
        lapInStint: i,
        stintNumber: stint.stintNumber,
        riderId: stint.riderId,
        condition: 'D',
        outIn,
        plannedTimeSec: basePlannedTime(outIn, 'D', stint.targetLapSec, assumed),
      });
    }
  });

  return laps;
}

// 展開済み計画に周単位の上書きを適用する（lapNumber で突き合わせ）
export function applyOverrides(
  laps: ExpandedPlanLap[],
  overrides: PlanLapOverride[],
): Array<ExpandedPlanLap & { isOverride: boolean }> {
  const byLap = new Map(overrides.map((o) => [o.lapNumber, o]));
  return laps.map((lap) => {
    const o = byLap.get(lap.lapNumber);
    if (!o) return { ...lap, isOverride: false };
    return {
      ...lap,
      condition: o.condition ?? lap.condition,
      plannedTimeSec: o.plannedTimeSec ?? lap.plannedTimeSec,
      isOverride: true,
    };
  });
}

export interface PlanLapComputed extends ExpandedPlanLap {
  isOverride: boolean;
  fuelUsedL: number;
  fuelRemainingL: number;
  cumTimeSec: number; // レース開始からの累積時間（ピットロス込み）
}

export interface PlanTotals {
  totalLaps: number;
  totalTimeSec: number; // 全計画消化時の累積時間（ピットロス込み）
  pitCount: number;
  fuelShortStints: number[]; // 燃料がマイナスになるスティント番号
}

export interface FuelPlanOptions {
  pitLossSec: number;
  startFuelL: number; // スタート時の搭載燃料（スティント1の開始燃料）
  tankCapacityL: number; // 給油後の上限（キャップ）
}

// 展開済み計画に燃料推移・累積時間を付与する。
// 累積時間 = Σ計画ラップ + スティント境界ごとの想定ピットロス。
// （Excel 同様、IN ラップのタイムはピット入口まで。停止時間は pitLossSec で別途加算）
// 燃料は持ち越しモデル: スティント1 = スタート燃料、以降のピットで
// 「残燃料 + 給油量（refuelL）」をタンク容量でキャップした値から再スタートする。
export function computePlanState(
  laps: Array<ExpandedPlanLap & { isOverride: boolean }>,
  stints: PlanStintInput[],
  rates: FuelRates,
  opts: FuelPlanOptions,
): { laps: PlanLapComputed[]; totals: PlanTotals; stintStartFuel: Record<number, number> } {
  const refuelByStint = new Map(stints.map((s) => [s.stintNumber, s.refuelL]));
  const sorted = [...laps].sort((a, b) => a.lapNumber - b.lapNumber);

  let cumTime = 0;
  let remaining = 0;
  let currentStint = -1;
  let pitCount = 0;
  const fuelShort = new Set<number>();
  const stintStartFuel: Record<number, number> = {};

  const computed = sorted.map((lap) => {
    if (lap.stintNumber !== currentStint) {
      // スティント切り替わり
      if (currentStint === -1) {
        // スティント1: スタート燃料
        remaining = opts.startFuelL;
      } else {
        // ピットイン: ピットロスを加算し、残燃料に給油量を補充（タンク容量でキャップ）
        cumTime += opts.pitLossSec;
        pitCount += 1;
        const refuel = refuelByStint.get(lap.stintNumber) ?? 0;
        remaining = Math.min(remaining + refuel, opts.tankCapacityL);
      }
      currentStint = lap.stintNumber;
      stintStartFuel[lap.stintNumber] = remaining;
    }
    const used = fuelForLap({ lapNumber: lap.lapNumber, lapTimeSec: lap.plannedTimeSec, condition: lap.condition, outIn: lap.outIn }, rates);
    remaining -= used;
    if (remaining < 0) fuelShort.add(lap.stintNumber);
    cumTime += lap.plannedTimeSec;
    return { ...lap, fuelUsedL: used, fuelRemainingL: remaining, cumTimeSec: cumTime };
  });

  return {
    laps: computed,
    totals: {
      totalLaps: computed.length,
      totalTimeSec: cumTime,
      pitCount,
      fuelShortStints: [...fuelShort].sort((a, b) => a - b),
    },
    stintStartFuel,
  };
}

export interface GenerateInput extends AssumedTimes {
  raceDurationMin: number;
  tankCapacityL: number;
  startFuelL: number;
  pitLossSec: number;
  maxStintLap: number;
  fuelRateDry: number;
  fuelRateOutIn: number;
}

export interface RiderLite {
  id: string;
  expectedLapTime: number;
}

// 初期計画の自動生成。
// レース時間・想定タイム・燃料・最大スティント周回から、ライダーをローテーション
// （登録順の繰り返し）でスティント割りしたたたき台を作る。
// 時間制耐久のため「累積時間がレース時間を超えるまで」周回を積む。
// 給油量は満タン相当（タンク容量）で生成する。キャップにより「満タンまで補充」として機能。
export function generateInitialPlan(input: GenerateInput, riders: RiderLite[]): PlanStintInput[] {
  const durationSec = input.raceDurationMin * 60;
  const stints: PlanStintInput[] = [];
  let cumTime = 0;
  let stintNumber = 0;

  // 1 スティントの周回上限 = min(最大スティント周回, 燃料で走れる周回)
  const lapsByFuel = (fuelL: number) => {
    // OUT/IN の 2 周は専用レート、残りはドライ通常で概算
    const usable = fuelL - 2 * input.fuelRateOutIn;
    return Math.max(1, Math.floor(usable / input.fuelRateDry) + 2);
  };

  while (cumTime < durationSec && stintNumber < 50) {
    stintNumber += 1;
    const isFirst = stintNumber === 1;
    // 開始燃料: ST1 = スタート燃料、以降は「残 + 満タン給油」がキャップされてタンク容量
    const stintStartFuel = isFirst ? input.startFuelL : input.tankCapacityL;
    const rider = riders.length > 0 ? riders[(stintNumber - 1) % riders.length] : null;
    const targetLapSec = rider?.expectedLapTime ?? input.assumedLapSec;
    const capLaps = Math.min(input.maxStintLap, lapsByFuel(stintStartFuel));

    if (!isFirst) cumTime += input.pitLossSec;

    let laps = 0;
    for (let i = 1; i <= capLaps; i++) {
      if (cumTime >= durationSec) break;
      const outIn = !isFirst && i === 1 ? 'OUT' : null; // IN は後で末尾に付くが概算では通常扱い
      const t = outIn === 'OUT' ? input.assumedOutLapSec : targetLapSec;
      cumTime += t;
      laps += 1;
    }
    if (laps === 0) {
      stintNumber -= 1;
      break;
    }
    stints.push({
      stintNumber,
      riderId: rider?.id ?? null,
      plannedLaps: laps,
      targetLapSec,
      refuelL: input.tankCapacityL, // 満タン給油（追加L。キャップで実質「満タンまで」）
    });
  }

  return stints;
}
