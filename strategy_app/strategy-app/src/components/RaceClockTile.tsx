'use client';

// 残り時間タイル（毎秒ティック）。
// ダッシュボード(page.tsx)はサーバーコンポーネントで再描画されないため、
// クロックだけクライアント側で毎秒進める。startedAt が未来なら開始までのカウントダウン。
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Flag } from 'lucide-react';
import { raceClock } from '@/lib/race-calc';
import { formatMinSec } from '@/lib/time';

interface Props {
  startedAt: string | null;
  raceDurationMin: number;
  variant?: 'stat' | 'tile'; // stat=ダッシュボードのStatCard風 / tile=ライブのTile風
}

function useClockText(startedAt: string | null, raceDurationMin: number) {
  // マウント前は now=null にして SSR と同じ「-」を出す（ハイドレーション不一致回避）
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (now == null) return { value: '-', sub: '' };
  if (!startedAt) return { value: '未計測', sub: 'レース開始で計測開始' };

  const startMs = new Date(startedAt).getTime();
  if (now < startMs) {
    return { value: formatMinSec((startMs - now) / 1000), sub: '開始までカウントダウン' };
  }
  const clock = raceClock(startedAt, raceDurationMin, now);
  if (!clock) return { value: '未計測', sub: '' };
  if (clock.remainingSec <= 0) {
    return { value: '0:00', sub: 'レース終了' };
  }
  return { value: formatMinSec(clock.remainingSec), sub: `経過 ${formatMinSec(clock.elapsedSec)}` };
}

export default function RaceClockTile({ startedAt, raceDurationMin, variant = 'stat' }: Props) {
  const { value, sub } = useClockText(startedAt, raceDurationMin);

  if (variant === 'tile') {
    return (
      <Card>
        <CardContent className="p-4">
          <div className="text-xs text-muted-foreground">残り時間</div>
          <div className="text-xl font-bold font-mono">{value}</div>
          {sub ? <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div> : null}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">残り時間</CardTitle>
        <Flag className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold font-mono">{value}</div>
        {sub ? <p className="text-xs text-muted-foreground">{sub}</p> : null}
      </CardContent>
    </Card>
  );
}
