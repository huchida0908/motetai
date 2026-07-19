'use client';

// 共有ダッシュボード（チームメイト向け・閲覧専用）。
// 編集UIは一切持たず、既存の公開GET（/api/live 5秒 ・ /api/plan 30秒）をポーリングして
// 「次のピット・交代・現在の走者と経過時間・周回・ペース・順位・スケジュール」を表示する。
// スマホ優先の縦積みレイアウト（PCでは中央寄せの単一カラム）。
import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { PanelLabel } from '@/components/panel-label';
import RaceClockTile from '@/components/RaceClockTile';
import RiderStintTimer from '@/components/RiderStintTimer';
import StandingTile from '@/components/StandingTile';
import ScheduleTimeline, { makeFmtTime, type PlanResponse } from '@/components/ScheduleTimeline';
import { formatLapTime, formatMinSec } from '@/lib/time';

interface LiveRider {
  id: string;
  name: string;
  color?: string | null;
}
interface LiveData {
  race: {
    raceName: string;
    startedAt: string | null;
    raceDurationMin: number;
  } | null;
  riders?: LiveRider[];
  nextPlannedRiderId?: string | null;
  currentStint?: { stintNumber: number; riderId: string | null; startedAt: string | null } | null;
  tiles?: {
    totalLaps: number;
    lapsInStint: number;
    planTotalLaps: number | null;
    projectedTotalLaps: number | null;
    lapsUntilNextPit: number;
    nextPitInSec: number | null;
    nextPlannedPitLap: number | null;
    nextPitTireChange: boolean | null;
    recent3Avg: number | null;
    avgDry: number | null;
    avgWet: number | null;
    assumedLapSec: number;
  };
}

export default function ShareDashboard({ carno }: { carno: string | null }) {
  const [live, setLive] = useState<LiveData | null>(null);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadLive = useCallback(async () => {
    try {
      const res = await fetch('/api/live', { cache: 'no-store' });
      if (!res.ok) throw new Error('ライブ情報の取得に失敗しました');
      setLive(await res.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '不明なエラー');
    }
  }, []);
  const loadPlan = useCallback(async () => {
    try {
      const res = await fetch('/api/plan', { cache: 'no-store' });
      if (res.ok) setPlan(await res.json());
    } catch {
      /* 計画は任意情報なので失敗しても無視 */
    }
  }, []);

  useEffect(() => {
    loadLive();
    const id = setInterval(loadLive, 5000);
    return () => clearInterval(id);
  }, [loadLive]);
  useEffect(() => {
    loadPlan();
    const id = setInterval(loadPlan, 30000);
    return () => clearInterval(id);
  }, [loadPlan]);

  if (!live) {
    return <div className="mx-auto max-w-3xl py-16 text-center text-muted-foreground">読み込み中…</div>;
  }
  if (!live.race) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-2xl font-bold">共有ダッシュボード</h1>
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            アクティブなレースがありません。
          </CardContent>
        </Card>
      </div>
    );
  }

  const race = live.race;
  const t = live.tiles;
  const riders = live.riders ?? [];
  const riderName = (id: string | null | undefined) => riders.find((r) => r.id === id)?.name ?? '（未定）';
  const riderColor = (id: string | null | undefined) => riders.find((r) => r.id === id)?.color ?? '#6b7280';

  const currentStint = live.currentStint ?? null;
  const currentRiderId = currentStint?.riderId ?? null;
  const nextRiderId = live.nextPlannedRiderId ?? null;
  // 現走者の走行開始（このスティントの開始時刻。無ければレース開始時刻を代用）
  const riderStartedAt = currentStint?.startedAt ?? race.startedAt;

  // 通算/予定周回・残り
  const totalLaps = t?.totalLaps ?? 0;
  const planTotalLaps = t?.planTotalLaps ?? null;
  const remainingLaps = planTotalLaps != null ? Math.max(0, planTotalLaps - totalLaps) : null;

  // 次ピット: 給油量・タイヤ交換・予定時刻を計画から算出（時刻は /schedule と同一ロジック）
  const nextPit = computeNextPit(currentStint?.stintNumber ?? 0, plan, t?.nextPitTireChange ?? null);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {/* ヘッダ */}
      <div className="flex items-center gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl md:text-2xl font-bold tracking-tight">共有ダッシュボード</h1>
            {race.startedAt && (
              <span className="inline-flex items-center gap-1.5 rounded-sm border border-primary/40 bg-primary/10 px-2 py-0.5">
                <span className="live-dot h-2 w-2 rounded-full bg-primary" />
                <span className="font-display text-xs font-bold tracking-[0.22em] text-primary">LIVE</span>
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[10px] tracking-[0.3em] text-muted-foreground uppercase">Team View ・ {race.raceName}</p>
        </div>
      </div>

      {error && (
        <div className="bg-amber-500/10 text-amber-300 border border-amber-500/30 rounded-md px-4 py-2 text-sm">{error}（自動再取得します）</div>
      )}

      {/* 残り時間 ・ 通算周回 */}
      <Card className="overflow-hidden">
        <div className="h-[3px] bg-gradient-to-r from-primary via-primary/40 to-transparent" />
        <div className="grid grid-cols-2 divide-x divide-border">
          <RaceClockTile startedAt={race.startedAt} raceDurationMin={race.raceDurationMin} variant="hero" />
          <div className="p-4 flex flex-col justify-center">
            <PanelLabel>Lap / 通算周回</PanelLabel>
            <div className="font-display text-4xl md:text-5xl font-bold leading-tight">
              {totalLaps}
              <span className="text-xl text-muted-foreground font-semibold"> / {planTotalLaps ?? '—'}</span>
            </div>
            <div className="text-xs text-muted-foreground font-mono">
              {remainingLaps != null ? `残り ${remainingLaps} 周（予定）` : '計画なし'}
              {t?.projectedTotalLaps != null ? ` ・ 着地予測 ${t.projectedTotalLaps} 周` : ''}
            </div>
          </div>
        </div>
      </Card>

      {/* 次のピット（最重要） */}
      <Card className="accent-bar overflow-hidden">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <PanelLabel>Next Pit / 次のピット</PanelLabel>
            {nextPit.tireChange != null && (
              <span
                className={`inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-[11px] font-bold whitespace-nowrap ${
                  nextPit.tireChange
                    ? 'bg-amber-500/15 text-amber-400 border border-amber-500/40'
                    : 'bg-muted text-muted-foreground border border-border'
                }`}
              >
                🛞 {nextPit.tireChange ? 'タイヤ交換あり' : 'タイヤ交換なし'}
              </span>
            )}
          </div>

          <div>
            <div className="font-display text-5xl font-bold leading-none">{nextPit.pitClock ?? '—'}</div>
            <div className="mt-1 text-xs text-muted-foreground font-mono">
              {[
                t != null ? `あと ${t.lapsUntilNextPit} 周` : '',
                t?.nextPitInSec != null ? `約 ${formatMinSec(t.nextPitInSec)} 後` : '',
                t?.nextPlannedPitLap != null ? `計画 Lap ${t.nextPlannedPitLap}` : '',
              ]
                .filter(Boolean)
                .join(' ／ ') || '—'}
            </div>
          </div>

          {/* 交代（誰から誰へ） */}
          <div className="border-t border-border/70 pt-3">
            <div className="text-[10px] tracking-[0.16em] text-muted-foreground mb-1.5">交代 / ライダー</div>
            <div className="flex items-center gap-3 flex-wrap">
              <RiderChip name={riderName(currentRiderId)} color={riderColor(currentRiderId)} />
              <span className="font-display text-2xl text-muted-foreground">→</span>
              <RiderChip name={riderName(nextRiderId)} color={riderColor(nextRiderId)} />
              <span className="ml-auto text-xs text-muted-foreground font-mono">
                給油 {nextPit.refuelL != null ? `${nextPit.refuelL} L` : '—'}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 現在の走者 ＋ 交代カウントダウン（60分規定） */}
      <Card className="accent-bar">
        <CardContent className="p-4 space-y-3">
          <PanelLabel>Current Rider / 現在の走者</PanelLabel>
          <div className="flex items-center gap-2.5">
            <span className="inline-block h-7 w-1.5 rounded-sm shrink-0" style={{ backgroundColor: riderColor(currentRiderId) }} />
            <span className="font-display text-4xl font-bold truncate">{riderName(currentRiderId)}</span>
          </div>
          {/* 残り時間を大きく・走行開始時刻を小さく */}
          <RiderStintTimer startedAt={riderStartedAt} variant="hero" />
          <div className="text-xs text-muted-foreground font-mono">
            {currentStint ? `第${currentStint.stintNumber}スティント ${t?.lapsInStint ?? 0}周目` : 'スティント未開始'}
            {t?.recent3Avg != null ? ` ・ 直近3周平均 ${formatLapTime(t.recent3Avg)}` : ''}
          </div>
        </CardContent>
      </Card>

      {/* ペース */}
      <Card>
        <CardContent className="p-4">
          <PanelLabel className="mb-1">Pace / ペース</PanelLabel>
          <div className="divide-y divide-border/60">
            <PaceRow label="直近3周平均" value={formatLapTime(t?.recent3Avg)} highlight />
            <PaceRow label="ドライ平均" value={formatLapTime(t?.avgDry)} />
            <PaceRow label="ウェット平均" value={formatLapTime(t?.avgWet)} />
            <PaceRow label="想定ラップ" value={formatLapTime(t?.assumedLapSec)} />
          </div>
        </CardContent>
      </Card>

      {/* 総合順位 */}
      <StandingTile carno={carno} readOnly />

      {/* スケジュール全体 */}
      {plan?.race && <ScheduleTimeline plan={plan} />}
    </div>
  );
}

// 次ピットの給油量・タイヤ交換・予定時刻を計画から求める。
// 現在の実スティント番号 +1 を「次に入るスティント」とみなす（live.ts の nextPlannedRider と同じ規約）。
function computeNextPit(
  currentStintNumber: number,
  plan: PlanResponse | null,
  fallbackTire: boolean | null,
): { refuelL: number | null; tireChange: boolean | null; pitClock: string | null } {
  const nextNo = currentStintNumber + 1;
  let refuelL: number | null = null;
  let tireChange: boolean | null = fallbackTire;
  let pitClock: string | null = null;

  if (plan?.race && plan.stints.length > 0 && plan.laps.length > 0) {
    const nextStint = plan.stints.find((s) => s.stintNumber === nextNo);
    if (nextStint) {
      refuelL = nextStint.refuelL;
      tireChange = nextStint.tireChange;
    }
    const nextLaps = plan.laps.filter((l) => l.stintNumber === nextNo).sort((a, b) => a.lapNumber - b.lapNumber);
    if (nextLaps.length > 0) {
      const first = nextLaps[0];
      // 走行開始 = 先頭周の累積 − 先頭周のタイム、ピット開始 = その pitLossSec 前
      const runStartSec = first.cumTimeSec - first.plannedTimeSec;
      const pitStartSec = Math.max(0, runStartSec - plan.race.pitLossSec);
      pitClock = makeFmtTime(plan.race.startedAt)(pitStartSec);
    }
  }
  return { refuelL, tireChange, pitClock };
}

function RiderChip({ name, color }: { name: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span className="inline-block h-4 w-1.5 rounded-sm shrink-0" style={{ backgroundColor: color }} />
      <span className="font-display text-2xl font-bold">{name}</span>
    </span>
  );
}

function PaceRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`font-mono text-base ${highlight ? 'font-bold' : 'text-muted-foreground'}`}>{value}</span>
    </div>
  );
}
