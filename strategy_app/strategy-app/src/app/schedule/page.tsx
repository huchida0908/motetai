'use client';

// デイリースケジュール: 計画スティントを時刻軸に展開し、
// 「何時から何時に誰が・何周・目標アベレージ・給油・タイヤ交換」を一目で見せる。
// 表示本体は ScheduleTimeline コンポーネント（/share と共通）。ここはデータ取得と枠のみ。
import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import ScheduleTimeline, { type PlanResponse } from '@/components/ScheduleTimeline';

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

  return (
    <div className="space-y-4 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">スケジュール</h1>
        <p className="mt-0.5 text-[10px] tracking-[0.3em] text-muted-foreground uppercase">Day Plan ・ {race.raceName}</p>
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive border border-destructive/30 rounded-md px-4 py-2 text-sm">{error}</div>
      )}

      <ScheduleTimeline plan={plan} />
    </div>
  );
}
