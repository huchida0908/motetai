'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatLapTime, formatMinSec, parseLapTime } from '@/lib/time';
import { CONDITION_LABEL, CONDITION_COLOR } from '@/lib/constants';
import { expandPlan, computePlanState, type PlanStintInput } from '@/lib/plan-calc';

interface Rider {
  id: string;
  name: string;
  expectedLapTime: number;
  color: string | null;
}
interface PlanStint {
  id: string;
  stintNumber: number;
  riderId: string | null;
  plannedLaps: number;
  targetLapSec: number | null;
  refuelL: number; // ピットでの給油量（追加L）
  startFuelL: number | null; // 持ち越し計算後のスティント開始燃料
  note: string | null;
}
interface PlanLap {
  lapNumber: number;
  lapInStint: number;
  stintNumber: number;
  riderId: string | null;
  condition: string;
  outIn: 'OUT' | 'IN' | null;
  plannedTimeSec: number;
  isOverride: boolean;
  fuelUsedL: number;
  fuelRemainingL: number;
  cumTimeSec: number;
}
interface PlanResponse {
  race: {
    id: string;
    raceName: string;
    raceDurationMin: number;
    startedAt: string | null;
    tankCapacityL: number;
    startFuelL: number;
    pitLossSec: number;
    maxStintLap: number;
    fuelRateDry: number;
    fuelRateWet: number;
    fuelRateSc: number;
    fuelRateOutIn: number;
    assumedLapSec: number;
    assumedOutLapSec: number;
    assumedInLapSec: number;
    assumedWetLapSec: number;
    assumedScLapSec: number;
  } | null;
  riders: Rider[];
  stints: PlanStint[];
  laps: PlanLap[];
  totals: { totalLaps: number; totalTimeSec: number; pitCount: number; fuelShortStints: number[]; raceDurationSec: number };
  overrideCount: number;
  progress?: {
    maxActualLap: number;
    raceStarted: boolean;
    frozenUpTo: number; // この lapNumber までの計画周は保存しても変更されない
    boundaryStintNumber: number | null; // 走行中（凍結境界）のスティント番号
    frozenLapsInBoundary: number | null; // 境界スティント内の走行済み周数
  };
}
interface ActualPoint {
  lap: number;
  timeSec: number;
  condition: string;
  outIn: string | null;
  riderId: string | null;
}

// 編集用のスティント行（入力は文字列で保持し、保存時に数値へ変換）
interface DraftStint {
  key: string;
  riderId: string;
  plannedLaps: string;
  targetLap: string; // "2:26.271" / "146.271"
  refuelL: string;
}

let draftSeq = 0;
const nextKey = () => `draft-${++draftSeq}`;

export default function PlanPage() {
  const [tab, setTab] = useState<'edit' | 'compare'>('edit');
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [drafts, setDrafts] = useState<DraftStint[]>([]);
  const [dirty, setDirty] = useState(false);
  const [keepOverrides, setKeepOverrides] = useState(true);
  const [bulkRefuel, setBulkRefuel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState('');

  // 周単位の上書き編集
  const [editingLap, setEditingLap] = useState<number | null>(null);
  const [editTime, setEditTime] = useState('');
  const [editCondition, setEditCondition] = useState('D');

  // 比較タブ用の実績
  const [actual, setActual] = useState<ActualPoint[] | null>(null);

  const applyPlan = useCallback((data: PlanResponse) => {
    setPlan(data);
    setDrafts(
      data.stints.map((s) => ({
        key: nextKey(),
        riderId: s.riderId ?? '',
        plannedLaps: String(s.plannedLaps),
        targetLap: s.targetLapSec != null ? formatLapTime(s.targetLapSec) : '',
        refuelL: String(s.refuelL),
      })),
    );
    setDirty(false);
  }, []);

  const loadPlan = useCallback(async () => {
    try {
      const res = await fetch('/api/plan', { cache: 'no-store' });
      if (!res.ok) throw new Error('計画の取得に失敗しました');
      applyPlan(await res.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '不明なエラー');
    }
  }, [applyPlan]);

  const loadActual = useCallback(async () => {
    try {
      const res = await fetch('/api/live', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      setActual((data.series ?? []) as ActualPoint[]);
    } catch {
      // 比較タブの補助データなので黙って握りつぶす
    }
  }, []);

  useEffect(() => {
    loadPlan();
  }, [loadPlan]);

  // 比較タブ表示中は実績を 10 秒ごとに更新
  useEffect(() => {
    if (tab !== 'compare') return;
    loadActual();
    const id = setInterval(loadActual, 10000);
    return () => clearInterval(id);
  }, [tab, loadActual]);

  const riderName = useCallback(
    (id: string | null) => plan?.riders.find((r) => r.id === id)?.name ?? '-',
    [plan],
  );

  const flash = (text: string) => {
    setMsg(text);
    setTimeout(() => setMsg(''), 2500);
  };

  // ── レース中の凍結境界 ──────────────────────────
  // レース開始済み＆実績ありなら、保存時に消化済み周の計画を凍結する（freezeCompleted）。
  const freezeActive = (plan?.progress?.raceStarted ?? false) && (plan?.progress?.maxActualLap ?? 0) > 0;
  // 凍結境界のスティント番号（これ以前の行はロック表示）。凍結対象が無ければ 0
  const boundaryNo = freezeActive && (plan?.progress?.frozenUpTo ?? 0) > 0 ? plan?.progress?.boundaryStintNumber ?? 0 : 0;
  const frozenUpTo = freezeActive ? plan?.progress?.frozenUpTo ?? 0 : 0;

  // ── draft の燃料プレビュー ──────────────────────────
  // 未保存の編集内容から開始燃料/終了時残量をリアルタイム計算する（plan-calc は純関数）。
  // 入力が数値として不正な間は null（表示は「-」）。周単位の手動上書きは未適用（保存後にサーバー値で表示）。
  const draftFuel = useMemo(() => {
    const race = plan?.race;
    if (!race || drafts.length === 0) return null;
    const stints: PlanStintInput[] = [];
    for (let i = 0; i < drafts.length; i++) {
      const d = drafts[i];
      const laps = Number(d.plannedLaps);
      const refuel = i === 0 || d.refuelL.trim() === '' ? 0 : Number(d.refuelL);
      if (!Number.isInteger(laps) || laps < 1 || !Number.isFinite(refuel) || refuel < 0) return null;
      stints.push({
        stintNumber: i + 1,
        riderId: d.riderId || null,
        plannedLaps: laps,
        targetLapSec: d.targetLap.trim() === '' ? null : parseLapTime(d.targetLap),
        refuelL: refuel,
      });
    }
    const expanded = expandPlan(stints, race).map((l) => ({ ...l, isOverride: false }));
    const { laps, totals, stintStartFuel } = computePlanState(
      expanded,
      stints,
      { fuelRateDry: race.fuelRateDry, fuelRateWet: race.fuelRateWet, fuelRateSc: race.fuelRateSc, fuelRateOutIn: race.fuelRateOutIn },
      { pitLossSec: race.pitLossSec, startFuelL: race.startFuelL, tankCapacityL: race.tankCapacityL },
    );
    // 各スティント最終周の残量 = スティント終了時残L（laps は lapNumber 昇順）
    const stintEndFuel: Record<number, number> = {};
    for (const l of laps) stintEndFuel[l.stintNumber] = l.fuelRemainingL;
    return { stintStartFuel, stintEndFuel, fuelShortStints: totals.fuelShortStints };
  }, [drafts, plan]);

  // ── スティント編集操作 ──────────────────────────
  const updateDraft = (key: string, patch: Partial<DraftStint>) => {
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));
    setDirty(true);
  };
  const moveDraft = (key: string, dir: -1 | 1) => {
    setDrafts((prev) => {
      const idx = prev.findIndex((d) => d.key === key);
      const to = idx + dir;
      if (idx < 0 || to < 0 || to >= prev.length) return prev;
      // 凍結境界（走行済み/走行中スティント）へは移動不可
      if (to < boundaryNo) return prev;
      const next = [...prev];
      [next[idx], next[to]] = [next[to], next[idx]];
      return next;
    });
    setDirty(true);
  };
  const removeDraft = (key: string) => {
    setDrafts((prev) => prev.filter((d) => d.key !== key));
    setDirty(true);
  };
  const addDraft = () => {
    if (!plan?.race) return;
    const riders = plan.riders;
    const rider = riders.length > 0 ? riders[drafts.length % riders.length] : null;
    setDrafts((prev) => [
      ...prev,
      {
        key: nextKey(),
        riderId: rider?.id ?? '',
        plannedLaps: String(plan.race!.maxStintLap),
        targetLap: rider ? formatLapTime(rider.expectedLapTime) : '',
        // 給油量（追加L）。ST1 は未使用（スタート燃料を使う）なので 0
        refuelL: prev.length === 0 ? '0' : String(plan.race!.tankCapacityL),
      },
    ]);
    setDirty(true);
  };

  // 給油量を全ピット（ST2 以降）へ一括適用
  const applyBulkRefuel = () => {
    const v = Number(bulkRefuel);
    if (!Number.isFinite(v) || v < 0) {
      setError('一括適用する給油量（L）は0以上の数値で入力してください');
      return;
    }
    setDrafts((prev) => prev.map((d, i) => (i === 0 ? d : { ...d, refuelL: String(v) })));
    setDirty(true);
    setError(null);
  };

  const savePlan = useCallback(async () => {
    if (!plan?.race) return;
    const stints = [];
    for (let i = 0; i < drafts.length; i++) {
      const d = drafts[i];
      const laps = Number(d.plannedLaps);
      // ST1 の給油量は未使用。空欄は 0（無給油ピット）として扱う
      const refuel = i === 0 || d.refuelL.trim() === '' ? 0 : Number(d.refuelL);
      const target = d.targetLap.trim() === '' ? null : parseLapTime(d.targetLap);
      if (!Number.isInteger(laps) || laps < 1) {
        setError(`スティント${i + 1}: 周回数は1以上の整数で入力してください`);
        return;
      }
      if (!Number.isFinite(refuel) || refuel < 0) {
        setError(`スティント${i + 1}: 給油量（L）は0以上で入力してください`);
        return;
      }
      if (d.targetLap.trim() !== '' && target == null) {
        setError(`スティント${i + 1}: 目標ラップの形式が不正です（例 2:26.271）`);
        return;
      }
      stints.push({
        stintNumber: i + 1,
        riderId: d.riderId || null,
        plannedLaps: laps,
        targetLapSec: target,
        refuelL: refuel,
      });
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/plan', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stints,
          keepOverrides: keepOverrides && (plan.overrideCount ?? 0) > 0,
          freezeCompleted: freezeActive,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? '保存に失敗しました');
      applyPlan(data);
      flash('計画を保存しました');
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました');
    } finally {
      setBusy(false);
    }
  }, [plan, drafts, keepOverrides, freezeActive, applyPlan]);

  const generatePlan = useCallback(async () => {
    if (!confirm('現在の計画（手動上書き含む）を破棄して自動生成します。よろしいですか？')) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/plan/generate', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? '自動生成に失敗しました');
      applyPlan(data);
      flash('初期計画を自動生成しました');
    } catch (e) {
      setError(e instanceof Error ? e.message : '自動生成に失敗しました');
    } finally {
      setBusy(false);
    }
  }, [applyPlan]);

  // ── 周単位の上書き ──────────────────────────
  const startEditLap = (lap: PlanLap) => {
    setEditingLap(lap.lapNumber);
    setEditTime(formatLapTime(lap.plannedTimeSec));
    setEditCondition(lap.condition);
  };
  const submitLapOverride = useCallback(async () => {
    if (editingLap == null) return;
    const timeSec = parseLapTime(editTime);
    if (timeSec == null || timeSec <= 0) {
      setError('タイムの形式が不正です（例 2:26.271）');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/plan/laps', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lapNumber: editingLap, plannedTimeSec: timeSec, condition: editCondition }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? '上書きに失敗しました');
      applyPlan(data);
      setEditingLap(null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '上書きに失敗しました');
    } finally {
      setBusy(false);
    }
  }, [editingLap, editTime, editCondition, applyPlan]);

  const clearLapOverride = useCallback(
    async (lapNumber: number) => {
      setBusy(true);
      try {
        const res = await fetch('/api/plan/laps', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lapNumber, clear: true }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? '解除に失敗しました');
        applyPlan(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : '解除に失敗しました');
      } finally {
        setBusy(false);
      }
    },
    [applyPlan],
  );

  // ── 比較データ ──────────────────────────
  const comparison = useMemo(() => {
    if (!plan || !actual) return null;
    const actualByLap = new Map(actual.map((a) => [a.lap, a]));
    let cumDiff = 0;
    const rows = plan.laps.map((p) => {
      const a = actualByLap.get(p.lapNumber) ?? null;
      const diff = a ? a.timeSec - p.plannedTimeSec : null;
      if (diff != null) cumDiff += diff;
      return { plan: p, actual: a, diff, cumDiff: a ? cumDiff : null };
    });
    // 計画に無い実績周（計画超過分）も末尾に足す
    const extra = actual.filter((a) => a.lap > plan.laps.length);
    return {
      rows,
      extra,
      actualLaps: actual.length,
      cumDiffSec: cumDiff,
      planPitLaps: plan.laps.filter((l) => l.outIn === 'IN').map((l) => l.lapNumber),
      actualPitLaps: actual.filter((a) => a.outIn === 'IN').map((a) => a.lap),
    };
  }, [plan, actual]);

  if (!plan) return <div className="text-muted-foreground">読み込み中…</div>;
  if (!plan.race) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">計画</h1>
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            アクティブなレースがありません。「設定」でレースを作成するか、シードを投入してください。
          </CardContent>
        </Card>
      </div>
    );
  }

  const totals = plan.totals;
  const overTime = totals.totalTimeSec - totals.raceDurationSec;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">計画</h1>
          <p className="text-muted-foreground text-sm">{plan.race.raceName} ／ 周単位の計画作成と実績比較</p>
        </div>
        <div className="flex gap-1 rounded-md border p-1">
          {(['edit', 'compare'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
                tab === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t === 'edit' ? '計画編集' : '計画 vs 実績'}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive border border-destructive/30 rounded-md px-4 py-2 text-sm">{error}</div>
      )}
      {msg && <div className="bg-emerald-500/10 text-emerald-700 border border-emerald-500/30 rounded-md px-4 py-2 text-sm">{msg}</div>}

      {tab === 'edit' ? (
        <>
          {/* レース中の凍結案内 */}
          {freezeActive && (
            <div className="bg-primary/10 border border-primary/30 rounded-md px-4 py-2 text-sm">
              レース中: Lap {plan.progress!.maxActualLap} まで走行済み。保存しても走行済みの計画周
              {frozenUpTo > 0 ? `（Lap ${frozenUpTo} まで）` : ''}は変更されません。
              走行済み・走行中スティントはロックされ、これから先だけ組み直せます
            </div>
          )}

          {/* 集計バー */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummaryTile label="計画周回" value={`${totals.totalLaps} 周`} />
            <SummaryTile
              label="計画所要時間"
              value={formatMinSec(totals.totalTimeSec)}
              sub={`レース時間 ${formatMinSec(totals.raceDurationSec)}`}
            />
            <SummaryTile
              label="対レース時間"
              value={`${overTime >= 0 ? '+' : '−'}${formatMinSec(Math.abs(overTime))}`}
              warn={overTime < -120}
              sub={overTime >= 0 ? '時間超過ぶんは走り切りでOK' : overTime < -120 ? '2分以上の余りあり: 周回を追加検討' : ''}
            />
            {(() => {
              const fuelShort = draftFuel?.fuelShortStints ?? totals.fuelShortStints;
              return (
                <SummaryTile
                  label="ピット回数"
                  value={`${totals.pitCount} 回`}
                  warn={fuelShort.length > 0}
                  sub={fuelShort.length > 0 ? `燃料不足: ST${fuelShort.join(', ')}` : ''}
                />
              );
            })()}
          </div>

          {/* スティント編集 */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-lg">スティント計画</CardTitle>
                <CardDescription>誰が・何周・目標ラップ・給油量。保存すると周単位に展開されます</CardDescription>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={generatePlan}
                  disabled={busy || freezeActive}
                  title={freezeActive ? 'レース開始後は自動生成できません（計画編集で残りを調整してください）' : undefined}
                >
                  自動生成
                </Button>
                <Button onClick={savePlan} disabled={busy || drafts.length === 0}>
                  {dirty ? '保存（再展開）' : '保存済み'}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {(plan.overrideCount ?? 0) > 0 && (
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={keepOverrides}
                    onChange={(e) => setKeepOverrides(e.target.checked)}
                    className="h-4 w-4"
                  />
                  再展開時に周単位の手動上書き {plan.overrideCount} 件を保持する（同じ周番号に再適用）
                  {freezeActive ? '。走行済み周の上書きは常に保持されます' : ''}
                </label>
              )}

              {/* 給油量の一括適用（ST2 以降の全ピット） */}
              <div className="flex items-end gap-2 flex-wrap border rounded-md p-3 bg-muted/30">
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">給油量（全ピット共通・追加L）</label>
                  <Input
                    inputMode="decimal"
                    value={bulkRefuel}
                    onChange={(e) => setBulkRefuel(e.target.value)}
                    placeholder={`満タン ${plan.race!.tankCapacityL}`}
                    className="w-28 h-9 font-mono"
                  />
                </div>
                <Button variant="outline" onClick={applyBulkRefuel} disabled={drafts.length < 2}>
                  全ピットに適用
                </Button>
                <p className="text-xs text-muted-foreground pb-2">
                  ピットイン予定のたびに残燃料へ加算されます（タンク容量 {plan.race!.tankCapacityL}L でキャップ）
                </p>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-muted-foreground border-b">
                    <tr>
                      <th className="text-left py-2 px-2">ST</th>
                      <th className="text-left py-2 px-2">ライダー</th>
                      <th className="text-left py-2 px-2">周回数</th>
                      <th className="text-left py-2 px-2">目標ラップ</th>
                      <th className="text-left py-2 px-2">給油量L</th>
                      <th className="text-right py-2 px-2">開始燃料(自動)</th>
                      <th className="text-right py-2 px-2">終了時残L</th>
                      <th className="py-2 px-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {drafts.map((d, i) => {
                      const stNo = i + 1;
                      const isFrozen = stNo < boundaryNo; // 消化済み: 全ロック
                      const isBoundary = stNo === boundaryNo; // 走行中: 周回数・目標のみ編集可
                      return (
                      <tr key={d.key} className={`border-b border-border/50 ${isFrozen || isBoundary ? 'bg-muted/40' : ''}`}>
                        <td className="py-1.5 px-2 font-mono whitespace-nowrap">
                          {stNo}
                          {isFrozen && (
                            <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground align-middle">走行済</span>
                          )}
                          {isBoundary && (
                            <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] bg-primary/15 text-primary align-middle">走行中</span>
                          )}
                        </td>
                        <td className="py-1.5 px-2">
                          <select
                            value={d.riderId}
                            disabled={isFrozen || isBoundary}
                            onChange={(e) => updateDraft(d.key, { riderId: e.target.value })}
                            className="h-9 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-60"
                          >
                            <option value="">（未定）</option>
                            {plan.riders.map((r) => (
                              <option key={r.id} value={r.id}>{r.name}</option>
                            ))}
                          </select>
                        </td>
                        <td className="py-1.5 px-2">
                          <Input
                            inputMode="numeric"
                            value={d.plannedLaps}
                            disabled={isFrozen}
                            title={isBoundary && plan.progress?.frozenLapsInBoundary != null ? `${plan.progress.frozenLapsInBoundary}周走行済み（未満には縮められません）` : undefined}
                            onChange={(e) => updateDraft(d.key, { plannedLaps: e.target.value })}
                            className="w-20 h-9 font-mono"
                          />
                        </td>
                        <td className="py-1.5 px-2">
                          <Input
                            value={d.targetLap}
                            disabled={isFrozen}
                            placeholder={`想定 ${formatLapTime(plan.race!.assumedLapSec)}`}
                            onChange={(e) => updateDraft(d.key, { targetLap: e.target.value })}
                            className="w-32 h-9 font-mono"
                          />
                        </td>
                        <td className="py-1.5 px-2">
                          {i === 0 ? (
                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                              ─（スタート {plan.race!.startFuelL}L）
                            </span>
                          ) : (
                            <Input
                              inputMode="decimal"
                              value={d.refuelL}
                              disabled={isFrozen || isBoundary}
                              onChange={(e) => updateDraft(d.key, { refuelL: e.target.value })}
                              className="w-20 h-9 font-mono"
                            />
                          )}
                        </td>
                        <td className="py-1.5 px-2 text-right font-mono text-muted-foreground">
                          {draftFuel?.stintStartFuel[i + 1] != null ? `${draftFuel.stintStartFuel[i + 1].toFixed(2)} L` : '-'}
                        </td>
                        <td
                          className={`py-1.5 px-2 text-right font-mono ${
                            draftFuel != null && (draftFuel.stintEndFuel[i + 1] ?? 0) < 0
                              ? 'text-destructive font-bold'
                              : 'text-muted-foreground'
                          }`}
                        >
                          {draftFuel?.stintEndFuel[i + 1] != null ? `${draftFuel.stintEndFuel[i + 1].toFixed(2)} L` : '-'}
                        </td>
                        <td className="py-1.5 px-2 whitespace-nowrap">
                          {!(isFrozen || isBoundary) && (
                            <>
                              <Button variant="ghost" size="sm" onClick={() => moveDraft(d.key, -1)} disabled={i <= boundaryNo}>↑</Button>
                              <Button variant="ghost" size="sm" onClick={() => moveDraft(d.key, 1)} disabled={i === drafts.length - 1}>↓</Button>
                              <Button variant="ghost" size="sm" className="text-destructive" onClick={() => removeDraft(d.key)}>削除</Button>
                            </>
                          )}
                        </td>
                      </tr>
                      );
                    })}
                    {drafts.length === 0 && (
                      <tr>
                        <td colSpan={8} className="text-center py-6 text-muted-foreground">
                          スティントがありません。「自動生成」または「＋スティント追加」から作成してください
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <Button variant="outline" onClick={addDraft}>＋ スティント追加</Button>
              {dirty && <p className="text-xs text-amber-600">未保存の変更があります。「保存（再展開）」で周単位計画に反映されます</p>}
            </CardContent>
          </Card>

          {/* 周単位展開テーブル */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">周単位の計画（展開結果）</CardTitle>
              <CardDescription>
                行の「編集」で特定周だけタイム・路面を上書きできます（橙 = 上書き済み）
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto max-h-[32rem] overflow-y-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-muted-foreground border-b sticky top-0 bg-card">
                    <tr>
                      <th className="text-left py-2 px-2">Lap</th>
                      <th className="text-left py-2 px-2">ST</th>
                      <th className="text-left py-2 px-2">走者</th>
                      <th className="text-left py-2 px-2">区分</th>
                      <th className="text-left py-2 px-2">路面</th>
                      <th className="text-right py-2 px-2">計画タイム</th>
                      <th className="text-right py-2 px-2">残L</th>
                      <th className="text-right py-2 px-2">累積</th>
                      <th className="py-2 px-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.laps.map((l) => {
                      const isFrozenLap = l.lapNumber <= frozenUpTo;
                      return (
                      <tr
                        key={l.lapNumber}
                        className={`border-b border-border/50 ${l.isOverride ? 'bg-amber-500/10' : isFrozenLap ? 'bg-muted/40' : ''}`}
                      >
                        <td className="py-1 px-2 font-mono">{l.lapNumber}</td>
                        <td className="py-1 px-2 font-mono">{l.stintNumber}</td>
                        <td className="py-1 px-2">{riderName(l.riderId)}</td>
                        <td className="py-1 px-2 text-xs">{l.outIn ?? ''}</td>
                        <td className="py-1 px-2">
                          {editingLap === l.lapNumber ? (
                            <select
                              value={editCondition}
                              onChange={(e) => setEditCondition(e.target.value)}
                              className="h-8 rounded-md border border-input bg-background px-1 text-xs"
                            >
                              {['D', 'W', 'SC'].map((c) => (
                                <option key={c} value={c}>{CONDITION_LABEL[c]}</option>
                              ))}
                            </select>
                          ) : (
                            <span
                              className="inline-block px-2 py-0.5 rounded-full text-xs text-white whitespace-nowrap"
                              style={{ backgroundColor: CONDITION_COLOR[l.condition] ?? '#6b7280' }}
                            >
                              {CONDITION_LABEL[l.condition] ?? l.condition}
                            </span>
                          )}
                        </td>
                        <td className="py-1 px-2 text-right font-mono">
                          {editingLap === l.lapNumber ? (
                            <Input
                              value={editTime}
                              onChange={(e) => setEditTime(e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && submitLapOverride()}
                              className="w-28 h-8 font-mono text-right inline-block"
                              autoFocus
                            />
                          ) : (
                            formatLapTime(l.plannedTimeSec)
                          )}
                        </td>
                        <td className={`py-1 px-2 text-right font-mono ${l.fuelRemainingL < 0 ? 'text-destructive font-bold' : ''}`}>
                          {l.fuelRemainingL.toFixed(2)}
                        </td>
                        <td className="py-1 px-2 text-right font-mono text-xs text-muted-foreground">{formatMinSec(l.cumTimeSec)}</td>
                        <td className="py-1 px-2 whitespace-nowrap text-right">
                          {isFrozenLap ? (
                            <span className="text-[10px] text-muted-foreground">走行済</span>
                          ) : editingLap === l.lapNumber ? (
                            <>
                              <Button variant="ghost" size="sm" onClick={submitLapOverride} disabled={busy}>確定</Button>
                              <Button variant="ghost" size="sm" onClick={() => setEditingLap(null)}>取消</Button>
                            </>
                          ) : (
                            <>
                              <Button variant="ghost" size="sm" onClick={() => startEditLap(l)}>編集</Button>
                              {l.isOverride && (
                                <Button variant="ghost" size="sm" className="text-amber-600" onClick={() => clearLapOverride(l.lapNumber)}>
                                  解除
                                </Button>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                      );
                    })}
                    {plan.laps.length === 0 && (
                      <tr>
                        <td colSpan={9} className="text-center py-6 text-muted-foreground">計画を保存すると周単位に展開されます</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        <>
          {/* 比較サマリー */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummaryTile
              label="消化"
              value={`${comparison?.actualLaps ?? 0} / ${totals.totalLaps} 周`}
              sub="実績 / 計画"
            />
            <SummaryTile
              label="対計画 累積"
              value={
                comparison && comparison.actualLaps > 0
                  ? `${comparison.cumDiffSec <= 0 ? '+' : '−'}${formatMinSec(Math.abs(comparison.cumDiffSec))}`
                  : '-'
              }
              sub="＋=計画より速い"
              good={comparison ? comparison.cumDiffSec <= 0 : undefined}
            />
            <SummaryTile
              label="計画ピット周"
              value={comparison?.planPitLaps.length ? comparison.planPitLaps.join(', ') : '-'}
              sub="Lap（IN 周）"
            />
            <SummaryTile
              label="実績ピット周"
              value={comparison?.actualPitLaps.length ? comparison.actualPitLaps.join(', ') : '-'}
              sub="Lap（IN 周）"
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">周単位の計画 vs 実績</CardTitle>
              <CardDescription>差 = 実績 − 計画（負 = 計画より速い）。10 秒ごとに実績を自動更新</CardDescription>
            </CardHeader>
            <CardContent>
              {!comparison ? (
                <div className="py-6 text-center text-muted-foreground text-sm">実績データを読み込み中…</div>
              ) : (
                <div className="overflow-x-auto max-h-[36rem] overflow-y-auto">
                  <table className="min-w-full text-sm">
                    <thead className="text-muted-foreground border-b sticky top-0 bg-card">
                      <tr>
                        <th className="text-left py-2 px-2">Lap</th>
                        <th className="text-left py-2 px-2">計画走者</th>
                        <th className="text-left py-2 px-2">実績走者</th>
                        <th className="text-left py-2 px-2">区分</th>
                        <th className="text-right py-2 px-2">計画</th>
                        <th className="text-right py-2 px-2">実績</th>
                        <th className="text-right py-2 px-2">差</th>
                        <th className="text-right py-2 px-2">累積差</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comparison.rows.map(({ plan: p, actual: a, diff, cumDiff }) => (
                        <tr
                          key={p.lapNumber}
                          className={`border-b border-border/50 ${p.outIn ? 'bg-muted/40' : ''} ${a ? '' : 'text-muted-foreground'}`}
                        >
                          <td className="py-1 px-2 font-mono">{p.lapNumber}</td>
                          <td className="py-1 px-2">{riderName(p.riderId)}</td>
                          <td className="py-1 px-2">{a ? riderName(a.riderId) : '-'}</td>
                          <td className="py-1 px-2 text-xs">
                            {p.outIn ?? ''}
                            {a?.outIn && a.outIn !== p.outIn ? (
                              <span className="text-amber-600 ml-1">実績:{a.outIn}</span>
                            ) : null}
                          </td>
                          <td className="py-1 px-2 text-right font-mono">{formatLapTime(p.plannedTimeSec)}</td>
                          <td className="py-1 px-2 text-right font-mono">{a ? formatLapTime(a.timeSec) : '-'}</td>
                          <td className={`py-1 px-2 text-right font-mono ${diffClass(diff)}`}>
                            {diff != null ? `${diff <= 0 ? '−' : '+'}${Math.abs(diff).toFixed(3)}` : '-'}
                          </td>
                          <td className={`py-1 px-2 text-right font-mono ${diffClass(cumDiff)}`}>
                            {cumDiff != null ? `${cumDiff <= 0 ? '−' : '+'}${formatMinSec(Math.abs(cumDiff))}` : '-'}
                          </td>
                        </tr>
                      ))}
                      {comparison.extra.map((a) => (
                        <tr key={`extra-${a.lap}`} className="border-b border-border/50 bg-emerald-500/10">
                          <td className="py-1 px-2 font-mono">{a.lap}</td>
                          <td className="py-1 px-2 text-muted-foreground">計画超過</td>
                          <td className="py-1 px-2">{riderName(a.riderId)}</td>
                          <td className="py-1 px-2 text-xs">{a.outIn ?? ''}</td>
                          <td className="py-1 px-2 text-right font-mono">-</td>
                          <td className="py-1 px-2 text-right font-mono">{formatLapTime(a.timeSec)}</td>
                          <td className="py-1 px-2 text-right">-</td>
                          <td className="py-1 px-2 text-right">-</td>
                        </tr>
                      ))}
                      {comparison.rows.length === 0 && (
                        <tr>
                          <td colSpan={8} className="text-center py-6 text-muted-foreground">
                            計画がありません。「計画編集」タブで作成してください
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// 差分の色分け: 負（計画より速い）= 緑、正 = 赤
function diffClass(diff: number | null): string {
  if (diff == null) return '';
  return diff <= 0 ? 'text-emerald-600' : 'text-destructive';
}

function SummaryTile({ label, value, sub, warn, good }: { label: string; value: string; sub?: string; warn?: boolean; good?: boolean }) {
  return (
    <Card className={warn ? 'border-destructive/50' : ''}>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-xl font-bold font-mono ${warn ? 'text-destructive' : good === true ? 'text-emerald-600' : good === false ? 'text-destructive' : ''}`}>
          {value}
        </div>
        {sub ? <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div> : null}
      </CardContent>
    </Card>
  );
}
