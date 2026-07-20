import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getActiveRace } from '@/lib/live';
import { realignPlanToActual } from '@/lib/plan';

// 編集済みの実績ラップを「正式な実績」として確定する。
// 実績(ActualLap)とスティント(Stint)を丸ごと置き換え、
//   ・IN でスティントを自動分割（IN 周がそのスティントの最終周）
//   ・各周のタイムスタンプを TotalTime（レース開始からの累計秒）から復元
//     → 「周回数×経過時間」チャートが正しく積み上がる
//   ・未開始レースは復元した基準時刻を開始時刻に設定（時計と整合）
//
// body: {
//   laps: Array<{ lapNumber, lapTimeSec, totalTimeSec?, riderId?, condition?, outIn? }>,
//   refuelByStint?: { [stintNumber]: number },  // 各スティント開始時の搭載燃料(L)。省略時 第1=スタート燃料/以降=満タン
// }
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface NLap {
  lapNumber: number;
  lapTimeSec: number;
  totalSec: number;
  riderId: string | null;
  condition: string;
  outIn: 'IN' | 'OUT' | null;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const rawLaps = Array.isArray(body.laps) ? body.laps : [];
    const refuelByStint: Record<string, unknown> =
      body.refuelByStint && typeof body.refuelByStint === 'object' ? body.refuelByStint : {};

    const race = await getActiveRace();
    if (!race) {
      return NextResponse.json({ error: 'アクティブなレースがありません' }, { status: 400 });
    }

    // 正規化: 有効な周のみ、周番号順
    const laps: NLap[] = rawLaps
      .map((l: Record<string, unknown>) => ({
        lapNumber: Number(l.lapNumber),
        lapTimeSec: Number(l.lapTimeSec),
        totalSec: l.totalTimeSec != null && Number.isFinite(Number(l.totalTimeSec)) ? Number(l.totalTimeSec) : NaN,
        riderId: (l.riderId as string) ?? null,
        condition: typeof l.condition === 'string' && l.condition ? l.condition : 'D',
        outIn: l.outIn === 'IN' || l.outIn === 'OUT' ? (l.outIn as 'IN' | 'OUT') : null,
      }))
      .filter((l: NLap) => Number.isFinite(l.lapNumber) && l.lapNumber > 0 && Number.isFinite(l.lapTimeSec) && l.lapTimeSec > 0)
      .sort((a: NLap, b: NLap) => a.lapNumber - b.lapNumber);

    if (laps.length === 0) {
      return NextResponse.json({ error: '確定できる有効な周がありません' }, { status: 400 });
    }

    // 累計秒（TotalTime 欠損はラップ合算で補完）
    let cum = 0;
    for (const l of laps) {
      cum += l.lapTimeSec;
      if (!Number.isFinite(l.totalSec)) l.totalSec = cum;
    }
    const maxTotal = laps[laps.length - 1].totalSec;

    // 基準時刻: 開始済みならそれ、未開始なら「今 − 総経過」（末尾≈現在時刻）
    const nowMs = Date.now();
    const baseMs = race.startedAt ? race.startedAt.getTime() : nowMs - maxTotal * 1000;

    // IN でスティント分割
    const groups: NLap[][] = [];
    let group: NLap[] = [];
    for (const l of laps) {
      group.push(l);
      if (l.outIn === 'IN') {
        groups.push(group);
        group = [];
      }
    }
    if (group.length) groups.push(group);

    const tank = race.tankCapacityL;
    const startFuel = race.startFuelL;

    await prisma.$transaction(
      async (tx) => {
        await tx.actualLap.deleteMany({ where: { raceConfigId: race.id } });
        await tx.stint.deleteMany({ where: { raceConfigId: race.id } });

        for (let gi = 0; gi < groups.length; gi++) {
          const g = groups[gi];
          const stintNo = gi + 1;
          const first = g[0];
          const last = g[g.length - 1];
          const isLast = gi === groups.length - 1;

          const refuelRaw = refuelByStint[String(stintNo)];
          const refuel =
            refuelRaw != null && Number.isFinite(Number(refuelRaw))
              ? Number(refuelRaw)
              : stintNo === 1
                ? startFuel
                : tank;

          const stint = await tx.stint.create({
            data: {
              raceConfigId: race.id,
              stintNumber: stintNo,
              riderId: first.riderId,
              refuelL: refuel,
              plannedLaps: g.length,
              startedAt: new Date(baseMs + Math.max(0, first.totalSec - first.lapTimeSec) * 1000),
              endedAt: last.outIn === 'IN' || !isLast ? new Date(baseMs + last.totalSec * 1000) : null,
            },
          });

          await tx.actualLap.createMany({
            data: g.map((l, idx) => ({
              raceConfigId: race.id,
              stintId: stint.id,
              riderId: l.riderId ?? first.riderId,
              lapNumber: l.lapNumber,
              lapTimeSec: l.lapTimeSec,
              condition: l.condition,
              // 第2スティント以降の先頭周は OUT を自動付与（明示指定が無ければ）
              outIn: l.outIn ?? (idx === 0 && stintNo > 1 ? 'OUT' : null),
              fuelUsedL: null,
              timestamp: new Date(baseMs + l.totalSec * 1000),
            })),
          });
        }

        if (!race.startedAt) {
          await tx.raceConfig.update({ where: { id: race.id }, data: { startedAt: new Date(baseMs) } });
        }
      },
      { timeout: 120_000, maxWait: 15_000 },
    );

    // 確定後、計画を実績スティントへ再アンカー（前倒し/後ろ倒し）。失敗しても確定自体は成立させる。
    try {
      await realignPlanToActual(race.id);
    } catch (e) {
      console.error('計画の自動再アンカー失敗（確定は完了済み）:', e);
    }

    return NextResponse.json({ committed: laps.length, stints: groups.length });
  } catch (error) {
    console.error('確定エラー:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '確定に失敗しました' },
      { status: 500 },
    );
  }
}
