import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getActiveRace } from '@/lib/live';

// ピットイン → 次スティント開始。
// 現在の未終了スティントを終了し、給油量・次ライダーで新スティントを作る。
// body: { riderId?: string, refuelL: number, plannedLaps?: number, note?: string }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const refuelL = Number(body.refuelL);
    if (!Number.isFinite(refuelL) || refuelL < 0) {
      return NextResponse.json({ error: '給油量（L）が不正です' }, { status: 400 });
    }

    const race = await getActiveRace();
    if (!race) {
      return NextResponse.json({ error: 'アクティブなレースがありません' }, { status: 400 });
    }

    const now = new Date();
    const current = await prisma.stint.findFirst({
      where: { raceConfigId: race.id, endedAt: null },
      orderBy: { stintNumber: 'desc' },
    });
    if (current) {
      await prisma.stint.update({ where: { id: current.id }, data: { endedAt: now } });
    }

    const maxStint = await prisma.stint.aggregate({
      where: { raceConfigId: race.id },
      _max: { stintNumber: true },
    });
    const stintNumber = (maxStint._max.stintNumber ?? 0) + 1;

    const stint = await prisma.stint.create({
      data: {
        raceConfigId: race.id,
        stintNumber,
        riderId: body.riderId ?? current?.riderId ?? null,
        refuelL,
        plannedLaps: body.plannedLaps != null ? Number(body.plannedLaps) : null,
        startedAt: now,
        note: body.note ?? null,
      },
    });

    return NextResponse.json({ stint }, { status: 201 });
  } catch (error) {
    console.error('スティント開始エラー:', error);
    return NextResponse.json({ error: 'スティントの開始に失敗しました' }, { status: 500 });
  }
}
