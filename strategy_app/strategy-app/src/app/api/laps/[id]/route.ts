import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

type Ctx = { params: Promise<{ id: string }> };

// ラップ 1 件を修正する（入力済み記録の訂正用）。
// 燃料（使用L/残L）は路面と給油から自動再計算されるため、通常 fuelUsedL は送らない。
export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const body = await req.json();
    const data: Record<string, unknown> = {};
    if (body.lapTimeSec != null) {
      const t = Number(body.lapTimeSec);
      if (!Number.isFinite(t) || t <= 0) {
        return NextResponse.json({ error: 'ラップタイム（秒）が不正です' }, { status: 400 });
      }
      data.lapTimeSec = t;
    }
    if (body.condition != null) data.condition = String(body.condition);
    if (body.outIn !== undefined) data.outIn = body.outIn === 'OUT' || body.outIn === 'IN' ? body.outIn : null;
    if (body.riderId !== undefined) data.riderId = body.riderId || null;
    if (body.fuelUsedL !== undefined)
      data.fuelUsedL = body.fuelUsedL === '' || body.fuelUsedL == null ? null : Number(body.fuelUsedL);
    const lap = await prisma.actualLap.update({ where: { id }, data });
    return NextResponse.json({ lap });
  } catch (error) {
    console.error('ラップ更新エラー:', error);
    return NextResponse.json({ error: 'ラップの更新に失敗しました' }, { status: 500 });
  }
}

// ラップ 1 件を削除する（末尾に限らず任意の行）。
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    await prisma.actualLap.delete({ where: { id } });
    return NextResponse.json({ deleted: id });
  } catch (error) {
    console.error('ラップ削除エラー:', error);
    return NextResponse.json({ error: 'ラップの削除に失敗しました' }, { status: 500 });
  }
}
