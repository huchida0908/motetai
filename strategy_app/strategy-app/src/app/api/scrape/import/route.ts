import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getActiveRace } from '@/lib/live';

// 計時サーバー由来のラップを実績(ActualLap)へ取り込む。
// 1周だけでも、未取込をまとめてでも、同じエンドポイントで受ける（body.laps の件数で決まる）。
//
// body: {
//   laps: Array<{ lap: number; lapTimeSec: number; pit?: boolean }>,
//   condition?: string,            // 路面。既定 'D'（フィードに路面情報が無いため）
//   applyOutInFromPit?: boolean,   // PIT フラグの周を IN 扱いにするか。既定 true
//   riderId?: string,              // 明示しなければ現在の未終了スティントのライダーを継承
// }
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ImportLap {
  lap: number;
  lapTimeSec: number;
  pit?: boolean;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const laps: ImportLap[] = Array.isArray(body.laps) ? body.laps : [];
    if (laps.length === 0) {
      return NextResponse.json({ error: '取込対象のラップがありません' }, { status: 400 });
    }

    const race = await getActiveRace();
    if (!race) {
      return NextResponse.json({ error: 'アクティブなレースがありません' }, { status: 400 });
    }

    const condition = typeof body.condition === 'string' && body.condition ? body.condition : 'D';
    const applyOutIn = body.applyOutInFromPit !== false; // 既定 true

    // 現在の（未終了の）スティント。実績ラップの所属とライダー継承に使う（既存 /api/laps と同じ方針）。
    const currentStint = await prisma.stint.findFirst({
      where: { raceConfigId: race.id, endedAt: null },
      orderBy: { stintNumber: 'desc' },
    });
    const riderId: string | null = body.riderId ?? currentStint?.riderId ?? null;

    // 既存の周番号（重複取込を弾く）
    const existing = await prisma.actualLap.findMany({
      where: { raceConfigId: race.id },
      select: { lapNumber: true },
    });
    const existingSet = new Set(existing.map((l) => l.lapNumber));

    const rows = laps
      .map((l) => ({ lap: Number(l.lap), lapTimeSec: Number(l.lapTimeSec), pit: !!l.pit }))
      .filter(
        (l) =>
          Number.isFinite(l.lap) &&
          l.lap > 0 &&
          Number.isFinite(l.lapTimeSec) &&
          l.lapTimeSec > 0 &&
          !existingSet.has(l.lap),
      )
      .map((l) => ({
        raceConfigId: race.id,
        stintId: currentStint?.id ?? null,
        riderId,
        lapNumber: l.lap,
        lapTimeSec: l.lapTimeSec,
        condition,
        outIn: applyOutIn && l.pit ? 'IN' : null,
        fuelUsedL: null,
      }));

    if (rows.length === 0) {
      return NextResponse.json({
        imported: 0,
        skipped: laps.length,
        message: '新規に取り込む周がありません（すべて取込済み、または無効な周）',
      });
    }

    const result = await prisma.actualLap.createMany({ data: rows });
    return NextResponse.json({ imported: result.count, skipped: laps.length - rows.length });
  } catch (error) {
    console.error('ラップ取込エラー:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'ラップの取込に失敗しました' },
      { status: 500 },
    );
  }
}
