import { NextRequest, NextResponse } from 'next/server';
import { fetchCarLaps } from '@/lib/timing-feed';

// 複数車の全ラップを計時サーバーから並列取得する（分析画面用）。
//   GET /api/analysis/cars?carnos=7,11,23
// 計時フィードはサーバー専用（socket 接続）なのでクライアントから直接は叩けず、
// このルート経由で取得する。1 車が失敗しても他車は返す（部分失敗を許容）。
export const runtime = 'nodejs'; // socket 接続のため Node ランタイム必須
export const dynamic = 'force-dynamic';
export const maxDuration = 30; // 複数車を並列取得する余裕をみて長め

const MAX_CARS = 10; // 1 リクエストで比較できる車数の上限（socket 接続数の暴発防止）

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('carnos')?.trim();
  const carnos = [...new Set((raw ?? '').split(',').map((s) => s.trim()).filter(Boolean))].slice(0, MAX_CARS);

  if (carnos.length === 0) {
    return NextResponse.json({ error: '車番(carnos)を指定してください', cars: [] }, { status: 400 });
  }

  const settled = await Promise.allSettled(carnos.map((c) => fetchCarLaps(c)));
  const cars = settled.map((r, i) => {
    const carno = carnos[i];
    if (r.status === 'fulfilled') return { carno, laps: r.value, error: null };
    console.error(`ラップ取得エラー(#${carno}):`, r.reason);
    return {
      carno,
      laps: [],
      error: r.reason instanceof Error ? r.reason.message : 'ラップ取得に失敗しました',
    };
  });

  // 全滅なら 502（計時サーバー自体に到達できていない可能性が高い）
  const allFailed = cars.every((c) => c.error);
  return NextResponse.json({ cars }, { status: allFailed ? 502 : 200 });
}
