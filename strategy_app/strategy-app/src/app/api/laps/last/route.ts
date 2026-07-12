import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getActiveRace } from '@/lib/live';

// 直前のラップを 1 件取り消す（入力ミスの即時訂正用）。
export async function DELETE() {
  try {
    const race = await getActiveRace();
    if (!race) {
      return NextResponse.json({ error: 'アクティブなレースがありません' }, { status: 400 });
    }
    const last = await prisma.actualLap.findFirst({
      where: { raceConfigId: race.id },
      orderBy: { lapNumber: 'desc' },
    });
    if (!last) {
      return NextResponse.json({ error: '取り消すラップがありません' }, { status: 404 });
    }
    await prisma.actualLap.delete({ where: { id: last.id } });
    return NextResponse.json({ deleted: last.id });
  } catch (error) {
    console.error('ラップ取消エラー:', error);
    return NextResponse.json({ error: 'ラップの取り消しに失敗しました' }, { status: 500 });
  }
}
