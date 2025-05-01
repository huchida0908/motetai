import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    // recordがnullでない行をすべて取得
    const lapTimes = await prisma.$queryRaw`
      SELECT name, lap, record
      FROM laps
      WHERE record IS NOT NULL AND record != ''
      ORDER BY name, CAST(lap AS UNSIGNED) ASC
    `;

    // データを変換: チーム別のラップタイム配列
    const teamData: Record<string, { lap: string; time: number }[]> = {};

    for (const row of lapTimes as any[]) {
      const { name, lap, record } = row;
      
      // ラップタイムを秒に変換（例: "2:31.025" → 151.025秒）
      let timeInSeconds = 0;
      if (record) {
        const parts = record.split(':');
        if (parts.length === 2) {
          const minutes = parseInt(parts[0], 10);
          const seconds = parseFloat(parts[1]);
          timeInSeconds = minutes * 60 + seconds;
        }
      }

      if (!teamData[name]) {
        teamData[name] = [];
      }

      teamData[name].push({
        lap,
        time: timeInSeconds
      });
    }

    return NextResponse.json({ teamData });
  } catch (error) {
    console.error('ラップタイムデータの取得エラー:', error);
    return NextResponse.json(
      { error: 'ラップタイムデータの取得中にエラーが発生しました' },
      { status: 500 }
    );
  }
} 