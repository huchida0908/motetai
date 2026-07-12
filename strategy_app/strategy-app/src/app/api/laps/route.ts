import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getActiveRace } from '@/lib/live';

// ラップを 1 周記録する。
// body: { lapTimeSec: number, condition?: string, outIn?: "OUT"|"IN"|null,
//         riderId?: string, fuelUsedL?: number|null, lapNumber?: number }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const lapTimeSec = Number(body.lapTimeSec);
    if (!Number.isFinite(lapTimeSec) || lapTimeSec <= 0) {
      return NextResponse.json({ error: 'ラップタイム（秒）が不正です' }, { status: 400 });
    }

    const race = await getActiveRace();
    if (!race) {
      return NextResponse.json({ error: 'アクティブなレースがありません' }, { status: 400 });
    }

    // 現在の（未終了の）スティント
    const currentStint = await prisma.stint.findFirst({
      where: { raceConfigId: race.id, endedAt: null },
      orderBy: { stintNumber: 'desc' },
    });

    // 通算ラップ番号 = 既存の最大 + 1
    const maxLap = await prisma.actualLap.aggregate({
      where: { raceConfigId: race.id },
      _max: { lapNumber: true },
    });
    const lapNumber = body.lapNumber != null ? Number(body.lapNumber) : (maxLap._max.lapNumber ?? 0) + 1;

    const condition = typeof body.condition === 'string' && body.condition ? body.condition : 'D';
    const outIn = body.outIn === 'OUT' || body.outIn === 'IN' ? body.outIn : null;
    const riderId = body.riderId ?? currentStint?.riderId ?? null;
    const fuelUsedL = body.fuelUsedL != null && body.fuelUsedL !== '' ? Number(body.fuelUsedL) : null;

    const lap = await prisma.actualLap.create({
      data: {
        raceConfigId: race.id,
        stintId: currentStint?.id ?? null,
        riderId,
        lapNumber,
        lapTimeSec,
        condition,
        outIn,
        fuelUsedL,
      },
    });

    return NextResponse.json({ lap }, { status: 201 });
  } catch (error) {
    console.error('ラップ記録エラー:', error);
    return NextResponse.json({ error: 'ラップの記録に失敗しました' }, { status: 500 });
  }
}
