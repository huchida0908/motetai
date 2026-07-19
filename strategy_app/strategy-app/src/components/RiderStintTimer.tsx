'use client';

// ライダー走行経過タイマー。現在の走者が走り始めてからの経過時間を毎秒カウントアップ表示する。
// （「交代まで残り」は誤解を招くため、経過時間そのものを見せる方針）
//   hero   … 経過時間を大きく＋走行開始時刻を小さく（共有ページ Current Rider 用）
//   inline … 「走行 M:SS 経過」の 1 行コンパクト（ダッシュボードのタイル用）
// 60分規定（RIDER_MAX_STINT_MIN）に近づくと警告色: 残り5分（=55分以上）でアンバー、60分超で赤。
// startedAt が null もしくは未来（レース未開始）のときは「—」。
import { useEffect, useState } from 'react';
import { RIDER_MAX_STINT_MIN } from '@/lib/constants';
import { formatMinSec } from '@/lib/time';

interface Props {
  startedAt: string | null;
  maxStintMin?: number;
  variant?: 'hero' | 'inline';
}

function pad2(n: number) {
  return String(n).padStart(2, '0');
}
function clockText(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getHours()}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

export default function RiderStintTimer({ startedAt, maxStintMin = RIDER_MAX_STINT_MIN, variant = 'inline' }: Props) {
  // マウント前は now=null（SSR と同じ「-」を出してハイドレーション不一致を避ける）
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const startMs = startedAt ? new Date(startedAt).getTime() : null;
  const limitSec = maxStintMin * 60;
  // まだ走り始めていない（開始時刻が未来 or 未設定）場合は「—」。
  const started = now != null && startMs != null && now >= startMs;
  const elapsedSec = started ? (now! - startMs!) / 1000 : null;

  const over = elapsedSec != null && elapsedSec >= limitSec; // 60分超過
  const urgent = elapsedSec != null && elapsedSec >= limitSec - 300 && !over; // 残り5分（=55分以上）
  const elapsedText = elapsedSec == null ? '—' : formatMinSec(elapsedSec);
  const colorClass = over ? 'text-destructive text-glow-red' : urgent ? 'text-primary text-glow-red' : '';

  if (variant === 'hero') {
    return (
      <div>
        <div className="text-[10px] tracking-[0.16em] text-muted-foreground">走行経過 / Elapsed（{maxStintMin}分で交代）</div>
        <div className={`font-display text-5xl font-bold leading-none ${colorClass}`}>{elapsedText}</div>
        <div className="mt-1 text-xs text-muted-foreground font-mono">走行開始 {clockText(startedAt)}</div>
      </div>
    );
  }

  // inline
  return <span className={`font-mono ${colorClass}`}>走行 {elapsedText} 経過</span>;
}
