'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PanelLabel } from '@/components/panel-label';
import { formatLapTime } from '@/lib/time';
import { CONDITIONS, CONDITION_LABEL } from '@/lib/constants';

interface TeamRow {
  carno: string;
  teamName: string;
  className: string;
  pos: number | null;
  lap: number | null;
}
interface Rider {
  id: string;
  name: string;
  color: string | null;
}
interface ReconLapRaw {
  lapNumber: number;
  lapTimeSec: number;
  totalTimeSec: number | null;
  pit: boolean;
  plannedTimeSec: number | null;
  riderId: string | null;
  condition: string;
  outIn: 'IN' | 'OUT' | null;
  imported: boolean;
  valid: boolean;
}
interface ReconResponse {
  carno: string;
  race: { id: string; raceName: string; startedAt: string | null; tankCapacityL: number; startFuelL: number; maxStintLap: number };
  riders: Rider[];
  planStints: { stintNumber: number; riderId: string | null; refuelL: number; plannedLaps: number }[];
  laps: ReconLapRaw[];
  importedCount: number;
}

// 周ごとの編集状態（走者・境界はスティント側で持つ。ここは路面のみ編集）
interface EditLap {
  lapNumber: number;
  lapTimeSec: number;
  totalTimeSec: number | null;
  plannedTimeSec: number | null;
  pit: boolean;
  valid: boolean;
  condition: string;
}
// スティントの編集単位（走者・周回数・搭載燃料）
interface StintEdit {
  riderId: string | null;
  lapCount: number;
  refuelL: number;
}

const CARNO_KEY = 'scrape.carno';

const modeRider = (ids: (string | null)[]): string | null => {
  const c = new Map<string, number>();
  for (const id of ids) if (id) c.set(id, (c.get(id) ?? 0) + 1);
  let best: string | null = null;
  let bn = 0;
  c.forEach((n, id) => {
    if (n > bn) {
      bn = n;
      best = id;
    }
  });
  return best;
};

// スティント編集を「commit 用の周ごと配列」に展開する（IN/OUT を境界に付与）。手動確定とオート取込で共用。
function buildCommitBody(stints: StintEdit[], validLaps: EditLap[]) {
  const laps: { lapNumber: number; lapTimeSec: number; totalTimeSec: number | null; riderId: string | null; condition: string; outIn: 'IN' | 'OUT' | null }[] = [];
  const refuelByStint: Record<string, number> = {};
  let idx = 0;
  stints.forEach((st, si) => {
    refuelByStint[String(si + 1)] = st.refuelL;
    for (let i = 0; i < st.lapCount; i++) {
      const lap = validLaps[idx++];
      if (!lap) break;
      laps.push({
        lapNumber: lap.lapNumber,
        lapTimeSec: lap.lapTimeSec,
        totalTimeSec: lap.totalTimeSec,
        riderId: st.riderId,
        condition: lap.condition,
        outIn: i === st.lapCount - 1 && si < stints.length - 1 ? 'IN' : i === 0 && si > 0 ? 'OUT' : null,
      });
    }
  });
  return { laps, refuelByStint };
}

// 計時から取得 → 予定と照合 → スティント単位で編集 → 確定 のパネル。
// 「取込」ページ（フル表示）と「ライブ入力」ページ（embedded 埋め込み）の両方から使う。
export function ImportPanel({
  embedded = false,
  onCommitted,
}: {
  embedded?: boolean;
  onCommitted?: () => void;
}) {
  const [carno, setCarno] = useState('');
  const [carnoInput, setCarnoInput] = useState('');
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(false);

  const [recon, setRecon] = useState<ReconResponse | null>(null);
  const [laps, setLaps] = useState<EditLap[]>([]);
  const [stints, setStints] = useState<StintEdit[]>([]);

  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [auto, setAuto] = useState(false); // オート取込 ON/OFF
  const [lastAutoAt, setLastAutoAt] = useState<number | null>(null);
  const [autoNote, setAutoNote] = useState<string | null>(null);

  useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem(CARNO_KEY) : null;
    if (saved) {
      setCarno(saved);
      setCarnoInput(saved);
    }
  }, []);

  // reconcile から編集状態を組み立てる。
  // 既存のスティント編集（走者/周回/搭載）と路面編集は保持し、
  // 新しく増えた周は最後のスティントに足す（総数のズレを末尾で吸収）。
  const buildState = useCallback(
    (r: ReconResponse, prevLaps: EditLap[], prevStints: StintEdit[], hardReset: boolean): { laps: EditLap[]; stints: StintEdit[] } => {
      const prevCond = new Map(prevLaps.map((l) => [l.lapNumber, l.condition]));
      const nextLaps: EditLap[] = r.laps.map((l) => ({
        lapNumber: l.lapNumber,
        lapTimeSec: l.lapTimeSec,
        totalTimeSec: l.totalTimeSec,
        plannedTimeSec: l.plannedTimeSec,
        pit: l.pit,
        valid: l.valid,
        condition: (!hardReset && prevCond.get(l.lapNumber)) || l.condition,
      }));
      const validCount = nextLaps.filter((l) => l.valid).length;

      let nextStints: StintEdit[];
      if (!hardReset && prevStints.length > 0) {
        // 既存編集を保持。増えた周は末尾スティントに足すが、直前がピット周なら
        // そこで区切って新スティントを作る（オート中の新規ピットを自動検出。走者は計画準拠）。
        nextStints = prevStints.map((s) => ({ ...s }));
        const valids = r.laps.filter((l) => l.valid);
        const sum = nextStints.reduce((a, s) => a + s.lapCount, 0);
        if (valids.length > sum) {
          for (let i = sum; i < valids.length; i++) {
            const prev = valids[i - 1];
            if (i > 0 && prev && prev.pit) {
              nextStints.push({ riderId: valids[i].riderId ?? null, lapCount: 1, refuelL: r.race.tankCapacityL });
            } else {
              nextStints[nextStints.length - 1].lapCount += 1;
            }
          }
        } else if (valids.length < sum) {
          // 実データが減った（稀）: 末尾から吸収
          let over = sum - valids.length;
          while (over > 0 && nextStints.length > 0) {
            const last = nextStints[nextStints.length - 1];
            if (last.lapCount > over) {
              last.lapCount -= over;
              over = 0;
            } else {
              over -= last.lapCount;
              nextStints.pop();
            }
          }
          if (nextStints.length === 0) nextStints = [{ riderId: null, lapCount: valids.length, refuelL: r.race.startFuelL }];
        }
      } else {
        // PIT フラグで区切り、各グループの走者は計画の最頻走者、搭載は 第1=スタート燃料/以降=満タン
        const valids = r.laps.filter((l) => l.valid);
        const groups: ReconLapRaw[][] = [];
        let cur: ReconLapRaw[] = [];
        for (const l of valids) {
          cur.push(l);
          if (l.pit) {
            groups.push(cur);
            cur = [];
          }
        }
        if (cur.length) groups.push(cur);
        nextStints = groups.map((g, i) => ({
          riderId: modeRider(g.map((x) => x.riderId)),
          lapCount: g.length,
          refuelL: i === 0 ? r.race.startFuelL : r.race.tankCapacityL,
        }));
        if (nextStints.length === 0 && validCount > 0) {
          nextStints = [{ riderId: null, lapCount: validCount, refuelL: r.race.startFuelL }];
        }
      }
      return { laps: nextLaps, stints: nextStints };
    },
    [],
  );

  // stints/laps の最新値を副作用（reconcile/オート）から参照するための ref
  const stintsRef = useRef<StintEdit[]>([]);
  const lapsRef = useRef<EditLap[]>([]);
  const lastCommittedKeyRef = useRef(''); // 最後に確定した内容キー。新周でも編集でも変化を検知してオート反映

  const reconcile = useCallback(
    async (target: string, opts?: { hardReset?: boolean }) => {
      if (!target) return;
      setLoading(true);
      try {
        const res = await fetch(`/api/scrape/reconcile?carno=${encodeURIComponent(target)}`, { cache: 'no-store' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? '取得に失敗しました');
        const r = data as ReconResponse;
        setRecon(r);
        setLaps((prevLaps) => {
          const built = buildState(r, prevLaps, stintsRef.current, opts?.hardReset ?? false);
          setStints(built.stints);
          return built.laps;
        });
        setLastUpdated(Date.now());
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : '取得に失敗しました');
      } finally {
        setLoading(false);
      }
    },
    [buildState],
  );

  useEffect(() => {
    stintsRef.current = stints;
  }, [stints]);
  useEffect(() => {
    lapsRef.current = laps;
  }, [laps]);

  useEffect(() => {
    if (carno) reconcile(carno);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carno]);

  const loadTeams = useCallback(async () => {
    setTeamsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/scrape/teams', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'チーム一覧の取得に失敗しました');
      setTeams(json.teams ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'チーム一覧の取得に失敗しました');
    } finally {
      setTeamsLoading(false);
    }
  }, []);

  const selectCarno = useCallback((next: string) => {
    const v = next.trim();
    if (!v) return;
    setCarno(v);
    setCarnoInput(v);
    setLaps([]);
    setStints([]);
    stintsRef.current = [];
    setRecon(null);
    setMessage(null);
  }, []);
  useEffect(() => {
    if (carno && typeof window !== 'undefined') localStorage.setItem(CARNO_KEY, carno);
  }, [carno]);

  const riders = recon?.riders ?? [];
  const riderName = (id: string | null) => riders.find((r) => r.id === id)?.name ?? '未設定';

  const validLaps = useMemo(() => laps.filter((l) => l.valid), [laps]);

  // スティントの表示レンジ（周番号）と、周番号→(スティント番号・走者・境界) のメタ
  const { stintRanges, lapMeta } = useMemo(() => {
    const ranges: { index: number; stintNumber: number; from: number | null; to: number | null; count: number; riderId: string | null; refuelL: number }[] = [];
    const meta = new Map<number, { stint: number; riderId: string | null; inLap: boolean; outLap: boolean }>();
    let idx = 0;
    stints.forEach((st, si) => {
      const from = validLaps[idx]?.lapNumber ?? null;
      const endIdx = Math.min(idx + st.lapCount - 1, validLaps.length - 1);
      const to = validLaps[endIdx]?.lapNumber ?? null;
      ranges.push({ index: si, stintNumber: si + 1, from, to, count: st.lapCount, riderId: st.riderId, refuelL: st.refuelL });
      for (let i = 0; i < st.lapCount; i++) {
        const lap = validLaps[idx + i];
        if (!lap) break;
        meta.set(lap.lapNumber, {
          stint: si + 1,
          riderId: st.riderId,
          inLap: i === st.lapCount - 1 && si < stints.length - 1,
          outLap: i === 0 && si > 0,
        });
      }
      idx += st.lapCount;
    });
    return { stintRanges: ranges, lapMeta: meta };
  }, [stints, validLaps]);

  // 周回数の増減（総数固定・境界だけ動かす）: 隣のスティントと 1 周やり取り
  const adjustLaps = (si: number, delta: number) => {
    setStints((prev) => {
      if (prev.length < 2) return prev; // 1 スティントのみは増減不可
      const nb = si < prev.length - 1 ? si + 1 : si - 1; // 末尾は前と、他は次とやり取り
      const cur = prev[si].lapCount + delta;
      const other = prev[nb].lapCount - delta;
      if (cur < 1 || other < 1) return prev;
      const next = prev.map((s) => ({ ...s }));
      next[si].lapCount = cur;
      next[nb].lapCount = other;
      return next;
    });
  };
  const setStintRider = (si: number, riderId: string | null) =>
    setStints((prev) => prev.map((s, i) => (i === si ? { ...s, riderId } : s)));
  const setRefuel = (si: number, v: number) =>
    setStints((prev) => prev.map((s, i) => (i === si ? { ...s, refuelL: v } : s)));

  // ピット追加（最も長いスティントを2分割）
  const addPit = () =>
    setStints((prev) => {
      if (prev.length === 0) return prev;
      let li = 0;
      prev.forEach((s, i) => {
        if (s.lapCount > prev[li].lapCount) li = i;
      });
      if (prev[li].lapCount < 2) return prev;
      const first = Math.floor(prev[li].lapCount / 2);
      const second = prev[li].lapCount - first;
      const tank = recon?.race.tankCapacityL ?? prev[li].refuelL;
      return [
        ...prev.slice(0, li),
        { ...prev[li], lapCount: first },
        { riderId: prev[li].riderId, lapCount: second, refuelL: tank },
        ...prev.slice(li + 1),
      ];
    });
  // ピット削除（このスティントを次と結合＝後ろのピットを消す）
  const removePit = (si: number) =>
    setStints((prev) => {
      if (prev.length <= 1 || si >= prev.length - 1) return prev;
      const merged = { ...prev[si], lapCount: prev[si].lapCount + prev[si + 1].lapCount };
      return [...prev.slice(0, si), merged, ...prev.slice(si + 2)];
    });

  const setCondition = (lapNumber: number, condition: string) =>
    setLaps((prev) => prev.map((l) => (l.lapNumber === lapNumber ? { ...l, condition } : l)));

  // 周ごとに「ピットイン（＝走者交代の区切り）」を打つ/外す。
  // その周を IN（スティント最終周）にし、次周から新スティント＝交代にする。あとから何度でも編集可。
  // オート中でも保持され、内容が変わるので次の自動反映で実績に登録される。
  const toggleBoundaryAt = (lapNumber: number) => {
    setStints((prev) => {
      let idx = 0;
      let si = -1;
      let offset = -1; // スティント内での位置（1 始まり）
      for (let s = 0; s < prev.length && si < 0; s++) {
        const c = prev[s].lapCount;
        for (let i = 0; i < c; i++) {
          if (validLaps[idx + i]?.lapNumber === lapNumber) {
            si = s;
            offset = i + 1;
            break;
          }
        }
        idx += c;
      }
      if (si < 0) return prev;
      // すでに境界（スティント最終周・末尾以外）なら → 次と結合して区切りを外す
      if (offset === prev[si].lapCount && si < prev.length - 1) {
        const merged = { ...prev[si], lapCount: prev[si].lapCount + prev[si + 1].lapCount };
        return [...prev.slice(0, si), merged, ...prev.slice(si + 2)];
      }
      // 全体の最終周は区切れない（次周が無い）
      if (offset >= prev[si].lapCount) return prev;
      // 分割: 前=offset周（この周が IN）、後=残り（次周が OUT＝新スティント）
      const first = { ...prev[si], lapCount: offset };
      const second = {
        riderId: prev[si].riderId,
        lapCount: prev[si].lapCount - offset,
        refuelL: recon?.race.tankCapacityL ?? prev[si].refuelL,
      };
      return [...prev.slice(0, si), first, second, ...prev.slice(si + 1)];
    });
  };

  const resetToPlan = () => {
    if (!recon) return;
    const built = buildState(recon, [], [], true);
    setLaps(built.laps);
    setStints(built.stints);
    setMessage('計画・実データの初期状態に戻しました');
  };

  // 手動確定: 現在の編集内容で実績を置き換える。
  const commit = useCallback(async () => {
    const { laps: payload, refuelByStint } = buildCommitBody(stints, validLaps);
    if (payload.length === 0) {
      setError('確定できる有効な周がありません');
      return;
    }
    if (!confirm(`実績を置き換えて確定します（${payload.length}周 / ${stints.length}スティント）。よろしいですか？`)) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/scrape/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ laps: payload, refuelByStint }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? '確定に失敗しました');
      lastCommittedKeyRef.current = JSON.stringify(payload);
      setMessage(`確定しました: ${json.committed}周 / ${json.stints}スティント。ダッシュボードに反映されます。`);
      setError(null);
      await reconcile(carno);
      onCommitted?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : '確定に失敗しました');
    } finally {
      setBusy(false);
    }
  }, [stints, validLaps, carno, reconcile, onCommitted]);

  // オート取込 1 回分: 計時を再取得し、有効周が増えていたら自動で実績へ反映する。
  const autoImportOnce = useCallback(async () => {
    const target = carno;
    if (!target) return;
    try {
      const res = await fetch(`/api/scrape/reconcile?carno=${encodeURIComponent(target)}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? '取得に失敗しました');
      const r = data as ReconResponse;
      setRecon(r);
      const built = buildState(r, lapsRef.current, stintsRef.current, false);
      setLaps(built.laps);
      setStints(built.stints);
      setLastUpdated(Date.now());
      const vlaps = built.laps.filter((l) => l.valid);
      const { laps: payload, refuelByStint } = buildCommitBody(built.stints, vlaps);
      const key = JSON.stringify(payload);
      // 新しい周が増えた時だけでなく、走者や交代（区切り）の編集で内容が変わった時も反映する
      if (payload.length > 0 && key !== lastCommittedKeyRef.current) {
        const cres = await fetch('/api/scrape/commit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ laps: payload, refuelByStint }),
        });
        const cjson = await cres.json();
        if (!cres.ok) throw new Error(cjson.error ?? '確定に失敗しました');
        lastCommittedKeyRef.current = key;
        setLastAutoAt(Date.now());
        setAutoNote(`${cjson.committed}周 / ${cjson.stints}スティント`);
        onCommitted?.();
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? `オート取込: ${e.message}` : 'オート取込に失敗しました');
    }
  }, [carno, buildState, onCommitted]);

  // オート ON の間、15 秒ごとに autoImportOnce を回す。
  useEffect(() => {
    if (!auto || !carno) return;
    autoImportOnce();
    const id = setInterval(autoImportOnce, 15000);
    return () => clearInterval(id);
  }, [auto, carno, autoImportOnce]);

  const tank = recon?.race.tankCapacityL ?? 0;
  const startFuel = recon?.race.startFuelL ?? 0;

  return (
    <div className="space-y-5">
      {!embedded && (
        <div>
          <h1 className="text-2xl font-bold tracking-tight">計時取込</h1>
          <p className="mt-0.5 text-[10px] tracking-[0.3em] text-muted-foreground uppercase">
            Live Timing Import ・ 予定と照合してスティント単位で編集 → 確定
          </p>
        </div>
      )}

      {error && <div className="bg-destructive/10 text-destructive border border-destructive/30 rounded-md px-4 py-2 text-sm">{error}</div>}
      {message && <div className="bg-emerald-500/10 text-emerald-500 border border-emerald-500/30 rounded-md px-4 py-2 text-sm">{message}</div>}

      {/* チーム選択 */}
      <Card>
        <CardHeader className="pb-2">
          <PanelLabel>Target / 参照するチーム（車番）</PanelLabel>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-end gap-2 flex-wrap">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">車番を直接入力</label>
              <Input
                inputMode="numeric"
                value={carnoInput}
                onChange={(e) => setCarnoInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && selectCarno(carnoInput)}
                placeholder="例: 7"
                className="w-28 h-11 text-lg text-center font-mono"
              />
            </div>
            <Button onClick={() => selectCarno(carnoInput)} className="h-11">
              このチームを取得
            </Button>
            <div className="mx-1 text-muted-foreground text-sm">または</div>
            <Button variant="outline" onClick={loadTeams} disabled={teamsLoading} className="h-11">
              {teamsLoading ? '一覧取得中…' : '出走一覧を取得'}
            </Button>
          </div>
          {teams.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground">一覧から選択</span>
              <select value={carno} onChange={(e) => selectCarno(e.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm max-w-full">
                <option value="">— チームを選択 —</option>
                {teams.map((t) => (
                  <option key={t.carno} value={t.carno}>
                    {t.pos ? `${t.pos}位 ` : ''}#{t.carno} {t.teamName}
                    {t.className ? `（${t.className}）` : ''}
                    {t.lap ? ` ・${t.lap}周` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
          {carno && (
            <div className="flex items-center gap-3 flex-wrap text-sm pt-1">
              <span className="font-mono text-lg font-bold text-primary">#{carno}</span>
              {recon?.race?.raceName && <span className="text-muted-foreground">取込先: {recon.race.raceName}</span>}
              <span className="text-muted-foreground">
                有効 {validLaps.length}周 / スティント {stints.length}
              </span>
              {recon && recon.importedCount > 0 && <span className="text-emerald-500">確定済 {recon.importedCount}周</span>}
              {lastUpdated && <span className="text-muted-foreground text-xs">更新 {new Date(lastUpdated).toLocaleTimeString('ja-JP')}</span>}
              <Button variant="ghost" onClick={() => reconcile(carno)} disabled={loading} className="h-8 px-3 text-xs">
                {loading ? '取得中…' : '最新を取得（編集は保持）'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {carno && recon && (
        <>
          {/* スティント編集（主編集エリア） */}
          <Card>
            <CardHeader className="pb-2">
              <PanelLabel>Stints / スティント編集（走者・周回・搭載燃料をここで編集）</PanelLabel>
            </CardHeader>
            <CardContent className="space-y-3">
              {stintRanges.length === 0 ? (
                <div className="text-sm text-muted-foreground">有効なラップがありません。</div>
              ) : (
                <div className="flex gap-3 flex-wrap items-stretch">
                  {stintRanges.map((s) => (
                    <div key={s.index} className="border rounded-lg p-3 w-[13.5rem] bg-muted/20 flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-primary">第{s.stintNumber}スティント</span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {s.from != null ? `L${s.from}–${s.to}` : '—'}
                        </span>
                      </div>

                      {/* 走者 */}
                      <div>
                        <div className="text-[10px] text-muted-foreground mb-0.5">走者</div>
                        <select
                          value={s.riderId ?? ''}
                          onChange={(e) => setStintRider(s.index, e.target.value || null)}
                          className="h-9 w-full rounded border border-input bg-background px-2 text-sm"
                        >
                          <option value="">未設定</option>
                          {riders.map((r) => (
                            <option key={r.id} value={r.id}>{r.name}</option>
                          ))}
                        </select>
                      </div>

                      {/* 周回数（上下ステッパー・総数固定で隣と調整） */}
                      <div>
                        <div className="text-[10px] text-muted-foreground mb-0.5">周回数（隣と調整）</div>
                        <div className="flex items-center gap-1">
                          <Button variant="outline" onClick={() => adjustLaps(s.index, -1)} disabled={stints.length < 2} className="h-9 w-9 p-0 text-lg font-bold">
                            −
                          </Button>
                          <div className="flex-1 text-center font-mono text-lg font-bold">{s.count}<span className="text-xs text-muted-foreground">周</span></div>
                          <Button variant="outline" onClick={() => adjustLaps(s.index, +1)} disabled={stints.length < 2} className="h-9 w-9 p-0 text-lg font-bold">
                            ＋
                          </Button>
                        </div>
                      </div>

                      {/* 搭載燃料 */}
                      <div>
                        <div className="text-[10px] text-muted-foreground mb-0.5">搭載(L)</div>
                        <Input
                          inputMode="decimal"
                          value={s.refuelL}
                          onChange={(e) => setRefuel(s.index, Number(e.target.value))}
                          className="h-9 w-full text-sm font-mono"
                        />
                      </div>

                      {/* ピット削除（後ろのピットを消して次と結合）。末尾以外に表示 */}
                      {s.index < stints.length - 1 && (
                        <button onClick={() => removePit(s.index)} className="text-[10px] text-muted-foreground hover:text-destructive underline self-start">
                          ↓次と結合（このピットを削除）
                        </button>
                      )}
                    </div>
                  ))}

                  {/* ピット追加 */}
                  <button onClick={addPit} className="border border-dashed rounded-lg w-[7rem] flex flex-col items-center justify-center text-muted-foreground hover:text-foreground hover:border-foreground/40 text-sm">
                    <span className="text-2xl leading-none">＋</span>
                    ピット追加
                  </button>
                </div>
              )}

              <p className="text-[11px] text-muted-foreground">
                搭載＝各スティント開始時の燃料(L)。満タン給油なら既定のまま（タンク {tank}L / 第1はスタート {startFuel}L）。
                周回数の＋−は総周回を変えずに隣のスティントと1周ずつやり取りします（＝ピットのタイミングを前後）。
              </p>

              {/* アクション */}
              <div className="space-y-2 border-t pt-3">
                {/* オート取込（主役）: ONの間、新しい周が増えるたびに自動で実績へ反映 */}
                <div className="flex items-center gap-3 flex-wrap">
                  <Button
                    onClick={() => setAuto((v) => !v)}
                    variant={auto ? 'default' : 'secondary'}
                    className={`h-11 font-bold ${auto ? 'bg-emerald-600 hover:bg-emerald-600/90 text-white' : ''}`}
                  >
                    {auto ? '⏹ オート取込を停止' : '▶ オート取込を開始'}
                  </Button>
                  {auto ? (
                    <span className="inline-flex items-center gap-1.5 text-xs text-emerald-500">
                      <span className="live-dot h-2 w-2 rounded-full bg-emerald-500" />
                      ON ・ 15秒ごとに自動反映
                      {lastAutoAt
                        ? ` ・ 最終取込 ${new Date(lastAutoAt).toLocaleTimeString('ja-JP')}${autoNote ? `（${autoNote}）` : ''}`
                        : ' ・ 新しい周を待機中…'}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      ONにすると #{carno} の周が増えるたび自動で実績登録します（手動確定は不要）
                    </span>
                  )}
                </div>
                {/* 手動確定（必要な時だけ） */}
                <div className="flex items-center gap-2 flex-wrap">
                  <Button onClick={commit} disabled={busy || validLaps.length === 0} variant="outline" className="h-9">
                    今すぐ手動で確定
                  </Button>
                  <span className="text-xs text-muted-foreground">{validLaps.length}周 / {stints.length}スティント</span>
                  <div className="flex-1" />
                  <Button variant="ghost" onClick={resetToPlan} className="h-9 text-xs">計画値に戻す</Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 周ごとの確認グリッド（走者は読取専用・路面のみ編集） */}
          <Card>
            <CardHeader className="pb-2">
              <PanelLabel>Laps / 周ごと（「交代」でその周にピットイン＝走者交代の区切り。走者は上のスティントカードで設定）</PanelLabel>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto max-h-[42rem] overflow-y-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-muted-foreground border-b sticky top-0 bg-card z-10">
                    <tr>
                      <th className="text-left py-2 px-2">Lap</th>
                      <th className="text-center py-2 px-2">ST</th>
                      <th className="text-right py-2 px-2">実績</th>
                      <th className="text-right py-2 px-2 hidden md:table-cell">計画</th>
                      <th className="text-right py-2 px-2 hidden md:table-cell">Δ</th>
                      <th className="text-left py-2 px-2">走者</th>
                      <th className="text-left py-2 px-2">路面</th>
                      <th className="text-center py-2 px-2">交代/IN</th>
                    </tr>
                  </thead>
                  <tbody>
                    {laps.map((l) => {
                      const meta = lapMeta.get(l.lapNumber);
                      const delta = l.valid && l.plannedTimeSec != null ? l.lapTimeSec - l.plannedTimeSec : null;
                      return (
                        <tr key={l.lapNumber} className={`border-b border-border/40 ${meta?.inLap ? 'border-b-2 border-b-amber-500/50' : ''}`}>
                          <td className="py-1 px-2 font-mono">{l.lapNumber}</td>
                          <td className="py-1 px-2 text-center font-mono text-muted-foreground">{meta?.stint ?? ''}</td>
                          <td className="py-1 px-2 text-right font-mono">{l.valid ? formatLapTime(l.lapTimeSec) : <span className="text-muted-foreground">計測中</span>}</td>
                          <td className="py-1 px-2 text-right font-mono text-muted-foreground hidden md:table-cell">{l.plannedTimeSec != null ? formatLapTime(l.plannedTimeSec) : '—'}</td>
                          <td className={`py-1 px-2 text-right font-mono hidden md:table-cell ${delta == null ? 'text-muted-foreground' : delta <= 0 ? 'text-emerald-500' : 'text-destructive'}`}>
                            {delta == null ? '' : `${delta > 0 ? '+' : ''}${delta.toFixed(1)}`}
                          </td>
                          <td className="py-1 px-2 truncate max-w-[7rem]">{meta ? riderName(meta.riderId) : ''}</td>
                          <td className="py-1 px-2">
                            <select
                              value={l.condition}
                              onChange={(e) => setCondition(l.lapNumber, e.target.value)}
                              disabled={!l.valid}
                              className="h-8 rounded border border-input bg-background px-1.5 text-xs"
                            >
                              {CONDITIONS.map((c) => (
                                <option key={c} value={c}>{CONDITION_LABEL[c]}</option>
                              ))}
                            </select>
                          </td>
                          <td className="py-1 px-2 text-center whitespace-nowrap">
                            {meta?.outLap && (
                              <span className="inline-block px-1 py-0.5 rounded text-[10px] border border-border mr-1">OUT</span>
                            )}
                            <button
                              onClick={() => toggleBoundaryAt(l.lapNumber)}
                              disabled={!l.valid}
                              title="この周でピットイン＝次周から走者交代（もう一度押すと解除）"
                              className={`px-1.5 py-0.5 rounded text-[10px] border transition-colors ${
                                meta?.inLap
                                  ? 'bg-amber-600 text-white border-amber-600'
                                  : 'text-muted-foreground border-border hover:border-amber-500 hover:text-amber-500'
                              }`}
                            >
                              {meta?.inLap ? 'IN✓' : '交代'}
                            </button>
                            {l.pit && <span className="ml-1 text-[10px] text-amber-500" title="計時のPITフラグ">P</span>}
                          </td>
                        </tr>
                      );
                    })}
                    {laps.length === 0 && (
                      <tr>
                        <td colSpan={8} className="text-center py-8 text-muted-foreground">{loading ? '取得中…' : 'ラップがありません'}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
