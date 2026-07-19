'use client';

// 残り時間タイル（毎秒ティック）。
// ダッシュボード(page.tsx)はサーバーコンポーネントで再描画されないため、
// クロックだけクライアント側で毎秒進める。startedAt が未来なら開始までのカウントダウン。
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PanelLabel } from '@/components/panel-label';
import { Flag } from 'lucide-react';
import { raceClock } from '@/lib/race-calc';
import { formatHourMin, formatMinSec } from '@/lib/time';

interface Props {
  startedAt: string | null;
  raceDurationMin: number;
  // stat=カード(大) / tile=カード(小) / hero=タイミングストリップ用(カード無し・特大) / bare=ミニ計器帯用(カード無し・小)
  variant?: 'stat' | 'tile' | 'hero' | 'bare';
}

function useClockText(startedAt: string | null, raceDurationMin: number) {
  // マウント前は now=null にして SSR と同じ「-」を出す（ハイドレーション不一致回避）
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (now == null) return { value: '-', sub: '', urgent: false };
  if (!startedAt) return { value: '未計測', sub: 'レース開始で計測開始', urgent: false };

  const startMs = new Date(startedAt).getTime();
  if (now < startMs) {
    // 開始までのカウントダウンは短時間なので秒精度（M:SS）のまま
    return { value: formatMinSec((startMs - now) / 1000), sub: '開始までカウントダウン', urgent: false };
  }
  const clock = raceClock(startedAt, raceDurationMin, now);
  if (!clock) return { value: '未計測', sub: '', urgent: false };
  if (clock.remainingSec <= 0) {
    return { value: '0:00', sub: 'レース終了', urgent: false };
  }
  // 残り時間・経過は 時間と分（H時間M分）で表示。残り10分を切ったら警告扱い
  return {
    value: formatHourMin(clock.remainingSec),
    sub: `経過 ${formatHourMin(clock.elapsedSec)}`,
    urgent: clock.remainingSec <= 600,
  };
}

export default function RaceClockTile({ startedAt, raceDurationMin, variant = 'stat' }: Props) {
  const { value, sub, urgent } = useClockText(startedAt, raceDurationMin);

  // 残り10分を切ったら赤発光で警告（終了・未計測時は通常色）
  const valueClass = urgent ? 'text-primary text-glow-red' : '';

  if (variant === 'hero') {
    return (
      <div className="p-4 flex flex-col justify-center">
        <PanelLabel>残り時間 / Remaining</PanelLabel>
        <div className={`font-display text-4xl md:text-5xl font-bold leading-tight ${valueClass}`}>{value}</div>
        {sub ? <div className="text-xs text-muted-foreground font-mono">{sub}</div> : null}
      </div>
    );
  }

  if (variant === 'bare') {
    return (
      <div className="p-3">
        <div className="text-[10px] tracking-[0.16em] text-muted-foreground">残り時間</div>
        <div className={`font-display text-xl font-bold ${valueClass}`}>{value}</div>
        {sub ? <div className="text-[10px] text-muted-foreground font-mono truncate">{sub}</div> : null}
      </div>
    );
  }

  if (variant === 'tile') {
    return (
      <Card className="accent-bar">
        <CardContent className="p-4">
          <div className="text-xs tracking-[0.14em] text-muted-foreground">残り時間</div>
          <div className={`font-display text-2xl font-bold ${valueClass}`}>{value}</div>
          {sub ? <div className="text-[11px] text-muted-foreground mt-0.5 font-mono">{sub}</div> : null}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="accent-bar">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium tracking-[0.1em]">残り時間</CardTitle>
        <Flag className="h-4 w-4 text-primary/70" />
      </CardHeader>
      <CardContent>
        <div className={`font-display text-3xl font-bold ${valueClass}`}>{value}</div>
        {sub ? <p className="text-xs text-muted-foreground font-mono">{sub}</p> : null}
      </CardContent>
    </Card>
  );
}
