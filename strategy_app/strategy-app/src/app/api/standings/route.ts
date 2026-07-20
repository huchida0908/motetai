import { NextRequest, NextResponse } from 'next/server';
import { fetchStandings } from '@/lib/timing-feed';

// 計時サーバーの順位表から「自チームの総合順位・直上との差・前チームのゼッケン」を返す。
// 計時はライブ取得（DB非保存）のため、都度接続して取得する。
export const runtime = 'nodejs'; // socket 接続のため Node ランタイム必須
export const dynamic = 'force-dynamic';
export const maxDuration = 10;

export async function GET(req: NextRequest) {
  const carno = req.nextUrl.searchParams.get('carno')?.trim();
  if (!carno) {
    return NextResponse.json({ error: '車番(carno)を指定してください' }, { status: 400 });
  }

  try {
    const rows = await fetchStandings();
    const our = rows.find((r) => r.carno === carno) ?? null;
    // ひとつ前の順位（総合）のチーム = Pos が our.pos - 1 の行
    const ahead = our?.pos != null ? rows.find((r) => r.pos === (our.pos as number) - 1) ?? null : null;

    return NextResponse.json({
      connected: true,
      carno,
      found: !!our,
      totalTeams: rows.length,
      our: our
        ? {
            pos: our.pos,
            carno: our.carno,
            teamName: our.teamName,
            className: our.className,
            classPos: our.classPos,
            lap: our.lap,
            gap: our.gap, // 直上（前の順位）との差
            pit: our.pit, // 現在ピット中か（計時PITフラグ）
          }
        : null,
      ahead: ahead ? { pos: ahead.pos, carno: ahead.carno, teamName: ahead.teamName } : null,
    });
  } catch (error) {
    console.error('順位取得エラー:', error);
    return NextResponse.json(
      { connected: false, error: error instanceof Error ? error.message : '計時サーバーへ接続できません' },
      { status: 502 },
    );
  }
}
