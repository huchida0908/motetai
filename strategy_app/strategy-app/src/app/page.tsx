import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Fuel, Timer, Users } from 'lucide-react';
import RaceClockTile from '@/components/RaceClockTile';
import { getLiveState } from '@/lib/live';
import { formatLapTime, formatMinSec } from '@/lib/time';
import { CONDITION_LABEL, CONDITION_COLOR } from '@/lib/constants';
import LapChart from '@/components/LapChart';

function bankLabel(bankSec: number | null): { text: string; className: string } {
  if (bankSec == null) return { text: '-', className: '' };
  const sign = bankSec >= 0 ? '+' : '−';
  const cls = bankSec >= 0 ? 'text-emerald-400' : 'text-destructive';
  return { text: `${sign}${formatMinSec(Math.abs(bankSec))}`, className: cls };
}

// 常に最新の DB 状態で描画する
export const dynamic = 'force-dynamic';

export default async function Dashboard() {
  const live = await getLiveState(Date.now());

  if (!live.race) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">ダッシュボード</h1>
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            アクティブなレースがありません。
            <br />
            <code className="text-xs">npx tsx prisma/seed.ts</code> でシード投入、または「設定」で作成してください。
          </CardContent>
        </Card>
      </div>
    );
  }

  const { tiles: t, riders, currentStint, recentLaps } = live;
  const riderName = (id: string | null) => riders.find((r) => r.id === id)?.name ?? '-';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight">ダッシュボード</h1>
            {live.race.startedAt && (
              <span className="inline-flex items-center gap-1.5 rounded-sm border border-primary/40 bg-primary/10 px-2 py-0.5">
                <span className="live-dot h-2 w-2 rounded-full bg-primary" />
                <span className="font-display text-xs font-bold tracking-[0.22em] text-primary">LIVE</span>
              </span>
            )}
          </div>
          <p className="text-muted-foreground">{live.race.raceName} の現在状況</p>
        </div>
        <Link
          href="/live"
          className="inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90"
        >
          <Timer className="h-4 w-4" /> ライブ入力へ
        </Link>
      </div>

      {/* 概要カード */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={<Fuel className="h-4 w-4 text-muted-foreground" />} title="現在の燃料残量"
          value={t.fuelRemainingL != null ? `${t.fuelRemainingL.toFixed(2)} L` : '-'}
          sub={t.possibleLaps != null ? `あと約 ${t.possibleLaps.toFixed(1)} 周` : ''} />
        <StatCard icon={<Timer className="h-4 w-4 text-muted-foreground" />} title="通算周回"
          value={`${t.totalLaps} 周`}
          sub={currentStint ? `第${currentStint.stintNumber}スティント ${t.lapsInStint}周目` : ''} />
        <StatCard icon={<Users className="h-4 w-4 text-muted-foreground" />} title="現在の走者"
          value={riderName(currentStint?.riderId ?? null)}
          sub={t.recent3Avg != null ? `直近3周平均 ${formatLapTime(t.recent3Avg)}` : ''} />
        <RaceClockTile startedAt={live.race.startedAt} raceDurationMin={live.race.raceDurationMin} variant="stat" />
      </div>

      {/* レースクロック予測 */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatCard title="着地予測(周)" value={t.projectedTotalLaps != null ? `${t.projectedTotalLaps} 周` : '未計測'}
          sub={t.planTotalLaps != null ? `計画 ${t.planTotalLaps} 周` : t.clock ? `現在 ${t.totalLaps} 周` : 'レース開始で計測'} />
        <StatCard title="次ピットまで" value={`${t.lapsUntilNextPit} 周`}
          sub={[
            t.nextPitInSec != null ? `約 ${formatMinSec(t.nextPitInSec)} 後` : '',
            t.nextPlannedPitLap != null ? `計画: Lap ${t.nextPlannedPitLap}` : '',
          ].filter(Boolean).join(' / ')} />
        <StatCard title="残ピット回数" value={t.remainingPits != null ? `${t.remainingPits} 回` : '-'} />
        {(() => {
          const hasPlan = t.planBankSec != null;
          const b = bankLabel(hasPlan ? t.planBankSec : t.bankSec);
          return (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium tracking-[0.1em]">{hasPlan ? '対計画(貯金/借金)' : '対予定(貯金/借金)'}</CardTitle></CardHeader>
            <CardContent><div className={`font-display text-3xl font-bold ${b.className}`}>{b.text}</div>
              <p className="text-xs text-muted-foreground">＋=速い / −=遅い（{hasPlan ? '周単位計画比' : `想定 ${formatLapTime(t.assumedLapSec)}比`}）</p></CardContent>
          </Card>
        ); })()}
      </div>

      {/* 計画 vs 実績チャート */}
      <Card>
        <CardHeader>
          <CardTitle>ラップ推移（計画 vs 実績）</CardTitle>
          <CardDescription>
            {live.planSeries.length > 0 ? '青点線=計画 / 赤=実績。右上で表示を切替（ラップタイム / 周回数×経過時間 / 燃料残量）' : 'ピット周は除外。黄の点線が想定タイム'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LapChart
            series={live.series}
            planSeries={live.planSeries}
            progress={live.progress}
            fuelSeries={live.fuelSeries}
            raceDurationMin={live.race.raceDurationMin}
            assumedLapSec={t.assumedLapSec}
          />
        </CardContent>
      </Card>

      {/* ペース指標 */}
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard title="ドライ平均" value={formatLapTime(t.avgDry)} />
        <StatCard title="ウェット平均" value={formatLapTime(t.avgWet)} />
        <StatCard title="直近3周平均" value={formatLapTime(t.recent3Avg)} />
      </div>

      {/* 直近ラップ */}
      <Card>
        <CardHeader>
          <CardTitle>直近ラップ</CardTitle>
          <CardDescription>最新の記録</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-muted-foreground border-b">
                <tr>
                  <th className="text-left py-2 px-2">Lap</th>
                  <th className="text-left py-2 px-2">走者</th>
                  <th className="text-left py-2 px-2">路面</th>
                  <th className="text-right py-2 px-2">タイム</th>
                  <th className="text-right py-2 px-2">残L</th>
                </tr>
              </thead>
              <tbody>
                {recentLaps.slice(0, 10).map((l) => (
                  <tr key={l.id} className="border-b border-border/50">
                    <td className="py-1.5 px-2 font-mono">{l.lapNumber}</td>
                    <td className="py-1.5 px-2">{riderName(l.riderId)}</td>
                    <td className="py-1.5 px-2">
                      <span className="inline-block px-2 py-0.5 rounded-full text-xs text-white whitespace-nowrap"
                        style={{ backgroundColor: CONDITION_COLOR[l.condition] ?? '#6b7280' }}>
                        {CONDITION_LABEL[l.condition] ?? l.condition}
                      </span>
                      {l.outIn ? <span className="ml-1 text-xs">{l.outIn}</span> : null}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono">{formatLapTime(l.lapTimeSec)}</td>
                    <td className="py-1.5 px-2 text-right font-mono">{l.fuel ? l.fuel.fuelRemainingL.toFixed(2) : '-'}</td>
                  </tr>
                ))}
                {recentLaps.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center py-6 text-muted-foreground">まだラップがありません</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ icon, title, value, sub }: { icon?: React.ReactNode; title: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium tracking-[0.1em]">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="font-display text-3xl font-bold">{value}</div>
        {sub ? <p className="text-xs text-muted-foreground font-mono">{sub}</p> : null}
      </CardContent>
    </Card>
  );
}
