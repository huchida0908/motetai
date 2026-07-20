'use client';

// 次ピットまでの残り時間を毎秒カウントダウン表示する（「[あと N 周 ／] 約 M:SS 後 ／ 計画 Lap N」）。
// clockMs = live.ts がサーバー側で算出した次ピットの絶対時刻。そこから現在時刻を引くので、
// サーバー再取得（メイン=10秒 / 共有=5秒ポーリング）を待たずに滑らかに減り、上の「予定時刻」とも常に一致する。
// サーバー更新のたびに clockMs が最新の実績・ペースで再計算され、カウントダウンが再アンカーされる。
// マウント前は now=null にして SSR と同じ表示（残り時間を伏せる）にし、ハイドレーション不一致を避ける。
import { useEffect, useState } from 'react';
import { formatMinSec } from '@/lib/time';

export default function PitEta({
  clockMs,
  plannedLap,
  lapsToPit = null,
  plannedLabel = '計画: Lap',
}: {
  clockMs: number | null;
  plannedLap: number | null;
  lapsToPit?: number | null; // 指定時は先頭に「あと N 周」を付ける（共有ダッシュボード用）
  plannedLabel?: string; // 計画ラップのラベル（既定「計画: Lap」）
}) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const parts: string[] = [];
  if (lapsToPit != null) parts.push(`あと ${lapsToPit} 周`);
  if (clockMs != null && now != null) {
    const remainingSec = Math.max(0, (clockMs - now) / 1000);
    parts.push(`約 ${formatMinSec(remainingSec)} 後`);
  }
  if (plannedLap != null) parts.push(`${plannedLabel} ${plannedLap}`);
  return <>{parts.join(' ／ ') || '—'}</>;
}
