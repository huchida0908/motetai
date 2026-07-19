import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getActiveRace } from '@/lib/live';

// アクティブレースの実績ラップ一覧を返す（インライン編集用。id / スティント番号込み）。
export async function GET() {
  try {
    const race = await getActiveRace();
    if (!race) {
      return NextResponse.json({ error: 'アクティブなレースがありません' }, { status: 400 });
    }
    const rows = await prisma.actualLap.findMany({
      where: { raceConfigId: race.id },
      orderBy: { lapNumber: 'asc' },
      include: { stint: { select: { stintNumber: true } } },
    });
    const laps = rows.map((l) => ({
      id: l.id,
      lapNumber: l.lapNumber,
      lapTimeSec: l.lapTimeSec,
      condition: l.condition,
      outIn: l.outIn,
      riderId: l.riderId,
      fuelUsedL: l.fuelUsedL,
      stintId: l.stintId,
      stintNumber: l.stint?.stintNumber ?? null,
    }));
    return NextResponse.json({ laps });
  } catch (error) {
    console.error('実績ラップ取得エラー:', error);
    return NextResponse.json({ error: '実績ラップの取得に失敗しました' }, { status: 500 });
  }
}

// 実績ラップを複数まとめて更新する（編集モードのまとめて保存用）。
// body: { updates: [{ id, lapTimeSec?, condition?, outIn?, riderId?, fuelUsedL? }, ...] }
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const updates: unknown[] = Array.isArray(body.updates) ? body.updates : [];
    if (updates.length === 0) {
      return NextResponse.json({ error: '更新対象がありません' }, { status: 400 });
    }

    // 検証しつつ Prisma の update 引数へ正規化
    const ops: { id: string; data: Record<string, unknown> }[] = [];
    for (const raw of updates) {
      const u = raw as Record<string, unknown>;
      const id = typeof u.id === 'string' ? u.id : '';
      if (!id) {
        return NextResponse.json({ error: 'id が不正な行があります' }, { status: 400 });
      }
      const data: Record<string, unknown> = {};
      if (u.lapTimeSec != null) {
        const t = Number(u.lapTimeSec);
        if (!Number.isFinite(t) || t <= 0) {
          return NextResponse.json({ error: `ラップタイム（秒）が不正です（id=${id}）` }, { status: 400 });
        }
        data.lapTimeSec = t;
      }
      if (u.condition != null) data.condition = String(u.condition);
      if (u.outIn !== undefined) data.outIn = u.outIn === 'OUT' || u.outIn === 'IN' ? u.outIn : null;
      if (u.riderId !== undefined) data.riderId = (u.riderId as string) || null;
      if (u.fuelUsedL !== undefined)
        data.fuelUsedL = u.fuelUsedL === '' || u.fuelUsedL == null ? null : Number(u.fuelUsedL);
      if (Object.keys(data).length > 0) ops.push({ id, data });
    }

    if (ops.length > 0) {
      await prisma.$transaction(ops.map((o) => prisma.actualLap.update({ where: { id: o.id }, data: o.data })));
    }
    return NextResponse.json({ updated: ops.length });
  } catch (error) {
    console.error('実績ラップ一括更新エラー:', error);
    return NextResponse.json({ error: '実績ラップの更新に失敗しました' }, { status: 500 });
  }
}

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
