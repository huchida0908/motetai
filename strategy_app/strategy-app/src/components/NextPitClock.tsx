'use client';

// 次ピットの予定時刻（実績追従）をローカルタイムゾーンで表示する小コンポーネント。
// ms は live.ts がサーバー側で算出した絶対時刻（nowMs + 残り時間）。
// サーバーで整形すると Vercel の UTC になってしまうため、必ずクライアントで整形する。
// マウント前は SSR と同じ '—' を出してハイドレーション不一致を避ける（RaceClockTile と同方針）。
import { useEffect, useState } from 'react';
import { formatClockFromMs } from '@/lib/time';

export default function NextPitClock({ ms }: { ms: number | null }) {
  const [text, setText] = useState('—');
  useEffect(() => {
    setText(ms != null ? formatClockFromMs(ms) : '—');
  }, [ms]);
  return <>{text}</>;
}
