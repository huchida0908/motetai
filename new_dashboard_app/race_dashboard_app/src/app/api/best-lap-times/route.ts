import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    // 各チームのベストラップタイムを取得
    const bestLapTimes = await prisma.$queryRaw`
      SELECT t.name, t.lap, t.record, t.speed
      FROM laps t
      INNER JOIN (
        SELECT name, MIN(record) as best_record
        FROM laps
        WHERE record IS NOT NULL AND record != ''
        GROUP BY name
      ) b ON t.name = b.name AND t.record = b.best_record
      WHERE t.record IS NOT NULL AND t.record != ''
      ORDER BY t.record ASC
    `;

    return NextResponse.json({ bestLapTimes });
  } catch (error) {
    console.error('ベストラップタイムデータの取得エラー:', error);
    return NextResponse.json(
      { error: 'ベストラップタイムデータの取得中にエラーが発生しました' },
      { status: 500 }
    );
  }
} 