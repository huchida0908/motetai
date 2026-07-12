'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Race {
  id: string;
  raceName: string;
  raceDurationMin: number;
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
  const [newRider, setNewRider] = useState({ name: '', expectedLapTime: '146', color: '#3b82f6' });

  const load = useCallback(async () => {
    const [rc, rd] = await Promise.all([
      fetch('/api/race-config').then((r) => r.json()),
      fetch('/api/riders').then((r) => r.json()),
    ]);
    setRace(rc.race);
    setRiders(rd.riders);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const saveRace = useCallback(async () => {
    if (!race) return;
    setMsg('保存中…');
    const res = await fetch('/api/race-config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(race),
    });
    setMsg(res.ok ? '保存しました' : '保存に失敗しました');
    setTimeout(() => setMsg(''), 2000);
  }, [race]);

  const addRider = useCallback(async () => {
    if (!newRider.name.trim()) return;
    await fetch('/api/riders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newRider),
    });
    setNewRider({ name: '', expectedLapTime: '146', color: '#3b82f6' });
    await load();
  }, [newRider, load]);

  const deleteRider = useCallback(
    async (id: string) => {
      if (!confirm('このドライバーを削除しますか？')) return;
      await fetch(`/api/riders/${id}`, { method: 'DELETE' });
      await load();
    },
    [load],
  );

  if (!race) return <div className="text-muted-foreground">読み込み中…</div>;

  return (
    <div className="space-y-6 max-w-4xl">
      <h1 className="text-3xl font-bold tracking-tight">設定</h1>

      <Card>
        <CardHeader>
          <CardTitle>レース設定</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">レース名</label>
            <Input value={race.raceName} onChange={(e) => setRace({ ...race, raceName: e.target.value })} className="max-w-xs" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {NUM_FIELDS.map((f) => (
              <div key={f.key}>
                <label className="block text-xs text-muted-foreground mb-1">{f.label}</label>
                <Input
                  type="number"
                  step={f.step ?? '1'}
                  value={String(race[f.key])}
                  onChange={(e) => setRace({ ...race, [f.key]: Number(e.target.value) })}
                />
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={saveRace}>保存</Button>
            {msg && <span className="text-sm text-muted-foreground">{msg}</span>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>ドライバー</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            {riders.map((r) => (
              <div key={r.id} className="flex items-center gap-3 text-sm">
                <span className="inline-block w-4 h-4 rounded-full" style={{ backgroundColor: r.color ?? '#999' }} />
                <span className="w-28 font-medium">{r.name}</span>
                <span className="text-muted-foreground">想定 {r.expectedLapTime.toFixed(2)}s</span>
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
              <label className="block text-xs text-muted-foreground mb-1">想定Lap(秒)</label>
              <Input
                type="number"
                step="0.001"
                value={newRider.expectedLapTime}
                onChange={(e) => setNewRider({ ...newRider, expectedLapTime: e.target.value })}
                className="w-28"
              />
            </div>
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
