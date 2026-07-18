'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatLapTime, formatMinSec, minSecToSeconds } from '@/lib/time';
import { CONDITION_LABEL, CONDITION_COLOR, CONDITIONS } from '@/lib/constants';
import RaceClockTile from '@/components/RaceClockTile';

interface Rider {
  id: string;
  name: string;
  color: string | null;
}
interface RecentLap {
  id: string;
  lapNumber: number;
  lapTimeSec: number;
  condition: string;
  outIn: string | null;
  riderId: string | null;
  fuel: { fuelUsedL: number; fuelRemainingL: number } | null;
}
interface LiveResponse {
  race: {
    id: string;
    raceName: string;
    tankCapacityL: number;
    startFuelL: number;
    startedAt: string | null;
    raceDurationMin: number;
  } | null;
  riders: Rider[];
  currentStint: { id: string; stintNumber: number; riderId: string | null; plannedLaps: number | null } | null;
  tiles: {
    totalLaps: number;
    lapsInStint: number;
    fuelRemainingL: number | null;
    possibleLaps: number | null;
    recent3Avg: number | null;
    avgLapSec: number | null;
    avgDry: number | null;
    avgWet: number | null;
    clock: { elapsedSec: number; remainingSec: number } | null;
    lapsUntilNextPit: number;
    projectedTotalLaps: number | null;
    remainingPits: number | null;
    nextPitInSec: number | null;
    bankSec: number | null;
    assumedLapSec: number;
  };
  recentLaps: RecentLap[];
}

export default function LivePage() {
  const [live, setLive] = useState<LiveResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 入力フォーム
  const [minVal, setMinVal] = useState('2');
  const [secVal, setSecVal] = useState('');
  const [condition, setCondition] = useState('D');
  const [outIn, setOutIn] = useState<string | null>(null);
  const [riderId, setRiderId] = useState<string>('');
  const secRef = useRef<HTMLInputElement>(null);

  // ピットフォーム
  const [pitRiderId, setPitRiderId] = useState<string>('');
  const [pitRefuel, setPitRefuel] = useState<string>('');
  const [showPit, setShowPit] = useState(false);

  const fetchLive = useCallback(async () => {
    try {
      const res = await fetch('/api/live', { cache: 'no-store' });
      if (!res.ok) throw new Error('ライブ状態の取得に失敗しました');
      const data: LiveResponse = await res.json();
      setLive(data);
      setError(null);
      // ライダー初期選択を現スティントに合わせる
      setRiderId((prev) => prev || data.currentStint?.riderId || data.riders[0]?.id || '');
    } catch (e) {
      setError(e instanceof Error ? e.message : '不明なエラー');
    }
  }, []);

  useEffect(() => {
    fetchLive();
    const id = setInterval(fetchLive, 5000);
    return () => clearInterval(id);
  }, [fetchLive]);

  const recordLap = useCallback(async () => {
    const lapTimeSec = minSecToSeconds(Number(minVal), Number(secVal));
    if (!Number.isFinite(lapTimeSec) || lapTimeSec <= 0 || secVal.trim() === '') {
      setError('ラップタイムを入力してください（秒は小数可。例: 26.271）');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/laps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lapTimeSec, condition, outIn, riderId: riderId || undefined }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? '記録に失敗しました');
      setSecVal('');
      setOutIn(null);
      secRef.current?.focus();
      await fetchLive();
    } catch (e) {
      setError(e instanceof Error ? e.message : '記録に失敗しました');
    } finally {
      setBusy(false);
    }
  }, [minVal, secVal, condition, outIn, riderId, fetchLive]);

  const copyPrevious = useCallback(() => {
    const last = live?.recentLaps[0];
    if (!last) return;
    const m = Math.floor(last.lapTimeSec / 60);
    const s = last.lapTimeSec - m * 60;
    setMinVal(String(m));
    setSecVal(s.toFixed(3));
    setCondition(last.condition);
  }, [live]);

  const undoLast = useCallback(async () => {
    if (!confirm('直前のラップを取り消しますか？')) return;
    setBusy(true);
    try {
      const res = await fetch('/api/laps/last', { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error ?? '取消に失敗しました');
      await fetchLive();
    } catch (e) {
      setError(e instanceof Error ? e.message : '取消に失敗しました');
    } finally {
      setBusy(false);
    }
  }, [fetchLive]);

  const doPit = useCallback(async () => {
    const refuelL = Number(pitRefuel !== '' ? pitRefuel : live?.race?.tankCapacityL ?? 0);
    setBusy(true);
    try {
      const res = await fetch('/api/stints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ riderId: pitRiderId || undefined, refuelL }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'ピット処理に失敗しました');
      setShowPit(false);
      setPitRefuel('');
      setOutIn('OUT'); // 新スティント最初の周は OUT
      if (pitRiderId) setRiderId(pitRiderId);
      await fetchLive();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ピット処理に失敗しました');
    } finally {
      setBusy(false);
    }
  }, [pitRefuel, pitRiderId, live, fetchLive]);

  const startRace = useCallback(async () => {
    setBusy(true);
    try {
      await fetch('/api/race-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startRace: true }),
      });
      await fetchLive();
    } finally {
      setBusy(false);
    }
  }, [fetchLive]);

  if (!live) {
    return <div className="text-muted-foreground">読み込み中…</div>;
  }
  if (!live.race) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">ライブ入力</h1>
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            アクティブなレースがありません。「設定」でレースを作成するか、シードを投入してください。
          </CardContent>
        </Card>
      </div>
    );
  }

  const riderName = (id: string | null) => live.riders.find((r) => r.id === id)?.name ?? '-';
  const t = live.tiles;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">ライブ入力</h1>
          <p className="text-muted-foreground text-sm">
            {live.race.raceName} ／ 第 {live.currentStint?.stintNumber ?? '-'} スティント（{riderName(live.currentStint?.riderId ?? null)}）
            ・ 通算 {t.totalLaps}周 / スティント {t.lapsInStint}周
          </p>
        </div>
        {(!live.race.startedAt || new Date(live.race.startedAt).getTime() > Date.now()) && (
          <Button onClick={startRace} disabled={busy} variant="secondary">
            {live.race.startedAt ? '今すぐ開始（設定時刻を上書き）' : 'レース開始（時計スタート）'}
          </Button>
        )}
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive border border-destructive/30 rounded-md px-4 py-2 text-sm">
          {error}
        </div>
      )}

      {/* ライブタイル */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Tile label="残燃料" value={t.fuelRemainingL != null ? `${t.fuelRemainingL.toFixed(2)} L` : '-'} accent />
        <Tile label="可能Lap数" value={t.possibleLaps != null ? t.possibleLaps.toFixed(1) : '-'} accent />
        <Tile
          label="次ピットまで"
          value={`${t.lapsUntilNextPit} 周`}
          sub={t.nextPitInSec != null ? `約 ${formatMinSec(t.nextPitInSec)} 後` : undefined}
          accent
        />
        <Tile label="直近3周平均" value={formatLapTime(t.recent3Avg)} />
        <RaceClockTile startedAt={live.race.startedAt} raceDurationMin={live.race.raceDurationMin} variant="tile" />
        <Tile
          label="着地予測"
          value={t.projectedTotalLaps != null ? `${t.projectedTotalLaps} 周` : '未計測'}
          sub={t.remainingPits != null ? `残ピット ${t.remainingPits}回` : undefined}
        />
      </div>

      {/* 入力パネル */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">ラップ記録</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* タイム: 分 + 秒(小数) */}
          <div className="flex items-end gap-2 flex-wrap">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">分</label>
              <Input
                inputMode="numeric"
                value={minVal}
                onChange={(e) => setMinVal(e.target.value)}
                className="w-20 h-16 text-3xl text-center font-mono"
              />
            </div>
            <div className="text-3xl pb-3">:</div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">秒（小数可 例 26.271）</label>
              <Input
                ref={secRef}
                autoFocus
                inputMode="decimal"
                value={secVal}
                onChange={(e) => setSecVal(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && recordLap()}
                placeholder="26.271"
                className="w-44 h-16 text-3xl text-center font-mono"
              />
            </div>
            <Button variant="outline" onClick={copyPrevious} className="h-10">
              直前周コピー
            </Button>
            <div className="pb-1 text-sm text-muted-foreground">
              → <span className="font-mono text-base text-foreground">
                {secVal.trim() !== '' ? formatLapTime(minSecToSeconds(Number(minVal), Number(secVal))) : '—'}
              </span>
            </div>
          </div>

          {/* 路面 */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground w-10">路面</span>
            {CONDITIONS.map((c) => (
              <button
                key={c}
                onClick={() => setCondition(c)}
                className="px-4 h-10 rounded-md text-sm font-medium border transition-colors"
                style={
                  condition === c
                    ? { backgroundColor: CONDITION_COLOR[c], color: '#fff', borderColor: CONDITION_COLOR[c] }
                    : { borderColor: 'var(--border)' }
                }
              >
                {CONDITION_LABEL[c]}
              </button>
            ))}
          </div>

          {/* OUT / IN */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground w-10">区分</span>
            {(['OUT', 'IN'] as const).map((o) => (
              <button
                key={o}
                onClick={() => setOutIn((prev) => (prev === o ? null : o))}
                className="px-4 h-10 rounded-md text-sm font-medium border transition-colors"
                style={
                  outIn === o
                    ? { backgroundColor: '#111827', color: '#fff', borderColor: '#111827' }
                    : { borderColor: 'var(--border)' }
                }
              >
                {o}
              </button>
            ))}
            <span className="text-xs text-muted-foreground">（通常周はどちらも選択しない）</span>
          </div>

          {/* ライダー */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-10">走者</span>
            <select
              value={riderId}
              onChange={(e) => setRiderId(e.target.value)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              {live.riders.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-2 flex-wrap">
            <Button onClick={recordLap} disabled={busy} className="h-16 text-xl w-full sm:w-auto sm:px-12 font-bold">
              記録する
            </Button>
            <Button onClick={undoLast} disabled={busy} variant="outline" className="h-16 flex-1 sm:flex-none">
              直前を取消
            </Button>
            <Button onClick={() => setShowPit((v) => !v)} disabled={busy} variant="secondary" className="h-16 flex-1 sm:flex-none">
              ピットイン
            </Button>
          </div>

          {/* ピットフォーム */}
          {showPit && (
            <div className="border rounded-md p-4 space-y-3 bg-muted/40">
              <div className="font-medium text-sm">ピットイン → 新スティント</div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground">次の走者</span>
                <select
                  value={pitRiderId}
                  onChange={(e) => setPitRiderId(e.target.value)}
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">（変更なし）</option>
                  {live.riders.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-muted-foreground">給油後 残量L</span>
                <Input
                  inputMode="decimal"
                  value={pitRefuel}
                  onChange={(e) => setPitRefuel(e.target.value)}
                  placeholder={`満タン ${live.race.tankCapacityL}`}
                  className="w-28"
                />
                <Button onClick={doPit} disabled={busy}>
                  確定
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 直近ラップ */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">直近ラップ</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-muted-foreground border-b">
                <tr>
                  <th className="text-left py-2 px-2">Lap</th>
                  <th className="text-left py-2 px-2">走者</th>
                  <th className="text-left py-2 px-2">路面</th>
                  <th className="text-left py-2 px-2">区分</th>
                  <th className="text-right py-2 px-2">タイム</th>
                  <th className="text-right py-2 px-2">使用L</th>
                  <th className="text-right py-2 px-2">残L</th>
                </tr>
              </thead>
              <tbody>
                {live.recentLaps.map((l) => (
                  <tr key={l.id} className="border-b border-border/50">
                    <td className="py-1.5 px-2 font-mono">{l.lapNumber}</td>
                    <td className="py-1.5 px-2">{riderName(l.riderId)}</td>
                    <td className="py-1.5 px-2">
                      <span
                        className="inline-block px-2 py-0.5 rounded-full text-xs text-white whitespace-nowrap"
                        style={{ backgroundColor: CONDITION_COLOR[l.condition] ?? '#6b7280' }}
                      >
                        {CONDITION_LABEL[l.condition] ?? l.condition}
                      </span>
                    </td>
                    <td className="py-1.5 px-2">{l.outIn ?? ''}</td>
                    <td className="py-1.5 px-2 text-right font-mono">{formatLapTime(l.lapTimeSec)}</td>
                    <td className="py-1.5 px-2 text-right font-mono">{l.fuel ? l.fuel.fuelUsedL.toFixed(2) : '-'}</td>
                    <td className="py-1.5 px-2 text-right font-mono">{l.fuel ? l.fuel.fuelRemainingL.toFixed(2) : '-'}</td>
                  </tr>
                ))}
                {live.recentLaps.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-6 text-muted-foreground">
                      まだラップがありません
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Tile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <Card className={accent ? 'accent-bar border-primary/30' : ''}>
      <CardContent className="p-4">
        <div className="text-xs tracking-[0.14em] text-muted-foreground">{label}</div>
        <div className={`font-display text-2xl font-bold ${accent ? 'text-primary' : ''}`}>{value}</div>
        {sub ? <div className="text-[11px] text-muted-foreground mt-0.5 font-mono">{sub}</div> : null}
      </CardContent>
    </Card>
  );
}
