import { NextRequest, NextResponse } from 'next/server';
import { fetchCarLaps } from '@/lib/timing-feed';
import { prisma } from '@/lib/prisma';
import { getActiveRace } from '@/lib/live';

// 指定車番の全ラップを計時サーバーから取得し、
// アクティブレースの実績(ActualLap)と突合して「取込済み周番号」も返す。
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 10;

export async function GET(req: NextRequest) {
  const carno = req.nextUrl.searchParams.get('carno')?.trim();
  if (!carno) {
    return NextResponse.json({ error: '車番(carno)を指定してください' }, { status: 400 });
  }

  try {
    const [laps, race] = await Promise.all([fetchCarLaps(carno), getActiveRace()]);

    let importedLapNumbers: number[] = [];
    if (race) {
      const existing = await prisma.actualLap.findMany({
        where: { raceConfigId: race.id },
        select: { lapNumber: true },
      });
      importedLapNumbers = existing.map((l) => l.lapNumber);
    }

    return NextResponse.json({
      carno,
      laps,
      importedLapNumbers,
      hasActiveRace: !!race,
      raceName: race?.raceName ?? null,
    });
  } catch (error) {
    console.error('ラップ取得エラー:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'ラップの取得に失敗しました',
        laps: [],
        importedLapNumbers: [],
      },
      { status: 502 },
    );
  }
}
