import { NextRequest, NextResponse } from 'next/server';
import { getActiveRace } from '@/lib/live';
import { getPlanState, overridePlanLap } from '@/lib/plan';

// 周単位の計画を手動上書き（または解除）する。
// body: { lapNumber: number, plannedTimeSec?: number, condition?: string, clear?: boolean }
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const lapNumber = Number(body.lapNumber);
    if (!Number.isInteger(lapNumber) || lapNumber < 1) {
      return NextResponse.json({ error: 'lapNumber が不正です' }, { status: 400 });
    }
    if (body.plannedTimeSec != null && (!Number.isFinite(Number(body.plannedTimeSec)) || Number(body.plannedTimeSec) <= 0)) {
      return NextResponse.json({ error: '計画タイム（秒）が不正です' }, { status: 400 });
    }

    const race = await getActiveRace();
    if (!race) {
      return NextResponse.json({ error: 'アクティブなレースがありません' }, { status: 400 });
    }

    await overridePlanLap(race.id, lapNumber, {
      plannedTimeSec: body.plannedTimeSec != null ? Number(body.plannedTimeSec) : undefined,
      condition: body.condition ?? undefined,
      clear: body.clear === true,
    });

    const state = await getPlanState();
    return NextResponse.json(state);
  } catch (error) {
    console.error('計画ラップ上書きエラー:', error);
    const msg = error instanceof Error ? error.message : '計画ラップの更新に失敗しました';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
