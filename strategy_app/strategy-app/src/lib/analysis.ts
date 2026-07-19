// 競合分析ロジック（計時フィードの複数車ラップ → 各種指標）。
//
// 【設計方針】この関数群は socket や Prisma に依存しない純関数だけで構成する。
//   これによりサーバー（API ルート）でもクライアント（分析画面）でも同じ計算を使える。
//   計時フィードのラップ配列（FeedLap[]）を入力に、車ごとの統計・スティント・
//   ギャップ・チャート用系列を組み立てる。

// 計時フィード 1 周分（timing-feed.ts の ScrapedLap と同形。型結合を避けここで再定義）
export interface FeedLap {
  lap: number; // 周番号（そのチームの通算周回）
  lapTimeSec: number; // ラップタイム（秒）
  sec1: number | null;
  sec2: number | null;
  sec3: number | null;
  sec4: number | null;
  maxSpeed: number | null;
  pit: boolean; // この周にピット（＝インラップ）
  totalTimeSec: number | null; // スタートからの累計タイム（秒）
}

export interface CarFeed {
  carno: string;
  laps: FeedLap[];
  error?: string | null;
}

// クリーン周の閾値: ベストラップの 107%（F1 の 107% ルールに倣う）。
// これより遅い周は SC・アクシデント・混雑等の外れ値としてペース算定から除外する。
const CLEAN_FACTOR = 1.07;

export interface StintInfo {
  index: number; // 1 始まりの通し番号
  startLap: number;
  endLap: number;
  lapCount: number; // ピット/アウトラップ含む総周回
  greenCount: number; // 平均に使ったグリーン周数
  avgSec: number | null; // グリーン周平均（アウト/インを除く）
  bestSec: number | null;
  endedByPit: boolean; // このスティントはピットインで終わったか（＝レース途中）
}

export interface CarStats {
  carno: string;
  lapCount: number; // 有効ラップ数（タイム > 0）
  lastLap: number | null; // 到達済みの最終周番号（進捗の目安）
  bestLapSec: number | null;
  avgLapSec: number | null; // クリーン周平均
  medianLapSec: number | null; // クリーン周中央値
  stdevSec: number | null; // クリーン周の標準偏差（小さいほど安定）
  cleanLapCount: number;
  bestSectors: (number | null)[]; // [S1,S2,S3,S4] 各自己ベスト
  theoreticalBestSec: number | null; // 各セクターベストの和（理論上の最速）
  topSpeed: number | null; // 最高速（km/h）
  pitCount: number;
  stintCount: number;
  avgStintLaps: number | null; // 完了スティントの平均周回
  stints: StintInfo[];
}

// ── 小道具 ──────────────────────────────────────────────
const mean = (xs: number[]): number | null =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const stdev = (xs: number[]): number | null => {
  if (xs.length < 2) return null;
  const m = mean(xs)!;
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))!);
};

const minPos = (xs: (number | null)[]): number | null => {
  const v = xs.filter((x): x is number => x != null && x > 0);
  return v.length ? Math.min(...v) : null;
};

// ラップを周番号昇順にそろえ、タイム > 0 の有効周だけ返す
function sortedValid(laps: FeedLap[]): FeedLap[] {
  return [...laps]
    .filter((l) => Number.isFinite(l.lap) && l.lap > 0 && l.lapTimeSec > 0)
    .sort((a, b) => a.lap - b.lap);
}

// スティント検出: ピット周（インラップ）でスティントを閉じ、次周から新スティント。
// 各スティントの平均は「アウトラップ（各スティント先頭）とインラップ（ピット周）を除いた
// グリーン周」で算出する。レース開始直後の最初の周もアウトラップ扱いで除外。
export function detectStints(laps: FeedLap[]): StintInfo[] {
  const valid = sortedValid(laps);
  if (valid.length === 0) return [];

  const chunks: FeedLap[][] = [];
  let cur: FeedLap[] = [];
  for (const l of valid) {
    cur.push(l);
    if (l.pit) {
      chunks.push(cur);
      cur = [];
    }
  }
  if (cur.length) chunks.push(cur);

  return chunks.map((chunk, i) => {
    const endedByPit = chunk[chunk.length - 1].pit;
    // グリーン周 = 先頭（アウトラップ）を除き、ピット周も除く
    const green = chunk
      .slice(1)
      .filter((l) => !l.pit)
      .map((l) => l.lapTimeSec);
    return {
      index: i + 1,
      startLap: chunk[0].lap,
      endLap: chunk[chunk.length - 1].lap,
      lapCount: chunk.length,
      greenCount: green.length,
      avgSec: mean(green),
      bestSec: green.length ? Math.min(...green) : null,
      endedByPit,
    };
  });
}

// 1 車ぶんの統計を算出
export function computeCarStats(feed: CarFeed): CarStats {
  const valid = sortedValid(feed.laps);
  const carno = feed.carno;

  if (valid.length === 0) {
    return {
      carno,
      lapCount: 0,
      lastLap: null,
      bestLapSec: null,
      avgLapSec: null,
      medianLapSec: null,
      stdevSec: null,
      cleanLapCount: 0,
      bestSectors: [null, null, null, null],
      theoreticalBestSec: null,
      topSpeed: null,
      pitCount: 0,
      stintCount: 0,
      avgStintLaps: null,
      stints: [],
    };
  }

  // アウトラップ判定: 先頭周、または直前周がピット（インラップ）だった周
  const isOut = new Set<number>();
  isOut.add(valid[0].lap);
  for (let i = 1; i < valid.length; i++) {
    if (valid[i - 1].pit) isOut.add(valid[i].lap);
  }

  // レーシング（グリーン）周 = ピットでもアウトラップでもない周
  const racing = valid.filter((l) => !l.pit && !isOut.has(l.lap));
  const racingTimes = racing.map((l) => l.lapTimeSec);
  const bestLapSec = racingTimes.length ? Math.min(...racingTimes) : Math.min(...valid.map((l) => l.lapTimeSec));

  // クリーン周 = ベストの 107% 以内のグリーン周
  const cleanTimes = racingTimes.filter((t) => t <= bestLapSec * CLEAN_FACTOR);

  const bestSectors = [
    minPos(valid.map((l) => l.sec1)),
    minPos(valid.map((l) => l.sec2)),
    minPos(valid.map((l) => l.sec3)),
    minPos(valid.map((l) => l.sec4)),
  ];
  const theoreticalBestSec = bestSectors.every((s) => s != null)
    ? (bestSectors as number[]).reduce((a, b) => a + b, 0)
    : null;

  const stints = detectStints(feed.laps);
  const completed = stints.filter((s) => s.endedByPit);

  return {
    carno,
    lapCount: valid.length,
    lastLap: valid[valid.length - 1].lap,
    bestLapSec,
    avgLapSec: mean(cleanTimes),
    medianLapSec: median(cleanTimes),
    stdevSec: stdev(cleanTimes),
    cleanLapCount: cleanTimes.length,
    bestSectors,
    theoreticalBestSec,
    topSpeed: valid.some((l) => l.maxSpeed) ? Math.max(...valid.map((l) => l.maxSpeed ?? 0)) : null,
    pitCount: valid.filter((l) => l.pit).length,
    stintCount: stints.length,
    avgStintLaps: completed.length ? mean(completed.map((s) => s.lapCount)) : null,
    stints,
  };
}

// ── チャート用系列 ──────────────────────────────────────
// いずれも recharts の data 配列（1 行 = 1 周、キーは車番）に整形する。

export interface ChartRow {
  lap: number;
  [carno: string]: number | null;
}

// ラップタイム比較: グリーン周のみ（ピット/アウトラップ/無効を除外し、ピットの山でスケールが
// 崩れないようにする）。x=周番号, 各車のラップ秒。
export function lapTimeChartData(cars: CarFeed[]): ChartRow[] {
  const byLap = new Map<number, ChartRow>();
  for (const car of cars) {
    const valid = sortedValid(car.laps);
    const isOut = new Set<number>();
    if (valid.length) isOut.add(valid[0].lap);
    for (let i = 1; i < valid.length; i++) if (valid[i - 1].pit) isOut.add(valid[i].lap);

    for (const l of valid) {
      if (l.pit || isOut.has(l.lap)) continue;
      const row = byLap.get(l.lap) ?? { lap: l.lap };
      row[car.carno] = l.lapTimeSec;
      byLap.set(l.lap, row);
    }
  }
  return [...byLap.values()].sort((a, b) => a.lap - b.lap);
}

// ギャップ推移: 基準車の累計タイムに対する各車の差（秒）。
//   gap = その車の累計タイム − 基準車の累計タイム（同じ周番号どうし）。
//   ＋ = 基準車より遅れている / − = 先行。基準車自身は 0（系列に含めない）。
export function gapChartData(cars: CarFeed[], refCarno: string): ChartRow[] {
  const totalMap = (laps: FeedLap[]) => {
    const m = new Map<number, number>();
    for (const l of laps) {
      if (l.totalTimeSec != null && l.totalTimeSec > 0) m.set(l.lap, l.totalTimeSec);
    }
    return m;
  };
  const ref = cars.find((c) => c.carno === refCarno);
  if (!ref) return [];
  const refTotal = totalMap(ref.laps);
  const others = cars.filter((c) => c.carno !== refCarno).map((c) => ({ carno: c.carno, total: totalMap(c.laps) }));

  const rows: ChartRow[] = [];
  for (const lap of [...refTotal.keys()].sort((a, b) => a - b)) {
    const rt = refTotal.get(lap)!;
    const row: ChartRow = { lap };
    let any = false;
    for (const o of others) {
      const t = o.total.get(lap);
      if (t != null) {
        row[o.carno] = t - rt;
        any = true;
      }
    }
    if (any) rows.push(row);
  }
  return rows;
}
