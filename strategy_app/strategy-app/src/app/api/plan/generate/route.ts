import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getActiveRace } from '@/lib/live';
import { getPlanState, savePlanStints } from '@/lib/plan';
import { generateInitialPlan } from '@/lib/plan-calc';

// 初期計画の自動生成。既存の計画（上書き含む）は破棄して置き換える。
export async function POST() {
  try {
    const race = await getActiveRace();
    if (!race) {
      return NextResponse.json({ error: 'アクティブなレースがありません' }, { status: 400 });
    }

    const riders = await prisma.rider.findMany({ orderBy: { displayOrder: 'asc' } });
    const stints = generateInitialPlan(race, riders);
    if (stints.length === 0) {
      return NextResponse.json({ error: '計画を生成できませんでした（レース設定を確認してください）' }, { status: 400 });
    }

    await savePlanStints(race.id, stints, false);
    const state = await getPlanState();
    return NextResponse.json(state, { status: 201 });
  } catch (error) {
    console.error('計画自動生成エラー:', error);
    return NextResponse.json({ error: '計画の自動生成に失敗しました' }, { status: 500 });
  }
}
