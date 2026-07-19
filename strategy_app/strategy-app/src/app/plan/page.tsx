'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatLapTime, formatMinSec, parseLapTime } from '@/lib/time';
import { expandPlan, computePlanState, applyOverrides, type PlanStintInput } from '@/lib/plan-calc';
import { LapCompareGrid, type GridRow, type CellPatch } from '@/components/plan/LapCompareGrid';
import { FuelChart, type FuelPoint } from '@/components/LapChart';

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
  tireChange: boolean; // スティント開始時のピットインでタイヤ交換するか
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
    frozenUpTo: number;
    boundaryStintNumber: number | null;
    frozenLapsInBoundary: number | null;
  };
}
// GET /api/laps の 1 行（インライン編集用に id を持つ）
interface ActualLapRow {
  id: string;
  lapNumber: number;
  lapTimeSec: number;
  condition: string;
  outIn: 'OUT' | 'IN' | null;
  riderId: string | null;
  fuelUsedL: number | null;
  stintId: string | null;
  stintNumber: number | null;
}

// 編集用のスティント行（入力は文字列で保持し、保存時に数値へ変換）
interface DraftStint {
  key: string;
  riderId: string;
  plannedLaps: string;
  targetLap: string; // "2:26.271" / "146.271"
  refuelL: string;
  tireChange: boolean;
}

// 周単位の staged 編集。値が undefined のキーは「その周を編集していない」を意味する
interface PlanLapEdit {
  riderId?: string | null;
  condition?: string;
  timeStr?: string;
}
interface ActualEdit {
  riderId?: string | null;
  condition?: string;
  outIn?: 'OUT' | 'IN' | null;
  timeStr?: string;
}

type View = 'plan' | 'actual' | 'compare';

let draftSeq = 0;
const nextKey = () => `draft-${++draftSeq}`;

export default function PlanPage() {
  const [view, setView] = useState<View>('plan');
  const [editing, setEditing] = useState(false);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [drafts, setDrafts] = useState<DraftStint[]>([]);
  const [dirty, setDirty] = useState(false);
  const [keepOverrides, setKeepOverrides] = useState(true);
  const [bulkRefuel, setBulkRefuel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState('');

  // 実績（/api/laps）と周単位の staged 編集
  const [actualLaps, setActualLaps] = useState<ActualLapRow[] | null>(null);
  const [planLapEdits, setPlanLapEdits] = useState<Record<number, PlanLapEdit>>({});
  const [actualEdits, setActualEdits] = useState<Record<number, ActualEdit>>({});
  const [savingLaps, setSavingLaps] = useState(false);

  const applyPlan = useCallback((data: PlanResponse) => {
    setPlan(data);
    setDrafts(
      data.stints.map((s) => ({
        key: nextKey(),
        riderId: s.riderId ?? '',
        plannedLaps: String(s.plannedLaps),
        targetLap: s.targetLapSec != null ? formatLapTime(s.targetLapSec) : '',
        refuelL: String(s.refuelL),
        tireChange: s.tireChange,
      })),
    );
    setDirty(false);
    setPlanLapEdits({});
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

  const loadActualLaps = useCallback(async () => {
    try {
      const res = await fetch('/api/laps', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      setActualLaps((data.laps ?? []) as ActualLapRow[]);
    } catch {
      // 補助データなので握りつぶす
    }
  }, []);

  useEffect(() => {
    loadPlan();
  }, [loadPlan]);

  // 実績/対比ビュー表示中は 10 秒ごとに実績を更新（編集中はポーリング停止して上書きを避ける）
  useEffect(() => {
    if (view === 'plan') return;
    loadActualLaps();
    if (editing) return;
    const id = setInterval(loadActualLaps, 10000);
    return () => clearInterval(id);
  }, [view, editing, loadActualLaps]);

  const riderName = useCallback(
    (id: string | null) => plan?.riders.find((r) => r.id === id)?.name ?? '-',
    [plan],
  );

  const tireByStint = useMemo(
    () => new Map((plan?.stints ?? []).map((s) => [s.stintNumber, s.tireChange])),
    [plan],
  );

  const flash = (text: string) => {
    setMsg(text);
    setTimeout(() => setMsg(''), 2500);
  };

  // ── レース中の凍結境界 ──────────────────────────
  const freezeActive = (plan?.progress?.raceStarted ?? false) && (plan?.progress?.maxActualLap ?? 0) > 0;
  const boundaryNo = freezeActive && (plan?.progress?.frozenUpTo ?? 0) > 0 ? plan?.progress?.boundaryStintNumber ?? 0 : 0;
  const frozenUpTo = freezeActive ? plan?.progress?.frozenUpTo ?? 0 : 0;

  // ── draft の燃料プレビュー ──────────────────────────
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
    // 保存済みの周単位手動上書き（タイム/路面）を同じ lapNumber に再適用する。
    // これで「未編集の draft ＝ 保存済み計画」となり、集計タイルの差分が編集ぶんだけを表す。
    // keepOverrides を外している間は保存時に上書きが消えるため、プレビューも上書きなしにする。
    const overrides =
      keepOverrides && (plan?.overrideCount ?? 0) > 0
        ? (plan?.laps ?? [])
            .filter((l) => l.isOverride)
            .map((l) => ({ lapNumber: l.lapNumber, plannedTimeSec: l.plannedTimeSec, condition: l.condition }))
        : [];
    const expanded = applyOverrides(expandPlan(stints, race), overrides);
    const { laps, totals, stintStartFuel } = computePlanState(
      expanded,
      stints,
      { fuelRateDry: race.fuelRateDry, fuelRateWet: race.fuelRateWet, fuelRateSc: race.fuelRateSc, fuelRateOutIn: race.fuelRateOutIn },
      { pitLossSec: race.pitLossSec, startFuelL: race.startFuelL, tankCapacityL: race.tankCapacityL },
    );
    const stintEndFuel: Record<number, number> = {};
    const fuelSeries: FuelPoint[] = [];
    const byRider = new Map<string, { laps: number; driveSec: number }>();
    let minFuelL = Infinity;
    for (const l of laps) {
      stintEndFuel[l.stintNumber] = l.fuelRemainingL;
      fuelSeries.push({ lap: l.lapNumber, fuelL: l.fuelRemainingL });
      if (l.fuelRemainingL < minFuelL) minFuelL = l.fuelRemainingL;
      if (l.riderId) {
        const b = byRider.get(l.riderId) ?? { laps: 0, driveSec: 0 };
        b.laps += 1;
        b.driveSec += l.plannedTimeSec;
        byRider.set(l.riderId, b);
      }
    }
    const raceDurationSec = race.raceDurationMin * 60;
    return {
      stintStartFuel,
      stintEndFuel,
      fuelShortStints: totals.fuelShortStints,
      totals, // { totalLaps, totalTimeSec, pitCount, fuelShortStints }
      overTime: totals.totalTimeSec - raceDurationSec, // 対レース時間（+超過 / −余り）
      fuelSeries, // 燃料グラフ用（周ごとの残L）
      minFuelL: laps.length > 0 ? minFuelL : null, // 最小燃料余裕（負ならガス欠）
      byRider, // ライダー別の担当周回・走行時間
    };
  }, [drafts, plan, keepOverrides]);

  // ── ライダー別サマリ（編集中の値と保存済みの差分） ──────────────────────────
  const riderSummary = useMemo(() => {
    if (!plan) return [];
    // 保存済み計画からのライダー別集計（＝差分の基準）。
    // draft 側と揃えるため、周の担当はスティントの走者で集計する（周単位の走者上書きは無視）。
    const stintRider = new Map(plan.stints.map((s) => [s.stintNumber, s.riderId]));
    const base = new Map<string, { laps: number; driveSec: number }>();
    for (const l of plan.laps) {
      const rid = stintRider.get(l.stintNumber) ?? l.riderId;
      if (!rid) continue;
      const b = base.get(rid) ?? { laps: 0, driveSec: 0 };
      b.laps += 1;
      b.driveSec += l.plannedTimeSec;
      base.set(rid, b);
    }
    const sim = draftFuel?.byRider ?? base;
    // スティント本数は現在の編集内容（drafts）から数える
    const stintCount = new Map<string, number>();
    for (const d of drafts) {
      if (d.riderId) stintCount.set(d.riderId, (stintCount.get(d.riderId) ?? 0) + 1);
    }
    return plan.riders
      .map((r) => {
        const s = sim.get(r.id) ?? { laps: 0, driveSec: 0 };
        const b = base.get(r.id) ?? { laps: 0, driveSec: 0 };
        return {
          rider: r,
          laps: s.laps,
          driveSec: s.driveSec,
          stints: stintCount.get(r.id) ?? 0,
          avgSec: s.laps > 0 ? s.driveSec / s.laps : null,
          dLaps: draftFuel ? s.laps - b.laps : 0,
        };
      })
      .filter((x) => x.laps > 0 || x.stints > 0);
  }, [plan, drafts, draftFuel]);

  // ── スティント編集操作 ──────────────────────────
  const updateDraft = (key: string, patch: Partial<DraftStint>) => {
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));
    setDirty(true);
  };
  // 周回数を ±1（1 未満にはしない）。数値でない入力途中は 0 起点で扱う
  const stepLaps = (key: string, cur: string, delta: number) => {
    const n = Number(cur);
    const base = Number.isFinite(n) ? Math.round(n) : 0;
    updateDraft(key, { plannedLaps: String(Math.max(1, base + delta)) });
  };
  const moveDraft = (key: string, dir: -1 | 1) => {
    setDrafts((prev) => {
      const idx = prev.findIndex((d) => d.key === key);
      const to = idx + dir;
      if (idx < 0 || to < 0 || to >= prev.length) return prev;
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
        refuelL: prev.length === 0 ? '0' : String(plan.race!.tankCapacityL),
        tireChange: false,
      },
    ]);
    setDirty(true);
  };

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
        tireChange: i > 0 && d.tireChange,
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

  // ── 周単位 staged 編集ハンドラ ──────────────────────────
  const mergePlanEdit = (laps: number[], patch: CellPatch) =>
    setPlanLapEdits((prev) => {
      const next = { ...prev };
      for (const lap of laps) {
        const cur = { ...(next[lap] ?? {}) };
        if (patch.riderId !== undefined) cur.riderId = patch.riderId;
        if (patch.condition !== undefined) cur.condition = patch.condition;
        if (patch.timeStr !== undefined) cur.timeStr = patch.timeStr;
        next[lap] = cur;
      }
      return next;
    });
  const mergeActualEdit = (laps: number[], patch: CellPatch) =>
    setActualEdits((prev) => {
      const next = { ...prev };
      for (const lap of laps) {
        const cur = { ...(next[lap] ?? {}) };
        if (patch.riderId !== undefined) cur.riderId = patch.riderId;
        if (patch.condition !== undefined) cur.condition = patch.condition;
        if (patch.outIn !== undefined) cur.outIn = patch.outIn;
        if (patch.timeStr !== undefined) cur.timeStr = patch.timeStr;
        next[lap] = cur;
      }
      return next;
    });

  const planEditCount = Object.keys(planLapEdits).length;
  const actualEditCount = Object.keys(actualEdits).length;

  // 計画: 上書き解除（選択周を即サーバー解除＋staged 破棄）
  const resetPlanLaps = useCallback(
    async (laps: number[]) => {
      setPlanLapEdits((prev) => {
        const n = { ...prev };
        laps.forEach((l) => delete n[l]);
        return n;
      });
      const overrideLaps = laps.filter((l) => plan?.laps.find((pl) => pl.lapNumber === l)?.isOverride);
      if (overrideLaps.length === 0) return;
      setSavingLaps(true);
      try {
        const res = await fetch('/api/plan/laps', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ overrides: overrideLaps.map((l) => ({ lapNumber: l, clear: true })) }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? '解除に失敗しました');
        applyPlan(data);
        flash(`${overrideLaps.length}周の上書きを解除しました`);
      } catch (e) {
        setError(e instanceof Error ? e.message : '解除に失敗しました');
      } finally {
        setSavingLaps(false);
      }
    },
    [plan, applyPlan],
  );

  // 実績: 選択周の staged 編集を取消
  const resetActualLaps = (laps: number[]) =>
    setActualEdits((prev) => {
      const n = { ...prev };
      laps.forEach((l) => delete n[l]);
      return n;
    });

  // 計画: staged 上書きをまとめて保存
  const savePlanLapEdits = useCallback(async () => {
    const overrides: Array<{ lapNumber: number; plannedTimeSec?: number; condition?: string; riderId?: string | null }> = [];
    for (const [lapStr, e] of Object.entries(planLapEdits)) {
      const lap = Number(lapStr);
      const o: { lapNumber: number; plannedTimeSec?: number; condition?: string; riderId?: string | null } = { lapNumber: lap };
      if (e.riderId !== undefined) o.riderId = e.riderId;
      if (e.condition !== undefined) o.condition = e.condition;
      if (e.timeStr !== undefined && e.timeStr.trim() !== '') {
        const t = parseLapTime(e.timeStr);
        if (t == null || t <= 0) {
          setError(`Lap ${lap}: タイムの形式が不正です（例 2:26.271）`);
          return;
        }
        o.plannedTimeSec = t;
      }
      overrides.push(o);
    }
    if (overrides.length === 0) return;
    setSavingLaps(true);
    setError(null);
    try {
      const res = await fetch('/api/plan/laps', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overrides }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? '保存に失敗しました');
      applyPlan(data);
      flash(`計画 ${overrides.length}周を上書き保存しました`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました');
    } finally {
      setSavingLaps(false);
    }
  }, [planLapEdits, applyPlan]);

  // 実績: staged 編集をまとめて保存
  const saveActualLapEdits = useCallback(async () => {
    if (!actualLaps) return;
    const updates: Array<{ id: string; lapTimeSec?: number; condition?: string; outIn?: 'OUT' | 'IN' | null; riderId?: string | null }> = [];
    for (const [lapStr, e] of Object.entries(actualEdits)) {
      const lap = Number(lapStr);
      const row = actualLaps.find((a) => a.lapNumber === lap);
      if (!row) continue;
      const u: { id: string; lapTimeSec?: number; condition?: string; outIn?: 'OUT' | 'IN' | null; riderId?: string | null } = { id: row.id };
      if (e.riderId !== undefined) u.riderId = e.riderId;
      if (e.condition !== undefined) u.condition = e.condition;
      if (e.outIn !== undefined) u.outIn = e.outIn;
      if (e.timeStr !== undefined && e.timeStr.trim() !== '') {
        const t = parseLapTime(e.timeStr);
        if (t == null || t <= 0) {
          setError(`Lap ${lap}: タイムの形式が不正です（例 2:26.271）`);
          return;
        }
        u.lapTimeSec = t;
      }
      updates.push(u);
    }
    if (updates.length === 0) return;
    setSavingLaps(true);
    setError(null);
    try {
      const res = await fetch('/api/laps', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? '保存に失敗しました');
      setActualEdits({});
      await loadActualLaps();
      flash(`実績 ${updates.length}周を保存しました`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました');
    } finally {
      setSavingLaps(false);
    }
  }, [actualEdits, actualLaps, loadActualLaps]);

  // 実績: 1周削除
  const deleteActualLap = useCallback(
    async (lapNumber: number) => {
      const row = actualLaps?.find((a) => a.lapNumber === lapNumber);
      if (!row) return;
      if (!confirm(`Lap ${lapNumber} の実績を削除します。よろしいですか？`)) return;
      setSavingLaps(true);
      try {
        const res = await fetch(`/api/laps/${row.id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('削除に失敗しました');
        setActualEdits((prev) => {
          const n = { ...prev };
          delete n[lapNumber];
          return n;
        });
        await loadActualLaps();
        flash(`Lap ${lapNumber} を削除しました`);
      } catch (e) {
        setError(e instanceof Error ? e.message : '削除に失敗しました');
      } finally {
        setSavingLaps(false);
      }
    },
    [actualLaps, loadActualLaps],
  );

  // ── グリッド行の生成 ──────────────────────────
  const planRows: GridRow[] = useMemo(() => {
    if (!plan) return [];
    return plan.laps.map((l) => {
      const e = planLapEdits[l.lapNumber];
      const effTimeSec = e?.timeStr != null && e.timeStr.trim() !== '' ? parseLapTime(e.timeStr) ?? l.plannedTimeSec : l.plannedTimeSec;
      const frozen = l.lapNumber <= frozenUpTo;
      return {
        lapNumber: l.lapNumber,
        stintNumber: l.stintNumber,
        selectable: !frozen,
        riderId: e?.riderId !== undefined ? e.riderId : l.riderId,
        condition: e?.condition ?? l.condition,
        outIn: l.outIn,
        timeSec: effTimeSec,
        timeStr: e?.timeStr,
        edited: l.isOverride || e != null,
        frozen,
        fuelRemainingL: l.fuelRemainingL,
        cumTimeSec: l.cumTimeSec,
        tireChange: tireByStint.get(l.stintNumber) ?? false,
      };
    });
  }, [plan, planLapEdits, frozenUpTo, tireByStint]);

  const actualRows: GridRow[] = useMemo(() => {
    if (!actualLaps) return [];
    return actualLaps.map((a) => {
      const e = actualEdits[a.lapNumber];
      const effTimeSec = e?.timeStr != null && e.timeStr.trim() !== '' ? parseLapTime(e.timeStr) ?? a.lapTimeSec : a.lapTimeSec;
      return {
        lapNumber: a.lapNumber,
        stintNumber: a.stintNumber,
        selectable: true,
        riderId: e?.riderId !== undefined ? e.riderId : a.riderId,
        condition: e?.condition ?? a.condition,
        outIn: e?.outIn !== undefined ? e.outIn : a.outIn,
        timeSec: effTimeSec,
        timeStr: e?.timeStr,
        edited: e != null,
      };
    });
  }, [actualLaps, actualEdits]);

  const compareRows: GridRow[] = useMemo(() => {
    if (!plan) return [];
    const actualByLap = new Map((actualLaps ?? []).map((a) => [a.lapNumber, a]));
    let cum = 0;
    const rows: GridRow[] = plan.laps.map((p) => {
      const a = actualByLap.get(p.lapNumber) ?? null;
      const e = a ? actualEdits[p.lapNumber] : undefined;
      const effTimeSec = a
        ? e?.timeStr != null && e.timeStr.trim() !== ''
          ? parseLapTime(e.timeStr) ?? a.lapTimeSec
          : a.lapTimeSec
        : null;
      const diff = effTimeSec != null ? effTimeSec - p.plannedTimeSec : null;
      if (diff != null) cum += diff;
      return {
        lapNumber: p.lapNumber,
        stintNumber: p.stintNumber,
        selectable: a != null,
        riderId: a ? (e?.riderId !== undefined ? e.riderId : a.riderId) : null,
        condition: a?.condition ?? 'D',
        outIn: a ? (e?.outIn !== undefined ? e.outIn : a.outIn) : null,
        timeSec: effTimeSec,
        timeStr: e?.timeStr,
        edited: e != null,
        planRiderId: p.riderId,
        planTimeSec: p.plannedTimeSec,
        planOutIn: p.outIn,
        diffSec: diff,
        cumDiffSec: a != null ? cum : null,
      };
    });
    const planLen = plan.laps.length;
    const extra: GridRow[] = (actualLaps ?? [])
      .filter((a) => a.lapNumber > planLen)
      .map((a) => {
        const e = actualEdits[a.lapNumber];
        const effTimeSec = e?.timeStr != null && e.timeStr.trim() !== '' ? parseLapTime(e.timeStr) ?? a.lapTimeSec : a.lapTimeSec;
        return {
          lapNumber: a.lapNumber,
          stintNumber: a.stintNumber,
          selectable: true,
          riderId: e?.riderId !== undefined ? e.riderId : a.riderId,
          condition: a.condition,
          outIn: e?.outIn !== undefined ? e.outIn : a.outIn,
          timeSec: effTimeSec,
          timeStr: e?.timeStr,
          edited: e != null,
          isExtra: true,
        };
      });
    return [...rows, ...extra];
  }, [plan, actualLaps, actualEdits]);

  // 対比サマリー（消化/対計画累積/ピット周）
  const compareTotals = useMemo(() => {
    if (!plan) return null;
    const actualByLap = new Map((actualLaps ?? []).map((a) => [a.lapNumber, a]));
    let cum = 0;
    for (const p of plan.laps) {
      const a = actualByLap.get(p.lapNumber);
      if (!a) continue;
      const e = actualEdits[p.lapNumber];
      const t = e?.timeStr != null && e.timeStr.trim() !== '' ? parseLapTime(e.timeStr) ?? a.lapTimeSec : a.lapTimeSec;
      cum += t - p.plannedTimeSec;
    }
    const outInOf = (a: ActualLapRow) => {
      const e = actualEdits[a.lapNumber];
      return e?.outIn !== undefined ? e.outIn : a.outIn;
    };
    return {
      actualLapsCount: actualLaps?.length ?? 0,
      cumDiffSec: cum,
      planPitLaps: plan.laps.filter((l) => l.outIn === 'IN').map((l) => l.lapNumber),
      actualPitLaps: (actualLaps ?? []).filter((a) => outInOf(a) === 'IN').map((a) => a.lapNumber),
    };
  }, [plan, actualLaps, actualEdits]);

  // スプリント別サマリー比較（ST_n を計画↔実績で突き合わせ）
  const stintSummary = useMemo(() => {
    if (!plan) return [];
    const planByStint = new Map<number, PlanLap[]>();
    for (const l of plan.laps) {
      if (!planByStint.has(l.stintNumber)) planByStint.set(l.stintNumber, []);
      planByStint.get(l.stintNumber)!.push(l);
    }
    const actByStint = new Map<number, ActualLapRow[]>();
    for (const a of actualLaps ?? []) {
      if (a.stintNumber == null) continue;
      if (!actByStint.has(a.stintNumber)) actByStint.set(a.stintNumber, []);
      actByStint.get(a.stintNumber)!.push(a);
    }
    const nums = Array.from(new Set([...planByStint.keys(), ...actByStint.keys()])).sort((a, b) => a - b);
    return nums.map((n) => {
      const pl = planByStint.get(n) ?? [];
      const al = actByStint.get(n) ?? [];
      const planGreen = pl.filter((l) => !l.outIn && l.condition === 'D');
      const actGreen = al.filter((l) => !l.outIn && l.condition === 'D');
      const planAvg = planGreen.length ? planGreen.reduce((s, l) => s + l.plannedTimeSec, 0) / planGreen.length : null;
      const actAvg = actGreen.length ? actGreen.reduce((s, l) => s + l.lapTimeSec, 0) / actGreen.length : null;
      const planTotal = pl.reduce((s, l) => s + l.plannedTimeSec, 0);
      const actTotal = al.length ? al.reduce((s, l) => s + l.lapTimeSec, 0) : null;
      return {
        stintNumber: n,
        planRider: plan.stints.find((s) => s.stintNumber === n)?.riderId ?? pl[0]?.riderId ?? null,
        actRider: al[0]?.riderId ?? null,
        planLaps: pl.length,
        actLaps: al.length,
        planAvg,
        actAvg,
        planTotal: pl.length ? planTotal : null,
        actTotal,
      };
    });
  }, [plan, actualLaps]);

  const planStintLabel = useCallback(
    (n: number) => riderName(plan?.stints.find((s) => s.stintNumber === n)?.riderId ?? null),
    [plan, riderName],
  );
  const actualStintLabel = useCallback(
    (n: number) => {
      const first = (actualLaps ?? []).find((a) => a.stintNumber === n);
      return first ? riderName(first.riderId) : undefined;
    },
    [actualLaps, riderName],
  );

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
  const unsaved = view === 'plan' ? planEditCount : actualEditCount;

  // 編集中（draftFuel）＝シミュレーション値、plan.totals＝保存済み（基準）。差分を集計タイルに出す。
  // draftFuel が null（入力途中/未割当）のときは保存済み値のみを表示（差分なし）。
  const simTotals = draftFuel?.totals ?? totals;
  const simOverTime = draftFuel?.overTime ?? overTime;
  const dLaps = draftFuel ? simTotals.totalLaps - totals.totalLaps : null;
  const dTime = draftFuel ? simTotals.totalTimeSec - totals.totalTimeSec : null;
  const dOver = draftFuel ? simOverTime - overTime : null;
  const simFuelShort = draftFuel?.fuelShortStints ?? totals.fuelShortStints;
  const baseFuelSeries: FuelPoint[] = plan.laps.map((l) => ({ lap: l.lapNumber, fuelL: l.fuelRemainingL }));
  const signedMinSec = (s: number) => `${s >= 0 ? '+' : '−'}${formatMinSec(Math.abs(s))}`;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">計画 / 実績</h1>
          <p className="mt-0.5 text-[10px] tracking-[0.3em] text-muted-foreground uppercase">
            Strategy ・ {plan.race.raceName}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* ビュー切替 */}
          <div className="flex gap-1 rounded-md border p-1">
            {(['plan', 'actual', 'compare'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                  view === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {v === 'plan' ? '計画のみ' : v === 'actual' ? '実績のみ' : '計画 vs 実績'}
              </button>
            ))}
          </div>
          {/* 編集トグル */}
          <button
            onClick={() => setEditing((e) => !e)}
            className={`px-3 py-1.5 rounded-md border text-sm font-medium transition-colors ${
              editing ? 'bg-amber-500 text-black border-amber-500' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {editing ? '編集モード ●' : '閲覧'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive border border-destructive/30 rounded-md px-4 py-2 text-sm">{error}</div>
      )}
      {msg && <div className="bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 rounded-md px-4 py-2 text-sm">{msg}</div>}

      {/* ═══ 計画のみ ═══ */}
      {view === 'plan' && (
        <>
          {freezeActive && (
            <div className="bg-primary/10 border border-primary/30 rounded-md px-4 py-2 text-sm">
              レース中: Lap {plan.progress!.maxActualLap} まで走行済み。保存しても走行済みの計画周
              {frozenUpTo > 0 ? `（Lap ${frozenUpTo} まで）` : ''}は変更されません。
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummaryTile
              label="計画周回"
              value={`${simTotals.totalLaps} 周`}
              delta={dLaps ? `${dLaps > 0 ? '+' : '−'}${Math.abs(dLaps)} 周` : undefined}
            />
            <SummaryTile
              label="計画所要時間"
              value={formatMinSec(simTotals.totalTimeSec)}
              sub={`レース時間 ${formatMinSec(totals.raceDurationSec)}`}
              delta={dTime ? signedMinSec(dTime) : undefined}
            />
            <SummaryTile
              label="対レース時間"
              value={`${simOverTime >= 0 ? '+' : '−'}${formatMinSec(Math.abs(simOverTime))}`}
              warn={simOverTime < -120}
              sub={simOverTime >= 0 ? '時間超過ぶんは走り切りでOK' : simOverTime < -120 ? '2分以上の余りあり: 周回を追加検討' : ''}
              delta={dOver ? signedMinSec(dOver) : undefined}
            />
            <SummaryTile
              label="燃料余裕"
              value={draftFuel?.minFuelL != null ? `最小 ${draftFuel.minFuelL.toFixed(1)}L` : '-'}
              warn={simFuelShort.length > 0}
              sub={
                simFuelShort.length > 0
                  ? `不足 ST${simFuelShort.join(',')}・ピット ${simTotals.pitCount}回`
                  : `ピット ${simTotals.pitCount}回`
              }
            />
          </div>

          {/* スティント構成 */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-lg">スティント構成</CardTitle>
                <CardDescription>誰が・何周・目標ラップ・給油量。保存すると周単位に展開されます</CardDescription>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={generatePlan}
                  disabled={busy || freezeActive}
                  title={freezeActive ? 'レース開始後は自動生成できません' : undefined}
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
                      <th className="text-center py-2 px-2 whitespace-nowrap">🛞 タイヤ</th>
                      <th className="text-right py-2 px-2 whitespace-nowrap">開始燃料(自動)</th>
                      <th className="text-right py-2 px-2 whitespace-nowrap">終了時残L</th>
                      <th className="py-2 px-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {drafts.map((d, i) => {
                      const stNo = i + 1;
                      const isFrozen = stNo < boundaryNo;
                      const isBoundary = stNo === boundaryNo;
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
                            <div className="flex items-center gap-1">
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-9 w-8 p-0 text-base leading-none"
                                disabled={isFrozen}
                                onClick={() => stepLaps(d.key, d.plannedLaps, -1)}
                                title="1周減らす"
                              >
                                −
                              </Button>
                              <Input
                                inputMode="numeric"
                                value={d.plannedLaps}
                                disabled={isFrozen}
                                title={isBoundary && plan.progress?.frozenLapsInBoundary != null ? `${plan.progress.frozenLapsInBoundary}周走行済み` : undefined}
                                onChange={(e) => updateDraft(d.key, { plannedLaps: e.target.value })}
                                className="w-14 h-9 font-mono text-center"
                              />
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-9 w-8 p-0 text-base leading-none"
                                disabled={isFrozen}
                                onClick={() => stepLaps(d.key, d.plannedLaps, 1)}
                                title="1周増やす"
                              >
                                ＋
                              </Button>
                            </div>
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
                          <td className="py-1.5 px-2 text-center">
                            {i === 0 ? (
                              <span className="text-xs text-muted-foreground">─</span>
                            ) : (
                              <input
                                type="checkbox"
                                checked={d.tireChange}
                                disabled={isFrozen || isBoundary}
                                onChange={(e) => updateDraft(d.key, { tireChange: e.target.checked })}
                                className="h-4 w-4 accent-amber-500 disabled:opacity-60"
                                title="このスティント開始時のピットインでタイヤ交換する"
                              />
                            )}
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono text-muted-foreground whitespace-nowrap">
                            {draftFuel?.stintStartFuel[i + 1] != null ? `${draftFuel.stintStartFuel[i + 1].toFixed(2)} L` : '-'}
                          </td>
                          <td
                            className={`py-1.5 px-2 text-right font-mono whitespace-nowrap ${
                              draftFuel != null && (draftFuel.stintEndFuel[i + 1] ?? 0) < 0 ? 'text-destructive font-bold' : 'text-muted-foreground'
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
                        <td colSpan={9} className="text-center py-6 text-muted-foreground">
                          スティントがありません。「自動生成」または「＋スティント追加」から作成してください
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <Button variant="outline" onClick={addDraft}>＋ スティント追加</Button>
              {dirty && <p className="text-xs text-amber-400">未保存の変更があります。「保存（再展開）」で周単位計画に反映されます</p>}
            </CardContent>
          </Card>

          {/* ライダー別サマリ */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">ライダー別サマリ</CardTitle>
              <CardDescription>
                周回数を増減すると、各ライダーの担当周回・走行時間がその場で変わります（数字は編集中の値、括弧は保存済みからの差分）
              </CardDescription>
            </CardHeader>
            <CardContent>
              {riderSummary.length === 0 ? (
                <p className="text-sm text-muted-foreground">ライダーが割り当てられたスティントがありません</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="text-muted-foreground border-b">
                      <tr>
                        <th className="text-left py-2 px-2">ライダー</th>
                        <th className="text-right py-2 px-2">担当周回</th>
                        <th className="text-right py-2 px-2">走行時間</th>
                        <th className="text-right py-2 px-2 whitespace-nowrap">スティント</th>
                        <th className="text-right py-2 px-2 whitespace-nowrap">平均ラップ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {riderSummary.map((r) => (
                        <tr key={r.rider.id} className="border-b border-border/50">
                          <td className="py-1.5 px-2">
                            <span className="inline-flex items-center gap-2">
                              <span className="inline-block h-3 w-3 rounded-full" style={{ background: r.rider.color ?? '#64748b' }} />
                              {r.rider.name}
                            </span>
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono">
                            {r.laps} 周
                            {r.dLaps !== 0 && (
                              <span className="ml-1 text-xs text-amber-400">
                                ({r.dLaps > 0 ? '+' : '−'}
                                {Math.abs(r.dLaps)})
                              </span>
                            )}
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono">{formatMinSec(r.driveSec)}</td>
                          <td className="py-1.5 px-2 text-right font-mono">{r.stints}</td>
                          <td className="py-1.5 px-2 text-right font-mono">{r.avgSec != null ? formatLapTime(r.avgSec) : '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 燃料残量シミュレーション（ダッシュボードと同じグラフ） */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">燃料残量（シミュレーション）</CardTitle>
              <CardDescription>
                青 = 編集中の計画、灰 = 保存済み計画。ガス欠ライン（0L）を下回ると燃料不足です
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FuelChart
                fuelSeries={{
                  plan: draftFuel?.fuelSeries ?? baseFuelSeries,
                  actual: [],
                  baseline: baseFuelSeries,
                  startFuelL: plan.race!.startFuelL,
                  tankCapacityL: plan.race!.tankCapacityL,
                }}
                labels={{ plan: 'シミュレーション', baseline: '保存済み' }}
              />
            </CardContent>
          </Card>

          {/* 周単位 計画グリッド */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-lg">周単位の計画</CardTitle>
                <CardDescription>
                  {editing
                    ? 'チェックで複数周を選び、上のバーで走者・路面・タイムを一括変更。橙 = 上書き済み'
                    : '「編集モード」で複数周をまとめて上書きできます（橙 = 上書き済み）'}
                </CardDescription>
              </div>
              {planEditCount > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-amber-400">未保存 {planEditCount} 周</span>
                  <Button onClick={savePlanLapEdits} disabled={savingLaps}>保存</Button>
                </div>
              )}
            </CardHeader>
            <CardContent>
              <LapCompareGrid
                mode="plan"
                tabbed
                editing={editing}
                rows={planRows}
                riders={plan.riders}
                riderName={riderName}
                stintLabel={planStintLabel}
                onCellChange={(lap, patch) => mergePlanEdit([lap], patch)}
                onBulkChange={mergePlanEdit}
                onReset={resetPlanLaps}
                resetLabel="上書き解除"
                emptyText="計画を保存すると周単位に展開されます"
              />
            </CardContent>
          </Card>
        </>
      )}

      {/* ═══ 実績のみ ═══ */}
      {view === 'actual' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummaryTile label="実績周回" value={`${actualLaps?.length ?? 0} 周`} sub={`計画 ${totals.totalLaps} 周`} />
            <SummaryTile label="対計画" value={`${(actualLaps?.length ?? 0) - totals.totalLaps >= 0 ? '+' : ''}${(actualLaps?.length ?? 0) - totals.totalLaps} 周`} />
          </div>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-lg">周単位の実績</CardTitle>
                <CardDescription>
                  {editing ? 'チェックで複数周を選び、走者・路面・区分・タイムを一括修正' : '「編集モード」で実績を修正できます'}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                {actualEditCount > 0 && <span className="text-xs text-amber-400">未保存 {actualEditCount} 周</span>}
                {actualEditCount > 0 && <Button onClick={saveActualLapEdits} disabled={savingLaps}>保存</Button>}
                <Button variant="ghost" className="text-xs h-8" onClick={loadActualLaps} disabled={savingLaps}>再取得</Button>
              </div>
            </CardHeader>
            <CardContent>
              <LapCompareGrid
                mode="actual"
                editing={editing}
                rows={actualRows}
                riders={plan.riders}
                riderName={riderName}
                stintLabel={actualStintLabel}
                onCellChange={(lap, patch) => mergeActualEdit([lap], patch)}
                onBulkChange={mergeActualEdit}
                onReset={resetActualLaps}
                resetLabel="編集を取消"
                onDeleteRow={deleteActualLap}
                emptyText={actualLaps == null ? '実績を読み込み中…' : 'まだ実績がありません'}
              />
            </CardContent>
          </Card>
        </>
      )}

      {/* ═══ 計画 vs 実績 ═══ */}
      {view === 'compare' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummaryTile label="消化" value={`${compareTotals?.actualLapsCount ?? 0} / ${totals.totalLaps} 周`} sub="実績 / 計画" />
            <SummaryTile
              label="対計画 累積"
              value={
                compareTotals && compareTotals.actualLapsCount > 0
                  ? `${compareTotals.cumDiffSec <= 0 ? '+' : '−'}${formatMinSec(Math.abs(compareTotals.cumDiffSec))}`
                  : '-'
              }
              sub="＋=計画より速い"
              good={compareTotals ? compareTotals.cumDiffSec <= 0 : undefined}
            />
            <SummaryTile label="計画ピット周" value={compareTotals?.planPitLaps.length ? compareTotals.planPitLaps.join(', ') : '-'} sub="Lap（IN 周）" />
            <SummaryTile label="実績ピット周" value={compareTotals?.actualPitLaps.length ? compareTotals.actualPitLaps.join(', ') : '-'} sub="Lap（IN 周）" />
          </div>

          {/* スプリント別サマリー比較 */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">スプリント別サマリー</CardTitle>
              <CardDescription>各スティントを計画↔実績で対比（平均はグリーン周＝OUT/IN・ウェット等を除く）</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-muted-foreground border-b">
                    <tr>
                      <th className="text-left py-2 px-2">ST</th>
                      <th className="text-left py-2 px-2">走者(計/実)</th>
                      <th className="text-right py-2 px-2">周(計/実)</th>
                      <th className="text-right py-2 px-2">平均(計/実)</th>
                      <th className="text-right py-2 px-2">合計(計/実)</th>
                      <th className="text-right py-2 px-2">合計差</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stintSummary.map((s) => {
                      const totalDiff = s.planTotal != null && s.actTotal != null ? s.actTotal - s.planTotal : null;
                      return (
                        <tr key={s.stintNumber} className="border-b border-border/40">
                          <td className="py-1.5 px-2 font-mono">ST{s.stintNumber}</td>
                          <td className="py-1.5 px-2 text-xs">
                            {riderName(s.planRider)}
                            <span className="text-muted-foreground"> / </span>
                            {s.actRider ? riderName(s.actRider) : '-'}
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono">
                            {s.planLaps}
                            <span className="text-muted-foreground"> / </span>
                            {s.actLaps || '-'}
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono text-xs">
                            {s.planAvg != null ? formatLapTime(s.planAvg) : '-'}
                            <span className="text-muted-foreground"> / </span>
                            {s.actAvg != null ? formatLapTime(s.actAvg) : '-'}
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono text-xs">
                            {s.planTotal != null ? formatMinSec(s.planTotal) : '-'}
                            <span className="text-muted-foreground"> / </span>
                            {s.actTotal != null ? formatMinSec(s.actTotal) : '-'}
                          </td>
                          <td className={`py-1.5 px-2 text-right font-mono ${diffClass(totalDiff)}`}>
                            {totalDiff != null ? `${totalDiff <= 0 ? '−' : '+'}${formatMinSec(Math.abs(totalDiff))}` : '-'}
                          </td>
                        </tr>
                      );
                    })}
                    {stintSummary.length === 0 && (
                      <tr>
                        <td colSpan={6} className="text-center py-6 text-muted-foreground">計画がありません</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* 周単位 対比グリッド（実績列を編集） */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-lg">周単位の計画 vs 実績</CardTitle>
                <CardDescription>差 = 実績 − 計画（負 = 計画より速い）。実績列を編集できます</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                {actualEditCount > 0 && <span className="text-xs text-amber-400">未保存 {actualEditCount} 周</span>}
                {actualEditCount > 0 && <Button onClick={saveActualLapEdits} disabled={savingLaps}>保存</Button>}
              </div>
            </CardHeader>
            <CardContent>
              <LapCompareGrid
                mode="compare"
                editing={editing}
                rows={compareRows}
                riders={plan.riders}
                riderName={riderName}
                stintLabel={planStintLabel}
                onCellChange={(lap, patch) => mergeActualEdit([lap], patch)}
                onBulkChange={mergeActualEdit}
                onReset={resetActualLaps}
                resetLabel="編集を取消"
                emptyText={actualLaps == null ? '実績を読み込み中…' : '計画がありません'}
              />
            </CardContent>
          </Card>
        </>
      )}

      {unsaved > 0 && editing && (
        <div className="text-xs text-amber-400">
          未保存の編集が {unsaved} 周あります。各表の「保存」で確定してください。
        </div>
      )}
    </div>
  );
}

function diffClass(diff: number | null): string {
  if (diff == null) return '';
  return diff <= 0 ? 'text-emerald-400' : 'text-destructive';
}

function SummaryTile({
  label,
  value,
  sub,
  warn,
  good,
  delta,
}: {
  label: string;
  value: string;
  sub?: string;
  warn?: boolean;
  good?: boolean;
  delta?: string; // 保存済みからの差分（編集中のみ表示、琥珀色）
}) {
  return (
    <Card className={warn ? 'border-destructive/50' : ''}>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="flex items-baseline gap-2">
          <div className={`font-display text-2xl font-bold ${warn ? 'text-destructive' : good === true ? 'text-emerald-400' : good === false ? 'text-destructive' : ''}`}>
            {value}
          </div>
          {delta ? <div className="text-sm font-semibold text-amber-400">{delta}</div> : null}
        </div>
        {sub ? <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div> : null}
      </CardContent>
    </Card>
  );
}
