import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

type Ctx = { params: Promise<{ id: string }> };

// ライダー更新
export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const body = await req.json();
    const data: Record<string, unknown> = {};
    if (body.name != null) data.name = String(body.name).trim();
    if (body.expectedLapTime != null) data.expectedLapTime = Number(body.expectedLapTime);
    if (body.defaultFuelRate !== undefined)
      data.defaultFuelRate = body.defaultFuelRate === '' || body.defaultFuelRate == null ? null : Number(body.defaultFuelRate);
    if (body.color !== undefined) data.color = body.color || null;
    if (body.displayOrder != null) data.displayOrder = Number(body.displayOrder);
    const rider = await prisma.rider.update({ where: { id }, data });
    return NextResponse.json({ rider });
  } catch (error) {
    console.error('ライダー更新エラー:', error);
    return NextResponse.json({ error: 'ライダーの更新に失敗しました' }, { status: 500 });
  }
}

// ライダー削除
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    await prisma.rider.delete({ where: { id } });
    return NextResponse.json({ deleted: id });
  } catch (error) {
    console.error('ライダー削除エラー:', error);
    return NextResponse.json({ error: 'ライダーの削除に失敗しました' }, { status: 500 });
  }
}
