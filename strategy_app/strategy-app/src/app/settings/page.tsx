'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatLapTime, minSecToSeconds, toDatetimeLocal } from '@/lib/time';

interface Race {
  id: string;
  raceName: string;
  raceDurationMin: number;
  startedAt: string | null;
  courseLengthKm: number;
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
}
interface Rider {
  id: string;
  name: string;
  expectedLapTime: number;
  defaultFuelRate: number | null;
  color: string | null;
}

const NUM_FIELDS: { key: keyof Race; label: string; step?: string }[] = [
  { key: 'raceDurationMin', label: 'レース時間(分)' },
  { key: 'courseLengthKm', label: 'コース長(km)', step: '0.001' },
  { key: 'tankCapacityL', label: 'タンク容量(L)', step: '0.1' },
  { key: 'startFuelL', label: 'スタート燃料(L)', step: '0.1' },
  { key: 'pitLossSec', label: '想定ピット(秒)' },
  { key: 'maxStintLap', label: '最大スティント周回' },
  { key: 'fuelRateDry', label: '燃費 ドライ(L/周)', step: '0.01' },
  { key: 'fuelRateWet', label: '燃費 ウェット(L/周)', step: '0.01' },
  { key: 'fuelRateSc', label: '燃費 SC(L/周)', step: '0.01' },
  { key: 'fuelRateOutIn', label: '燃費 OUT/IN(L/周)', step: '0.01' },
  { key: 'assumedLapSec', label: '想定Lap(秒)', step: '0.001' },
  { key: 'assumedOutLapSec', label: '想定OUT(秒)', step: '0.001' },
  { key: 'assumedInLapSec', label: '想定IN(秒)', step: '0.001' },
  { key: 'assumedWetLapSec', label: '想定ウェット(秒)', step: '0.001' },
  { key: 'assumedScLapSec', label: '想定SC(秒)', step: '0.001' },
];

export default function SettingsPage() {
  const [race, setRace] = useState<Race | null>(null);
  const [riders, setRiders] = useState<Rider[]>([]);
  const [msg, setMsg] = useState('');
  const [newRider, setNewRider] = useState({ name: '', lapMin: '2', lapSec: '26', color: '#3b82f6' });
  // 編集中ライダー（分・秒に分解して保持）。null なら編集していない
  const [editRider, setEditRider] = useState<{ id: string; name: string; lapMin: string; lapSec: string } | null>(null);

  // 開始/終了時刻（datetime-local 値）。両方入力するとレース時間(分)を自動計算する
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');

  const load = useCallback(async () => {
    const [rc, rd] = await Promise.all([
      fetch('/api/race-config').then((r) => r.json()),
      fetch('/api/riders').then((r) => r.json()),
    ]);
    setRace(rc.race);
    setRiders(rd.riders);
    const loaded: Race | null = rc.race;
    if (loaded?.startedAt) {
      setStartTime(toDatetimeLocal(loaded.startedAt));
      setEndTime(toDatetimeLocal(new Date(new Date(loaded.startedAt).getTime() + loaded.raceDurationMin * 60000)));
    } else {
      setStartTime('');
      setEndTime('');
    }
  }, []);

  // 開始・終了の両方が有効なら差からレース時間(分)を導出。終了≦開始は invalid
  const autoDuration = (() => {
    if (!startTime || !endTime) return null;
    const s = new Date(startTime).getTime();
    const e = new Date(endTime).getTime();
    if (Number.isNaN(s) || Number.isNaN(e)) return null;
    return { min: (e - s) / 60000, invalid: e <= s };
  })();

  useEffect(() => {
    load();
  }, [load]);

  const saveRace = useCallback(async () => {
    if (!race) return;
    if (autoDuration?.invalid) {
      setMsg('終了時刻は開始時刻より後にしてください');
      return;
    }
    setMsg('保存中…');
    const body: Record<string, unknown> = { ...race };
    if (startTime) body.startedAt = new Date(startTime).toISOString();
    if (autoDuration && !autoDuration.invalid) body.raceDurationMin = autoDuration.min;
    const res = await fetch('/api/race-config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setMsg(res.ok ? '保存しました' : '保存に失敗しました');
    setTimeout(() => setMsg(''), 2000);
    if (res.ok) await load();
  }, [race, startTime, autoDuration, load]);

  const clearStart = useCallback(async () => {
    if (!confirm('開始時刻をクリアします（レースクロックが未計測に戻ります）。よろしいですか？')) return;
    await fetch('/api/race-config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startRace: false }),
    });
    await load();
  }, [load]);

  const addRider = useCallback(async () => {
    if (!newRider.name.trim()) return;
    await fetch('/api/riders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newRider.name,
        color: newRider.color,
        expectedLapTime: minSecToSeconds(Number(newRider.lapMin), Number(newRider.lapSec)),
      }),
    });
    setNewRider({ name: '', lapMin: '2', lapSec: '26', color: '#3b82f6' });
    await load();
  }, [newRider, load]);

  // 既存ライダーの名前・タイム編集を開始（秒を分・秒に分解してフォームへ）
  const startEditRider = useCallback((r: Rider) => {
    const min = Math.floor(r.expectedLapTime / 60);
    const sec = Number((r.expectedLapTime - min * 60).toFixed(3));
    setEditRider({ id: r.id, name: r.name, lapMin: String(min), lapSec: String(sec) });
  }, []);

  const saveEditRider = useCallback(async () => {
    if (!editRider) return;
    if (!editRider.name.trim()) {
      setMsg('名前を入力してください');
      setTimeout(() => setMsg(''), 2000);
      return;
    }
    const sec = minSecToSeconds(Number(editRider.lapMin), Number(editRider.lapSec));
    if (sec <= 0) {
      setMsg('タイムは 0 より大きくしてください');
      setTimeout(() => setMsg(''), 2000);
      return;
    }
    await fetch(`/api/riders/${editRider.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editRider.name, expectedLapTime: sec }),
    });
    setEditRider(null);
    await load();
  }, [editRider, load]);

  const deleteRider = useCallback(
    async (id: string) => {
      if (!confirm('このライダーを削除しますか？')) return;
      await fetch(`/api/riders/${id}`, { method: 'DELETE' });
      await load();
    },
    [load],
  );

  if (!race) return <div className="text-muted-foreground">読み込み中…</div>;

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">設定</h1>
        <p className="mt-0.5 text-[10px] tracking-[0.3em] text-muted-foreground uppercase">Setup</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>レース設定</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">レース名</label>
            <Input value={race.raceName} onChange={(e) => setRace({ ...race, raceName: e.target.value })} className="max-w-xs" />
          </div>

          {/* 開始/終了時刻 → レース時間の自動計算 */}
          <div className="border rounded-md p-3 bg-muted/30 space-y-2">
            <div className="text-sm font-medium">レース時間（開始・終了時刻から自動計算）</div>
            <div className="flex items-end gap-3 flex-wrap">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">開始時刻</label>
                <Input
                  type="datetime-local"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-56"
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">終了時刻</label>
                <Input
                  type="datetime-local"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-56"
                />
              </div>
              {race.startedAt && (
                <Button variant="outline" onClick={clearStart}>開始時刻をクリア</Button>
              )}
            </div>
            {autoDuration?.invalid ? (
              <p className="text-xs text-destructive">終了時刻は開始時刻より後にしてください</p>
            ) : autoDuration ? (
              <p className="text-xs text-muted-foreground">
                レース時間 {autoDuration.min} 分として保存されます。開始時刻になるとクロックが自動で動き出します
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                両方入力するとレース時間(分)を自動計算します。開始時刻のみ空欄の場合は従来どおり「レース開始」ボタンで計測開始。
                開始時刻は「スケジュール」ページの時刻表示の基準にもなります
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {NUM_FIELDS.map((f) => {
              const isAutoDuration = f.key === 'raceDurationMin' && autoDuration != null && !autoDuration.invalid;
              return (
                <div key={f.key}>
                  <label className="block text-xs text-muted-foreground mb-1">
                    {f.label}
                    {isAutoDuration ? '（自動計算）' : ''}
                  </label>
                  <Input
                    type="number"
                    step={f.step ?? '1'}
                    value={isAutoDuration ? String(autoDuration.min) : String(race[f.key])}
                    disabled={isAutoDuration}
                    onChange={(e) => setRace({ ...race, [f.key]: Number(e.target.value) })}
                  />
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={saveRace}>保存</Button>
            {msg && <span className="text-sm text-muted-foreground">{msg}</span>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>ライダー</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            {riders.map((r) => (
              <div key={r.id} className="flex items-center gap-3 text-sm flex-wrap">
                <span className="inline-block w-4 h-4 rounded-full" style={{ backgroundColor: r.color ?? '#999' }} />
                {editRider?.id === r.id ? (
                  <>
                    <Input
                      value={editRider.name}
                      onChange={(e) => setEditRider({ ...editRider, name: e.target.value })}
                      className="w-28"
                      aria-label="名前"
                    />
                    <Input
                      type="number"
                      min="0"
                      step="1"
                      value={editRider.lapMin}
                      onChange={(e) => setEditRider({ ...editRider, lapMin: e.target.value })}
                      className="w-16"
                      aria-label="分"
                    />
                    <span className="text-muted-foreground">分</span>
                    <Input
                      type="number"
                      min="0"
                      step="0.001"
                      value={editRider.lapSec}
                      onChange={(e) => setEditRider({ ...editRider, lapSec: e.target.value })}
                      className="w-24"
                      aria-label="秒"
                    />
                    <span className="text-muted-foreground">秒</span>
                    <Button size="sm" onClick={saveEditRider}>保存</Button>
                    <Button variant="ghost" size="sm" onClick={() => setEditRider(null)}>キャンセル</Button>
                  </>
                ) : (
                  <>
                    <span className="w-28 font-medium">{r.name}</span>
                    <span className="text-muted-foreground">想定 {formatLapTime(r.expectedLapTime)}</span>
                    <Button variant="ghost" size="sm" onClick={() => startEditRider(r)}>編集</Button>
                  </>
                )}
                <Button variant="ghost" size="sm" onClick={() => deleteRider(r.id)} className="ml-auto text-destructive">
                  削除
                </Button>
              </div>
            ))}
          </div>
          <div className="flex items-end gap-2 flex-wrap border-t pt-4">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">名前</label>
              <Input value={newRider.name} onChange={(e) => setNewRider({ ...newRider, name: e.target.value })} className="w-32" />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">想定Lap 分</label>
              <Input
                type="number"
                min="0"
                step="1"
                value={newRider.lapMin}
                onChange={(e) => setNewRider({ ...newRider, lapMin: e.target.value })}
                className="w-16"
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">秒</label>
              <Input
                type="number"
                min="0"
                step="0.001"
                value={newRider.lapSec}
                onChange={(e) => setNewRider({ ...newRider, lapSec: e.target.value })}
                className="w-24"
              />
            </div>
            <span className="text-sm text-muted-foreground pb-2">
              = {newRider.lapSec.trim() !== '' || newRider.lapMin.trim() !== ''
                ? formatLapTime(minSecToSeconds(Number(newRider.lapMin), Number(newRider.lapSec)))
                : '—'}
            </span>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">色</label>
              <Input
                type="color"
                value={newRider.color}
                onChange={(e) => setNewRider({ ...newRider, color: e.target.value })}
                className="w-16 p-1"
              />
            </div>
            <Button onClick={addRider}>追加</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
