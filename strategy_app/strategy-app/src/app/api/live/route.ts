import { NextResponse } from 'next/server';
import { getLiveState } from '@/lib/live';

// 現在のライブ状態（レース/スティント/燃料/ペース/直近ラップ）を返す。
export async function GET() {
  try {
    const state = await getLiveState(Date.now());
    return NextResponse.json(state);
  } catch (error) {
    console.error('ライブ状態の取得エラー:', error);
    return NextResponse.json({ error: 'ライブ状態の取得に失敗しました' }, { status: 500 });
  }
}
