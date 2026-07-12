import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Fuel, Timer, Users, Flag } from 'lucide-react';
import { getLiveState } from '@/lib/live';
import { formatLapTime, formatMinSec } from '@/lib/time';
import { CONDITION_LABEL, CONDITION_COLOR } from '@/lib/constants';

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
          <h1 className="text-3xl font-bold tracking-tight">ダッシュボード</h1>
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
        <StatCard icon={<Flag className="h-4 w-4 text-muted-foreground" />} title="残り時間"
          value={t.clock ? formatMinSec(t.clock.remainingSec) : '未計測'}
          sub={t.clock ? `経過 ${formatMinSec(t.clock.elapsedSec)}` : 'レース開始で計測開始'} />
      </div>

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
                      <span className="inline-block px-2 py-0.5 rounded-full text-xs text-white"
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
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold font-mono">{value}</div>
        {sub ? <p className="text-xs text-muted-foreground">{sub}</p> : null}
      </CardContent>
    </Card>
  );
}
