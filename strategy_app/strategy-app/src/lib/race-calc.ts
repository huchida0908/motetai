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

export interface ProjectInput {
  remainingSec: number; // レース残り時間
  avgLapSec: number; // 想定ラップ（直近ペース or 想定値）
  totalLaps: number; // 現在の通算周回
  lapsUntilNextPit: number; // 次ピットまで走れる周回（燃料 or スティント上限の小さい方）
  stintLaps: number; // ピット後 1 スティントで走れる周回（燃料 or 上限）
  pitLossSec: number; // 1 回のピットロス（秒）
}

// 残り時間をラップ＋ピットで前方シミュレーションし、着地周回・残りピット回数を推定する。
export function projectRace(p: ProjectInput) {
  let t = p.remainingSec;
  let laps = 0;
  let pits = 0;
  let stintCap = Math.max(0, Math.floor(p.lapsUntilNextPit));
  const stintLaps = Math.max(1, Math.floor(p.stintLaps));
  const avg = p.avgLapSec > 0 ? p.avgLapSec : 146;

  for (let i = 0; i < 2000; i++) {
    if (stintCap <= 0) {
      // これ以上走るにはピットが必要。ピット＋1周ぶんの時間が無ければ終了
      if (t < p.pitLossSec + avg) break;
      t -= p.pitLossSec;
      pits += 1;
      stintCap = stintLaps;
    }
    if (t < avg) break; // 次の 1 周を回る時間が無い
    t -= avg;
    laps += 1;
    stintCap -= 1;
  }

  return {
    projectedRemainingLaps: laps,
    projectedTotalLaps: p.totalLaps + laps,
    remainingPits: pits,
    lapsUntilNextPit: Math.max(0, Math.floor(p.lapsUntilNextPit)),
    nextPitInSec: Math.max(0, Math.floor(p.lapsUntilNextPit)) * avg,
  };
}

// ─────────────────────────────────────────────
// 計画準拠の前方シミュレーション。
// 周単位計画（PlanLap）がある場合は、汎用の燃料/maxStintLap モデルではなく
// 「計画のスティント割り」を残り時間ぶんだけ辿って着地周回・次ピットを推定する。
// green 周は実績ペース（greenPaceSec）があればそれで、無ければ計画タイムでコスト計上。
// OUT/IN/SC 周は計画タイムをそのまま使う。スティント境界（planStintId 変化）で pitLoss を加算。
// ─────────────────────────────────────────────
export interface PlanProjectionLap {
  lapNumber: number;
  planStintId: string;
  outIn?: string | null; // "OUT" | "IN" | null
  condition: string;
  plannedTimeSec: number;
}

export interface PlanProjectInput {
  remainingSec: number; // レース残り時間
  totalLaps: number; // 実績で完了した通算周回
  planLaps: PlanProjectionLap[]; // 計画の全周（lapNumber 昇順）
  greenPaceSec: number | null; // 実績の直近 green 平均（無ければ null → 計画タイムを使う）
  pitLossSec: number; // 1 回のピットロス（秒）
}

export function projectRaceByPlan(p: PlanProjectInput) {
  const remaining = p.planLaps.filter((l) => l.lapNumber > p.totalLaps);
  // 現在（最後に完了した周）のスティント。境界判定の初期値に使う（未走なら undefined）
  const done = p.planLaps.filter((l) => l.lapNumber <= p.totalLaps);
  let prevStintId: string | undefined = done.length > 0 ? done[done.length - 1].planStintId : undefined;

  const lapCost = (l: PlanProjectionLap) => {
    if (l.outIn === 'OUT' || l.outIn === 'IN' || l.condition === 'SC') return l.plannedTimeSec;
    return p.greenPaceSec ?? l.plannedTimeSec;
  };

  let t = p.remainingSec;
  let elapsed = 0;
  let completed = 0;
  let reachablePits = 0;
  let nextPitInSec: number | null = null;

  for (const lap of remaining) {
    const isBoundary = prevStintId !== undefined && lap.planStintId !== prevStintId;
    const cost = (isBoundary ? p.pitLossSec : 0) + lapCost(lap);
    if (t < cost) break; // 残り時間で次の 1 周（＋必要ならピット）が回れない
    t -= cost;
    elapsed += cost;
    if (isBoundary) reachablePits += 1;
    completed += 1;
    prevStintId = lap.planStintId;
    // 次のピットイン（IN 周）に到達するまでの所要時間を記録
    if (nextPitInSec === null && lap.outIn === 'IN') nextPitInSec = elapsed;
  }

  // 計画上あと何回ピットするか（時間切れに関係なく残っている IN 周の数）
  const plannedRemainingPits = remaining.filter((l) => l.outIn === 'IN').length;

  return {
    // 計画の最後まで（＝計画総周回）を上限に着地。ペースが計画より遅ければ手前で止まる。
    projectedTotalLaps: p.totalLaps + completed,
    reachablePits,
    plannedRemainingPits,
    nextPitInSec,
  };
}

// 対予定の貯金/借金（秒）。通常周について Σ(想定 - 実績)。正=貯金(速い)、負=借金。
export function scheduleBank(laps: LapLike[], assumedLapSec: number): number | null {
  const green = laps.filter((l) => !l.outIn && l.condition !== 'SC');
  if (green.length === 0) return null;
  return green.reduce((acc, l) => acc + (assumedLapSec - l.lapTimeSec), 0);
}
