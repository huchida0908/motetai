import { NextRequest, NextResponse } from 'next/server';
import { getActiveRace } from '@/lib/live';
import { getPlanState, overridePlanLap, syncStintRidersFromLaps } from '@/lib/plan';

interface OverrideInput {
  lapNumber: number;
  plannedTimeSec?: number;
  condition?: string;
  riderId?: string | null;
  clear?: boolean;
}

// 周単位の計画を手動上書き（または解除）する。
// 単一:   { lapNumber, plannedTimeSec?, condition?, riderId?, clear? }
// バッチ: { overrides: [{ lapNumber, plannedTimeSec?, condition?, riderId?, clear? }, ...] }
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const rawList: unknown[] = Array.isArray(body.overrides) ? body.overrides : [body];
    if (rawList.length === 0) {
      return NextResponse.json({ error: '上書き対象がありません' }, { status: 400 });
    }

    // 入力を検証しつつ正規化
    const overrides: OverrideInput[] = [];
    for (const raw of rawList) {
      const o = raw as Record<string, unknown>;
      const lapNumber = Number(o.lapNumber);
      if (!Number.isInteger(lapNumber) || lapNumber < 1) {
        return NextResponse.json({ error: 'lapNumber が不正です' }, { status: 400 });
      }
      if (o.plannedTimeSec != null && (!Number.isFinite(Number(o.plannedTimeSec)) || Number(o.plannedTimeSec) <= 0)) {
        return NextResponse.json({ error: `Lap ${lapNumber}: 計画タイム（秒）が不正です` }, { status: 400 });
      }
      overrides.push({
        lapNumber,
        plannedTimeSec: o.plannedTimeSec != null ? Number(o.plannedTimeSec) : undefined,
        condition: typeof o.condition === 'string' ? o.condition : undefined,
        // riderId は「キーが存在するときだけ」上書き対象（'' → null で未定へ）
        riderId: 'riderId' in o ? ((o.riderId as string) || null) : undefined,
        clear: o.clear === true,
      });
    }

    const race = await getActiveRace();
    if (!race) {
      return NextResponse.json({ error: 'アクティブなレースがありません' }, { status: 400 });
    }

    // 各周を順に適用（overridePlanLap は 1 周ずつ findUnique+update）。
    // 件数は多くないため直列で十分。1 件でも失敗すれば 500 を返し、クライアントが再取得する。
    for (const o of overrides) {
      await overridePlanLap(race.id, o.lapNumber, {
        plannedTimeSec: o.plannedTimeSec,
        condition: o.condition,
        riderId: o.riderId,
        clear: o.clear,
      });
    }

    // 走者を触った場合は、スティントの全周が同一走者になったら PlanStint.riderId に反映する
    // （走行済みスティントの担当を per-lap で丸ごと変えたとき、スティント構成表・次走者にも伝播）
    const touchedRider = overrides.some((o) => o.riderId !== undefined || o.clear);
    if (touchedRider) await syncStintRidersFromLaps(race.id);

    const state = await getPlanState();
    return NextResponse.json(state);
  } catch (error) {
    console.error('計画ラップ上書きエラー:', error);
    const msg = error instanceof Error ? error.message : '計画ラップの更新に失敗しました';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
