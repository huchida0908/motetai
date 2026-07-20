'use client';

// スケジュールタイムライン: 計画スティントを時刻軸に展開する読み取り専用の表示。
// /schedule ページと共有ダッシュボード（/share）の両方から使い、描画ロジックを一元化する。
//
// 時刻は2モード:
//   - ライブ予測（レース開始後・実ペースあり）: 「今の周回・経過」を起点に、未来の周回を
//     実際の平均ラップ(avgLapSec)＋ピットロスで前進させて各通過予定時刻を算出（ダッシュボードの
//     projectRace と同じ考え方）。遅れ/貯金が先の時刻に反映される。実ペースは /api/live を自前で取得。
//   - 計画（開始前・ペース未計測）: 「開始時刻 ＋ 計画累積時間」でそのまま表示。
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardDescription } from '@/components/ui/card';
import { PanelLabel } from '@/components/panel-label';
import { formatLapTime, formatMinSec } from '@/lib/time';

export interface ScheduleRider {
  id: string;
  name: string;
  color: string | null;
}
export interface SchedulePlanStint {
  id: string;
  stintNumber: number;
  riderId: string | null;
  plannedLaps: number;
  targetLapSec: number | null;
  refuelL: number;
  tireChange: boolean;
  startFuelL: number | null;
}
export interface SchedulePlanLap {
  lapNumber: number;
  stintNumber: number;
  plannedTimeSec: number;
  cumTimeSec: number;
}
export interface PlanResponse {
  race: {
    raceName: string;
    raceDurationMin: number;
    startedAt: string | null;
    pitLossSec: number;
    assumedLapSec: number;
  } | null;
  riders: ScheduleRider[];
  stints: SchedulePlanStint[];
  laps: SchedulePlanLap[];
  totals: { totalLaps: number; totalTimeSec: number; pitCount: number; raceDurationSec: number };
  progress?: { maxActualLap: number; raceStarted: boolean };
}

// スティントごとの時間帯（レース開始からのオフセット秒）
export interface ScheduleRow {
  stint: SchedulePlanStint;
  rider: ScheduleRider | null;
  runStartSec: number; // コース復帰（OUT）またはスタート
  runEndSec: number; // IN 周完了（ピット入口）
  firstLap: number;
  lastLap: number;
  laps: number;
  targetAveSec: number;
  pitBefore: null | { startSec: number; endSec: number }; // このスティント前のピット作業
}

// 予測モードで各周の累積時間・その周の所要を差し替えるためのマップ。
interface RowOverrides {
  cumByLap: Map<number, number>; // 周完了時の累積秒（レース開始から）
  estByLap: Map<number, number>; // その周の所要秒
}

// 計画（stints + 展開済み laps）からスティント時間帯の行を組み立てる。
// ov を渡すと累積/所要を実測/予測値で差し替える（渡さなければ計画どおり）。
export function buildScheduleRows(plan: PlanResponse, ov?: RowOverrides): ScheduleRow[] {
  if (!plan.race || plan.stints.length === 0 || plan.laps.length === 0) return [];
  const race = plan.race;
  const cumOf = (l: SchedulePlanLap) => ov?.cumByLap.get(l.lapNumber) ?? l.cumTimeSec;
  const estOf = (l: SchedulePlanLap) => ov?.estByLap.get(l.lapNumber) ?? l.plannedTimeSec;
  const byStint = new Map<number, SchedulePlanLap[]>();
  for (const l of plan.laps) {
    const arr = byStint.get(l.stintNumber) ?? [];
    arr.push(l);
    byStint.set(l.stintNumber, arr);
  }
  const sorted = [...plan.stints].sort((a, b) => a.stintNumber - b.stintNumber);
  const rows: ScheduleRow[] = [];
  let prevRunEnd: number | null = null; // 直前スティントの走行終了（＝ピット入口）
  for (const s of sorted) {
    const laps = byStint.get(s.stintNumber);
    if (!laps || laps.length === 0) continue;
    const first = laps[0];
    const last = laps[laps.length - 1];
    // 走行開始 = 先頭周の累積 − 先頭周の所要
    const runStartSec = cumOf(first) - estOf(first);
    // ピット枠 = [直前スティントの走行終了, 走行開始]。実績反映時はこの間隔が実ピット時間になる。
    // 計画のみのときは直前走行終了 = 走行開始 − 想定ピットロスなので従来と一致。
    // 直前が無い（データ欠落）場合は従来どおり「走行開始 − 想定ピットロス」でフォールバック。
    const pitBefore =
      s.stintNumber === 1
        ? null
        : { startSec: prevRunEnd ?? runStartSec - race.pitLossSec, endSec: runStartSec };
    rows.push({
      stint: s,
      rider: plan.riders.find((r) => r.id === s.riderId) ?? null,
      runStartSec,
      runEndSec: cumOf(last),
      firstLap: first.lapNumber,
      lastLap: last.lapNumber,
      laps: laps.length,
      targetAveSec: s.targetLapSec ?? race.assumedLapSec,
      pitBefore,
    });
    prevRunEnd = cumOf(last);
  }
  return rows;
}

// オフセット秒 → 表示文字列。開始時刻があれば実時刻(H:MM)、無ければ経過(+M:SS)。
export function makeFmtTime(startedAt: string | null): (offsetSec: number) => string {
  const baseMs = startedAt ? new Date(startedAt).getTime() : null;
  return (offsetSec: number) => {
    if (baseMs == null) return `+${formatMinSec(offsetSec)}`;
    const d = new Date(baseMs + offsetSec * 1000);
    return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
}

// 符号付き M:SS（+=遅れ / −=前倒し）
function signedMinSec(sec: number): string {
  const s = Math.round(sec);
  if (s === 0) return '±0:00';
  return (s > 0 ? '+' : '−') + formatMinSec(Math.abs(s));
}

interface LiveActual {
  maxLap: number; // 実績のある最終周（＝通算周回数）
  cumByLap: Map<number, number>; // 周完了時の累積経過秒（レース開始から / 実測）
  timeByLap: Map<number, number>; // その周の実測ラップタイム
}

// 実績（実測ラップ）を /api/live から取得。30秒ごとに更新。
//   - progress.actual: 各周完了時の累積経過秒（公式 TotalTime 基準。実ピット時間も反映）
//   - series: 各周の実測ラップタイム
function useLiveActual(): LiveActual | null {
  const [actual, setActual] = useState<LiveActual | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch('/api/live', { cache: 'no-store' });
        if (!res.ok) return;
        const j = await res.json();
        if (!alive || !j?.tiles) return;
        const cumByLap = new Map<number, number>();
        for (const p of (j.progress?.actual ?? []) as Array<{ t: number; laps: number }>) {
          cumByLap.set(p.laps, p.t);
        }
        const timeByLap = new Map<number, number>();
        for (const s of (j.series ?? []) as Array<{ lap: number; timeSec: number }>) {
          timeByLap.set(s.lap, s.timeSec);
        }
        setActual({
          maxLap: j.tiles.totalLaps ?? 0,
          cumByLap,
          timeByLap,
        });
      } catch {
        /* ライブ取得失敗時は計画表示にフォールバック */
      }
    };
    load();
    const id = setInterval(load, 30000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  return actual;
}

// 「最新の実績 ＋ 実績のない部分は計画で再計算」で各周の累積時間・所要を作る。
//   - 実績のある周（lapNumber <= maxLap）: 実測の累積経過・実測ラップタイムをそのまま使う。
//   - 実績のない周（lapNumber > maxLap）: 最後の実績周の累積経過を起点に、計画のラップタイム＋
//     スティント境界のピットロスで前進（＝ここから計画どおり走ったときの予定時刻）。
// 実測が欠けている周は計画値でフォールバックする。実績が無い/未開始なら null（計画どおり表示）。
function computeActualPlanOverrides(plan: PlanResponse, actual: LiveActual | null): RowOverrides | null {
  if (!actual || actual.maxLap <= 0) return null;
  const laps = [...plan.laps].sort((a, b) => a.lapNumber - b.lapNumber);
  if (laps.length === 0) return null;

  const maxLap = actual.maxLap;
  const pit = plan.race?.pitLossSec ?? 0;

  const cumByLap = new Map<number, number>();
  const estByLap = new Map<number, number>();

  // 実績のある周: 実測の累積・実測ラップタイム（欠損時は計画値へフォールバック）
  for (const l of laps) {
    if (l.lapNumber <= maxLap) {
      cumByLap.set(l.lapNumber, actual.cumByLap.get(l.lapNumber) ?? l.cumTimeSec);
      estByLap.set(l.lapNumber, actual.timeByLap.get(l.lapNumber) ?? l.plannedTimeSec);
    }
  }

  // 起点 = 最後の実績周の累積経過（実測）。無ければ計画累積へフォールバック。
  const anchorLap = laps.filter((l) => l.lapNumber <= maxLap).pop();
  let cum = (anchorLap && actual.cumByLap.get(anchorLap.lapNumber)) ?? anchorLap?.cumTimeSec ?? 0;

  // 実績のない周: 計画のラップタイムで前進（スティント境界でピットロス加算）
  const future = laps.filter((l) => l.lapNumber > maxLap);
  let prevStint = anchorLap?.stintNumber ?? future[0]?.stintNumber ?? null;
  for (const l of future) {
    if (prevStint != null && l.stintNumber !== prevStint) cum += pit;
    prevStint = l.stintNumber;
    cum += l.plannedTimeSec;
    cumByLap.set(l.lapNumber, cum);
    estByLap.set(l.lapNumber, l.plannedTimeSec);
  }
  return { cumByLap, estByLap };
}

export default function ScheduleTimeline({ plan }: { plan: PlanResponse }) {
  const actual = useLiveActual();
  if (!plan.race) return null; // 呼び出し側で「レースなし」を扱う想定
  const race = plan.race;

  const overrides = computeActualPlanOverrides(plan, actual);
  const merged = overrides != null; // 実績を反映しているか（実績＋計画）
  const rows = buildScheduleRows(plan, overrides ?? undefined);
  const baseMs = race.startedAt ? new Date(race.startedAt).getTime() : null;
  const fmtTime = makeFmtTime(race.startedAt);

  const tireChanges = rows.filter((r) => r.stint.tireChange && r.pitBefore).length;
  const maxActualLap = actual?.maxLap ?? plan.progress?.maxActualLap ?? 0;
  // 現在走行中のスティント = 次に走る周（実績+1周目）を含むスティント
  const currentStintNo =
    maxActualLap > 0
      ? rows.find((r) => maxActualLap + 1 >= r.firstLap && maxActualLap + 1 <= r.lastLap)?.stint.stintNumber ?? null
      : null;

  // チェッカー（最終行の走行終了）＝ 予測 or 計画。計画比の差も出す
  const planFinishSec = plan.totals.totalTimeSec;
  const finishSec = rows.length > 0 ? rows[rows.length - 1].runEndSec : planFinishSec;
  const finishDelta = finishSec - planFinishSec;

  return (
    <div className="space-y-4">
      {/* サマリー */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Summary label="スタート" value={baseMs != null ? fmtTime(0) : '未設定'} sub={baseMs == null ? '設定の開始時刻を入力' : undefined} />
        <Summary
          label={merged ? 'チェッカー予測' : 'チェッカー予想'}
          value={rows.length > 0 ? fmtTime(finishSec) : '—'}
          sub={merged ? `計画比 ${signedMinSec(finishDelta)}（+=遅れ）` : `計画 ${plan.totals.totalLaps} 周`}
        />
        <Summary label="ピット回数" value={`${plan.totals.pitCount} 回`} />
        <Summary label="タイヤ交換" value={`${tireChanges} 回`} sub={tireChanges > 0 ? '🛞 マークのピット' : undefined} />
      </div>

      {baseMs == null && rows.length > 0 && (
        <div className="bg-amber-500/10 text-amber-300 border border-amber-500/30 rounded-md px-4 py-2 text-sm">
          開始時刻が未設定のため、スタートからの経過時間（+分:秒）で表示しています。「設定」の開始時刻を入力すると実時刻になります
        </div>
      )}

      {/* タイムライン */}
      <Card>
        <CardHeader className="pb-2 space-y-1">
          <div className="flex items-center gap-2">
            <PanelLabel>Timeline / 本日の進行</PanelLabel>
            {merged && (
              <span className="inline-flex items-center gap-1 rounded-sm bg-primary/15 text-primary border border-primary/40 px-1.5 py-0.5 text-[10px] font-bold whitespace-nowrap">
                ● 実績反映
              </span>
            )}
          </div>
          <CardDescription>
            {merged
              ? '実績のある周は実測時刻、それ以降は計画どおりに再計算した予定時刻です。実績が増えるたび自動更新します'
              : '計画スティントの時刻展開（計画どおりの予定時刻）。PIT 行のタイヤ列「🛞 交換」がタイヤ交換ありのピットです'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm">
              計画がありません。「計画」ページでスティント計画を作成・保存してください
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-muted-foreground border-b">
                  <tr>
                    <th className="text-left py-2 px-2 whitespace-nowrap">時刻</th>
                    <th className="text-left py-2 px-2">ST</th>
                    <th className="text-left py-2 px-2">ライダー / 作業</th>
                    <th className="text-left py-2 px-2 whitespace-nowrap">周回</th>
                    <th className="text-left py-2 px-2 whitespace-nowrap">目標 Ave</th>
                    <th className="text-left py-2 px-2 whitespace-nowrap">給油</th>
                    <th className="text-left py-2 px-2 whitespace-nowrap">タイヤ</th>
                    <th className="text-right py-2 px-2 whitespace-nowrap">所要</th>
                    <th className="text-right py-2 px-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const isDone = maxActualLap >= r.lastLap;
                    const isCurrent = r.stint.stintNumber === currentStintNo;
                    return <FragmentRows key={r.stint.id} r={r} fmtTime={fmtTime} isDone={isDone} isCurrent={isCurrent} />;
                  })}
                  {/* チェッカー行 */}
                  <tr className="border-t-2 border-border">
                    <td className="py-2.5 px-2 font-mono font-bold whitespace-nowrap">{fmtTime(finishSec)}</td>
                    <td className="py-2.5 px-2"></td>
                    <td className="py-2.5 px-2 font-display text-lg font-bold whitespace-nowrap" colSpan={4}>
                      🏁 チェッカー（{merged ? '実績＋計画' : '計画消化時'}）
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-muted-foreground whitespace-nowrap" colSpan={2}>
                      レース時間 {formatMinSec(plan.totals.raceDurationSec)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// 1 スティントぶんの行（ピット作業行 + 走行行）
function FragmentRows({
  r,
  fmtTime,
  isDone,
  isCurrent,
}: {
  r: ScheduleRow;
  fmtTime: (offsetSec: number) => string;
  isDone: boolean;
  isCurrent: boolean;
}) {
  return (
    <>
      {r.pitBefore && (
        <tr className={`border-b border-border/50 bg-muted/30 ${isDone ? 'opacity-60' : ''}`}>
          <td className="py-2 px-2 font-mono whitespace-nowrap">
            {fmtTime(r.pitBefore.startSec)}〜{fmtTime(r.pitBefore.endSec)}
          </td>
          <td className="py-2 px-2 font-mono text-xs text-muted-foreground">PIT</td>
          <td className="py-2 px-2">
            <span className="font-display text-lg font-bold whitespace-nowrap">🔧 ピットイン</span>
          </td>
          <td className="py-2 px-2 text-muted-foreground">─</td>
          <td className="py-2 px-2 text-muted-foreground">─</td>
          <td className="py-2 px-2 font-mono whitespace-nowrap">{r.stint.refuelL} L</td>
          <td className="py-2 px-2 whitespace-nowrap">
            {r.stint.tireChange ? (
              <span className="inline-flex items-center gap-1 rounded-sm bg-amber-500/15 text-amber-400 border border-amber-500/40 px-2 py-0.5 text-xs font-bold">
                🛞 交換
              </span>
            ) : (
              <span className="text-muted-foreground">─</span>
            )}
          </td>
          <td className="py-2 px-2 text-right font-mono text-muted-foreground whitespace-nowrap">
            {formatMinSec(r.pitBefore.endSec - r.pitBefore.startSec)}
          </td>
          <td className="py-2 px-2"></td>
        </tr>
      )}
      <tr className={`border-b border-border/50 ${isCurrent ? 'bg-primary/10' : isDone ? 'bg-muted/20 opacity-60' : ''}`}>
        <td className="py-2 px-2 font-mono font-bold whitespace-nowrap">
          {fmtTime(r.runStartSec)}〜{fmtTime(r.runEndSec)}
        </td>
        <td className="py-2 px-2 font-mono">{r.stint.stintNumber}</td>
        <td className="py-2 px-2">
          <span className="inline-flex items-center gap-2 whitespace-nowrap">
            <span className="inline-block h-3.5 w-1.5 rounded-sm shrink-0" style={{ backgroundColor: r.rider?.color ?? '#6b7280' }} />
            <span className="font-display text-lg font-bold" title={r.rider?.name ?? '未定'}>
              {r.rider?.name ?? '（未定）'}
            </span>
          </span>
        </td>
        <td className="py-2 px-2 font-mono whitespace-nowrap">
          {r.laps} 周 <span className="text-xs text-muted-foreground">(Lap {r.firstLap}–{r.lastLap})</span>
        </td>
        <td className="py-2 px-2 font-mono whitespace-nowrap">{formatLapTime(r.targetAveSec)}</td>
        <td className="py-2 px-2 text-muted-foreground">─</td>
        <td className="py-2 px-2 text-muted-foreground">─</td>
        <td className="py-2 px-2 text-right font-mono text-muted-foreground whitespace-nowrap">
          {formatMinSec(r.runEndSec - r.runStartSec)}
        </td>
        <td className="py-2 px-2 text-right whitespace-nowrap">
          {isDone && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">済</span>}
          {isCurrent && <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary font-bold">走行中</span>}
        </td>
      </tr>
    </>
  );
}

function Summary({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="font-display text-2xl font-bold">{value}</div>
        {sub ? <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div> : null}
      </CardContent>
    </Card>
  );
}
