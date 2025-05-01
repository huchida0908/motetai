import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    // 各ドライバーの最新ラップを取得
    const latestLaps = await prisma.$queryRaw`
      SELECT l1.*
      FROM laps l1
      INNER JOIN (
        SELECT name, MAX(lap) as maxLap
        FROM laps
        WHERE record IS NOT NULL AND record != ''
        GROUP BY name
      ) l2 ON l1.name = l2.name AND l1.lap = l2.maxLap
      WHERE l1.record IS NOT NULL AND l1.record != ''
      ORDER BY CAST(l1.rank AS UNSIGNED) ASC
    `;

    return NextResponse.json({ rankings: latestLaps });
  } catch (error) {
    console.error('順位データの取得エラー:', error);
    return NextResponse.json(
      { error: '順位データの取得中にエラーが発生しました' },
      { status: 500 }
    );
  }
} 