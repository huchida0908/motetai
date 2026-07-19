import { NextResponse } from 'next/server';
import { fetchTeams } from '@/lib/timing-feed';

// 計時サーバーから全チーム一覧（順位付き）を取得する。取込UIの車番セレクタ用。
export const runtime = 'nodejs'; // socket 接続のため Node ランタイム必須（Edge 不可）
export const dynamic = 'force-dynamic';
export const maxDuration = 10;

export async function GET() {
  try {
    const teams = await fetchTeams();
    return NextResponse.json({ teams });
  } catch (error) {
    console.error('チーム一覧取得エラー:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'チーム一覧の取得に失敗しました', teams: [] },
      { status: 502 },
    );
  }
}
