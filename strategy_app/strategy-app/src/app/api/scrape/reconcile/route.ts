import { NextRequest, NextResponse } from 'next/server';
import { fetchCarLaps } from '@/lib/timing-feed';
import { prisma } from '@/lib/prisma';
import { getActiveRace } from '@/lib/live';

// 取得ラップを「計画（PlanLap/PlanStint）」および「既存の実績（ActualLap）」と
// 1 周ごとに突き合わせて返す。取込前の編集グリッドの元データになる。
//
// 各周の初期値（デフォルト）は次の優先順で決める:
//   走者/路面/OUT-IN … 既存の実績があればそれ → 無ければ計画 → 無ければ既定(D/なし)
//   OUT-IN は計画に無くても、取得データの PIT フラグがあれば IN を初期値にする
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 10;

export async function GET(req: NextRequest) {
  const carno = req.nextUrl.searchParams.get('carno')?.trim();
  if (!carno) {
    return NextResponse.json({ error: '車番(carno)を指定してください' }, { status: 400 });
  }

  try {
    const [scraped, race] = await Promise.all([fetchCarLaps(carno), getActiveRace()]);
    if (!race) {
      return NextResponse.json({ error: 'アクティブなレースがありません', laps: [] }, { status: 400 });
    }

    const [planLaps, planStints, actualLaps, riders] = await Promise.all([
      prisma.planLap.findMany({ where: { raceConfigId: race.id }, orderBy: { lapNumber: 'asc' } }),
      prisma.planStint.findMany({ where: { raceConfigId: race.id }, orderBy: { stintNumber: 'asc' } }),
      prisma.actualLap.findMany({ where: { raceConfigId: race.id } }),
      prisma.rider.findMany({ orderBy: { displayOrder: 'asc' } }),
    ]);

    const planByLap = new Map(planLaps.map((p) => [p.lapNumber, p]));
    const actualByLap = new Map(actualLaps.map((a) => [a.lapNumber, a]));

    const laps = scraped.map((l) => {
      const plan = planByLap.get(l.lap);
      const actual = actualByLap.get(l.lap);
      // OUT/IN の初期値: 既存実績があればそれ、無ければ「実際のピット(PITフラグ)」を IN とする。
      // 計画の outIn（予定のピット位置）は実際とズレて二重境界になるため初期値には使わない
      // （計画タイムは plannedTimeSec の比較列で見せる）。
      const outIn = actual?.outIn ?? (l.pit ? 'IN' : null);
      return {
        lapNumber: l.lap,
        lapTimeSec: l.lapTimeSec,
        totalTimeSec: l.totalTimeSec,
        pit: l.pit,
        maxSpeed: l.maxSpeed,
        plannedTimeSec: plan?.plannedTimeSec ?? null,
        riderId: actual?.riderId ?? plan?.riderId ?? null,
        condition: actual?.condition ?? plan?.condition ?? 'D',
        outIn,
        imported: !!actual,
        valid: Number.isFinite(l.lapTimeSec) && l.lapTimeSec > 0,
      };
    });

    return NextResponse.json({
      carno,
      race: {
        id: race.id,
        raceName: race.raceName,
        startedAt: race.startedAt?.toISOString() ?? null,
        tankCapacityL: race.tankCapacityL,
        startFuelL: race.startFuelL,
        maxStintLap: race.maxStintLap,
      },
      riders: riders.map((r) => ({ id: r.id, name: r.name, color: r.color })),
      planStints: planStints.map((s) => ({
        stintNumber: s.stintNumber,
        riderId: s.riderId,
        refuelL: s.refuelL,
        plannedLaps: s.plannedLaps,
      })),
      laps,
      importedCount: actualLaps.length,
    });
  } catch (error) {
    console.error('reconcile 取得エラー:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '取得に失敗しました', laps: [] },
      { status: 502 },
    );
  }
}
