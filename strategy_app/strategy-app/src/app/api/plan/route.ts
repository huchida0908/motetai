import { NextRequest, NextResponse } from 'next/server';
import { getActiveRace } from '@/lib/live';
import { getPlanState, savePlanStints, PlanInputError } from '@/lib/plan';
import type { PlanStintInput } from '@/lib/plan-calc';

// 計画（スティント＋周単位展開＋集計）を返す
export async function GET() {
  try {
    const state = await getPlanState();
    return NextResponse.json(state);
  } catch (error) {
    console.error('計画取得エラー:', error);
    return NextResponse.json({ error: '計画の取得に失敗しました' }, { status: 500 });
  }
}

// スティント計画を丸ごと保存（周単位に再展開）。
// body: { stints: PlanStintInput[], keepOverrides?: boolean, freezeCompleted?: boolean }
// freezeCompleted=true はレース中の保存: 消化済み周の計画は変更せず、以降のみ再展開する。
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const stints = body.stints as PlanStintInput[] | undefined;
    if (!Array.isArray(stints)) {
      return NextResponse.json({ error: 'stints が不正です' }, { status: 400 });
    }
    for (const s of stints) {
      const laps = Number(s.plannedLaps);
      const refuel = Number(s.refuelL);
      if (!Number.isInteger(laps) || laps < 1) {
        return NextResponse.json({ error: `スティント${s.stintNumber}: 周回数は1以上の整数で指定してください` }, { status: 400 });
      }
      // 給油量は追加分なので 0（無給油ピット＝ライダー交代のみ）も許可
      if (!Number.isFinite(refuel) || refuel < 0) {
        return NextResponse.json({ error: `スティント${s.stintNumber}: 給油量（L）は0以上で指定してください` }, { status: 400 });
      }
    }

    const race = await getActiveRace();
    if (!race) {
      return NextResponse.json({ error: 'アクティブなレースがありません' }, { status: 400 });
    }

    await savePlanStints(race.id, stints, body.keepOverrides === true, body.freezeCompleted === true);
    const state = await getPlanState();
    return NextResponse.json(state);
  } catch (error) {
    if (error instanceof PlanInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('計画保存エラー:', error);
    return NextResponse.json({ error: '計画の保存に失敗しました' }, { status: 500 });
  }
}
