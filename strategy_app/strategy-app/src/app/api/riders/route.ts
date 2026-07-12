import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const riders = await prisma.rider.findMany({ orderBy: { displayOrder: 'asc' } });
  return NextResponse.json({ riders });
}

// ドライバー追加。body: { name, expectedLapTime?, defaultFuelRate?, color? }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const name = String(body.name ?? '').trim();
    if (!name) {
      return NextResponse.json({ error: '名前は必須です' }, { status: 400 });
    }
    const count = await prisma.rider.count();
    const rider = await prisma.rider.create({
      data: {
        name,
        expectedLapTime: Number(body.expectedLapTime) || 146,
        defaultFuelRate: body.defaultFuelRate != null && body.defaultFuelRate !== '' ? Number(body.defaultFuelRate) : null,
        color: body.color ?? null,
        displayOrder: body.displayOrder != null ? Number(body.displayOrder) : count + 1,
      },
    });
    return NextResponse.json({ rider }, { status: 201 });
  } catch (error) {
    console.error('ドライバー追加エラー:', error);
    return NextResponse.json({ error: 'ドライバーの追加に失敗しました' }, { status: 500 });
  }
}
