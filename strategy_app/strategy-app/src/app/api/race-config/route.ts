import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getActiveRace } from '@/lib/live';

export async function GET() {
  const race = await getActiveRace();
  return NextResponse.json({ race });
}

// レース設定の更新。数値フィールドと startRace(開始時刻セット) に対応。
const NUM_FIELDS = [
  'raceDurationMin',
  'courseLengthKm',
  'tankCapacityL',
  'startFuelL',
  'pitLossSec',
  'maxStintLap',
  'fuelRateDry',
  'fuelRateWet',
  'fuelRateSc',
  'fuelRateOutIn',
  'assumedLapSec',
  'assumedOutLapSec',
  'assumedInLapSec',
  'assumedWetLapSec',
  'assumedScLapSec',
] as const;

export async function PATCH(req: NextRequest) {
  try {
    const race = await getActiveRace();
    if (!race) {
      return NextResponse.json({ error: 'アクティブなレースがありません' }, { status: 400 });
    }
    const body = await req.json();
    const data: Record<string, unknown> = {};

    if (typeof body.raceName === 'string' && body.raceName.trim()) data.raceName = body.raceName.trim();
    for (const f of NUM_FIELDS) {
      if (body[f] != null && body[f] !== '') data[f] = Number(body[f]);
    }
    // レース開始/リセット
    if (body.startRace === true) data.startedAt = new Date();
    if (body.startRace === false) data.startedAt = null;
    if (typeof body.startedAt === 'string') data.startedAt = new Date(body.startedAt);

    const updated = await prisma.raceConfig.update({ where: { id: race.id }, data });
    return NextResponse.json({ race: updated });
  } catch (error) {
    console.error('レース設定更新エラー:', error);
    return NextResponse.json({ error: 'レース設定の更新に失敗しました' }, { status: 500 });
  }
}
