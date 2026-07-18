'use client';

// デイリースケジュール: 計画スティントを時刻軸に展開し、
// 「何時から何時に誰が・何周・目標アベレージ・給油・タイヤ交換」を一目で見せる。
// 時刻は「レース開始時刻（設定の開始時刻。未設定なら経過時間表示） + 計画累積時間」で算出。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardDescription } from '@/components/ui/card';
import { PanelLabel } from '@/components/panel-label';
import { formatLapTime, formatMinSec } from '@/lib/time';

interface Rider {
  id: string;
  name: string;
  color: string | null;
}
interface PlanStint {
  id: string;
  stintNumber: number;
  riderId: string | null;
  plannedLaps: number;
  targetLapSec: number | null;
  refuelL: number;
  tireChange: boolean;
  startFuelL: number | null;
}
interface PlanLap {
  lapNumber: number;
  stintNumber: number;
  plannedTimeSec: number;
  cumTimeSec: number;
}
interface PlanResponse {
  race: {
    raceName: string;
    raceDurationMin: number;
    startedAt: string | null;
    pitLossSec: number;
    assumedLapSec: number;
  } | null;
  riders: Rider[];
  stints: PlanStint[];
  laps: PlanLap[];
  totals: { totalLaps: number; totalTimeSec: number; pitCount: number; raceDurationSec: number };
  progress?: { maxActualLap: number; raceStarted: boolean };
}

// スティントごとの時間帯（レース開始からのオフセット秒）
interface ScheduleRow {
  stint: PlanStint;
  rider: Rider | null;
  runStartSec: number; // コース復帰（OUT）またはスタート
  runEndSec: number; // IN 周完了（ピット入口）
  firstLap: number;
  lastLap: number;
  laps: number;
  targetAveSec: number;
  pitBefore: null | { startSec: number; endSec: number }; // このスティント前のピット作業
}

export default function SchedulePage() {
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/plan', { cache: 'no-store' });
      if (!res.ok) throw new Error('計画の取得に失敗しました');
      setPlan(await res.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '不明なエラー');
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]);

  const rows = useMemo<ScheduleRow[]>(() => {
    if (!plan?.race || plan.stints.length === 0 || plan.laps.length === 0) return [];
    const race = plan.race;
    const byStint = new Map<number, PlanLap[]>();
    for (const l of plan.laps) {
      const arr = byStint.get(l.stintNumber) ?? [];
      arr.push(l);
      byStint.set(l.stintNumber, arr);
    }
    const sorted = [...plan.stints].sort((a, b) => a.stintNumber - b.stintNumber);
    return sorted.flatMap((s) => {
      const laps = byStint.get(s.stintNumber);
      if (!laps || laps.length === 0) return [];
      const first = laps[0];
      const last = laps[laps.length - 1];
      // cumTimeSec はピットロス加算後にラップタイムを足した値なので、
      // 走行開始 = 先頭周の累積 − 先頭周のタイム、ピット開始 = その pitLossSec 前
      const runStartSec = first.cumTimeSec - first.plannedTimeSec;
      return [
        {
          stint: s,
          rider: plan.riders.find((r) => r.id === s.riderId) ?? null,
          runStartSec,
          runEndSec: last.cumTimeSec,
          firstLap: first.lapNumber,
          lastLap: last.lapNumber,
          laps: laps.length,
          targetAveSec: s.targetLapSec ?? race.assumedLapSec,
          pitBefore:
            s.stintNumber === 1 ? null : { startSec: runStartSec - race.pitLossSec, endSec: runStartSec },
        },
      ];
    });
  }, [plan]);

  // 時刻基準: 設定の開始時刻（未設定なら null → 経過時間で表示）
  const baseMs = plan?.race?.startedAt ? new Date(plan.race.startedAt).getTime() : null;
  const fmtTime = useCallback(
    (offsetSec: number) => {
      if (baseMs == null) return `+${formatMinSec(offsetSec)}`;
      const d = new Date(baseMs + offsetSec * 1000);
      return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
    },
    [baseMs],
  );

  if (!plan) return <div className="text-muted-foreground">読み込み中…</div>;
  if (!plan.race) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">スケジュール</h1>
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            アクティブなレースがありません。「設定」でレースを作成してください。
          </CardContent>
        </Card>
      </div>
    );
  }

  const race = plan.race;
  const tireChanges = rows.filter((r) => r.stint.tireChange && r.pitBefore).length;
  const maxActualLap = plan.progress?.maxActualLap ?? 0;
  // 現在走行中のスティント = 次に走る周（実績+1周目）を含むスティント
  const currentStintNo =
    maxActualLap > 0 ? rows.find((r) => maxActualLap + 1 >= r.firstLap && maxActualLap + 1 <= r.lastLap)?.stint.stintNumber ?? null : null;

  return (
    <div className="space-y-4 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">スケジュール</h1>
        <p className="mt-0.5 text-[10px] tracking-[0.3em] text-muted-foreground uppercase">
          Day Plan ・ {race.raceName}
        </p>
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive border border-destructive/30 rounded-md px-4 py-2 text-sm">{error}</div>
      )}

      {/* サマリー */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Summary label="スタート" value={baseMs != null ? fmtTime(0) : '未設定'} sub={baseMs == null ? '設定の開始時刻を入力' : undefined} />
        <Summary label="チェッカー予想" value={rows.length > 0 ? fmtTime(plan.totals.totalTimeSec) : '—'} sub={`計画 ${plan.totals.totalLaps} 周`} />
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
          <PanelLabel>Timeline / 本日の進行</PanelLabel>
          <CardDescription>計画スティントの時刻展開。PIT 行のタイヤ列「🛞 交換」がタイヤ交換ありのピットです</CardDescription>
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
                    return (
                      <FragmentRows
                        key={r.stint.id}
                        r={r}
                        fmtTime={fmtTime}
                        isDone={isDone}
                        isCurrent={isCurrent}
                      />
                    );
                  })}
                  {/* チェッカー行 */}
                  <tr className="border-t-2 border-border">
                    <td className="py-2.5 px-2 font-mono font-bold whitespace-nowrap">{fmtTime(plan.totals.totalTimeSec)}</td>
                    <td className="py-2.5 px-2"></td>
                    <td className="py-2.5 px-2 font-display text-lg font-bold whitespace-nowrap" colSpan={4}>
                      🏁 チェッカー（計画消化時）
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
      <tr
        className={`border-b border-border/50 ${
          isCurrent ? 'bg-primary/10' : isDone ? 'bg-muted/20 opacity-60' : ''
        }`}
      >
        <td className="py-2 px-2 font-mono font-bold whitespace-nowrap">
          {fmtTime(r.runStartSec)}〜{fmtTime(r.runEndSec)}
        </td>
        <td className="py-2 px-2 font-mono">{r.stint.stintNumber}</td>
        <td className="py-2 px-2">
          <span className="inline-flex items-center gap-2 whitespace-nowrap">
            <span
              className="inline-block h-3.5 w-1.5 rounded-sm shrink-0"
              style={{ backgroundColor: r.rider?.color ?? '#6b7280' }}
            />
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
