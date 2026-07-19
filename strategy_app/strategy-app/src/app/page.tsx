import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Timer } from 'lucide-react';
import { getLiveState } from '@/lib/live';
import { formatLapTime, formatMinSec } from '@/lib/time';
import { CONDITION_LABEL, CONDITION_COLOR } from '@/lib/constants';
import LapChart from '@/components/LapChart';
import RaceClockTile from '@/components/RaceClockTile';
import RiderStintTimer from '@/components/RiderStintTimer';
import StandingTile from '@/components/StandingTile';
import { PanelLabel } from '@/components/panel-label';

function bankLabel(bankSec: number | null): { text: string; className: string } {
  if (bankSec == null) return { text: '—', className: '' };
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
  const riderName = (id: string | null) => riders.find((r) => r.id === id)?.name ?? '—';
  const hasPlan = t.planBankSec != null;
  const bank = bankLabel(hasPlan ? t.planBankSec : t.bankSec);

  return (
    <div className="space-y-4">
      {/* ページヘッダ */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">ダッシュボード</h1>
            {live.race.startedAt && (
              <span className="inline-flex items-center gap-1.5 rounded-sm border border-primary/40 bg-primary/10 px-2 py-0.5">
                <span className="live-dot h-2 w-2 rounded-full bg-primary" />
                <span className="font-display text-xs font-bold tracking-[0.22em] text-primary">LIVE</span>
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[10px] tracking-[0.3em] text-muted-foreground uppercase">Race Control ・ {live.race.raceName}</p>
        </div>
        <Link
          href="/live"
          className="inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90"
        >
          <Timer className="h-4 w-4" /> ライブ入力へ
        </Link>
      </div>

      {/* タイミングストリップ: 時計・周回・走者を一望する最上段の帯 */}
      <Card className="overflow-hidden">
        <div className="h-[3px] bg-gradient-to-r from-primary via-primary/40 to-transparent" />
        <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-border">
          <RaceClockTile startedAt={live.race.startedAt} raceDurationMin={live.race.raceDurationMin} variant="hero" />
          <div className="p-4 flex flex-col justify-center">
            <PanelLabel>Lap / 通算周回</PanelLabel>
            <div className="font-display text-4xl md:text-5xl font-bold leading-tight">
              {t.totalLaps}
              <span className="text-xl text-muted-foreground font-semibold"> / {t.planTotalLaps ?? '—'}</span>
            </div>
            <div className="text-xs text-muted-foreground font-mono">
              {currentStint ? `第${currentStint.stintNumber}スティント ${t.lapsInStint}周目` : 'スティント未開始'}
            </div>
          </div>
          <div className="p-4 flex flex-col justify-center">
            <PanelLabel>Rider / 走者</PanelLabel>
            <div className="font-display text-3xl md:text-4xl font-bold leading-tight truncate">
              {riderName(currentStint?.riderId ?? null)}
            </div>
            <div className="text-xs font-mono">
              <RiderStintTimer startedAt={currentStint?.startedAt ?? live.race.startedAt} variant="inline" />
            </div>
            <div className="text-[11px] text-muted-foreground font-mono">
              {t.recent3Avg != null ? `直近3周平均 ${formatLapTime(t.recent3Avg)}` : 'ラップ未計測'}
            </div>
          </div>
          <div className="p-4 flex flex-col justify-center">
            <PanelLabel>{hasPlan ? 'Delta / 対計画' : 'Delta / 対予定'}</PanelLabel>
            <div className={`font-display text-4xl md:text-5xl font-bold leading-tight ${bank.className}`}>{bank.text}</div>
            <div className="text-xs text-muted-foreground font-mono">
              ＋=速い / −=遅い（{hasPlan ? '周単位計画比' : `想定 ${formatLapTime(t.assumedLapSec)}比`}）
            </div>
          </div>
        </div>
      </Card>

      {/* 自チームの総合順位（計時サーバーからライブ取得） */}
      <StandingTile />

      {/* メイン: チャート（大）＋ 右レール（燃料・ピット） */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2 space-y-1">
            <PanelLabel>Telemetry / ラップ推移</PanelLabel>
            <CardDescription>
              {live.planSeries.length > 0
                ? '青点線=計画 / 赤=実績。右上で表示を切替（ラップタイム / 周回数×経過時間 / 燃料残量）'
                : 'ピット周は除外。黄の点線が想定タイム'}
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

        <div className="grid gap-4 content-start">
          {/* 燃料 */}
          <Card className="accent-bar">
            <CardContent className="p-4 space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <PanelLabel>Fuel / 燃料残量</PanelLabel>
                <span className="text-[11px] text-muted-foreground font-mono">タンク {live.race.tankCapacityL}L</span>
              </div>
              <div className="font-display text-4xl font-bold">
                {t.fuelRemainingL != null ? `${t.fuelRemainingL.toFixed(2)} L` : '—'}
              </div>
              <FuelGauge remaining={t.fuelRemainingL} tank={live.race.tankCapacityL} />
              <div className="text-xs text-muted-foreground font-mono">
                {t.possibleLaps != null ? `残燃料であと約 ${t.possibleLaps.toFixed(1)} 周` : '給油情報なし'}
              </div>
            </CardContent>
          </Card>

          {/* ピット */}
          <Card>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <PanelLabel>Pit Window / 次ピットまで</PanelLabel>
                {t.nextPitTireChange != null && (
                  <span
                    className={`inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-[11px] font-bold whitespace-nowrap ${
                      t.nextPitTireChange
                        ? 'bg-amber-500/15 text-amber-400 border border-amber-500/40'
                        : 'bg-muted text-muted-foreground border border-border'
                    }`}
                  >
                    🛞 {t.nextPitTireChange ? 'タイヤ交換あり' : 'タイヤ交換なし'}
                  </span>
                )}
              </div>
              <div className="font-display text-4xl font-bold">
                {t.lapsUntilNextPit} <span className="text-lg text-muted-foreground font-semibold">周</span>
              </div>
              <div className="text-xs text-muted-foreground font-mono">
                {[
                  t.nextPitInSec != null ? `約 ${formatMinSec(t.nextPitInSec)} 後` : '',
                  t.nextPlannedPitLap != null ? `計画: Lap ${t.nextPlannedPitLap}` : '',
                ]
                  .filter(Boolean)
                  .join(' ／ ') || '—'}
              </div>
              <div className="border-t border-border/70 pt-2 grid grid-cols-2 gap-2">
                <KV label="残ピット回数" value={t.remainingPits != null ? `${t.remainingPits} 回` : '—'} />
                <KV
                  label="着地予測"
                  value={t.projectedTotalLaps != null ? `${t.projectedTotalLaps} 周` : '—'}
                  sub={t.planTotalLaps != null ? `計画 ${t.planTotalLaps} 周` : undefined}
                />
              </div>
            </CardContent>
          </Card>

          {/* ペース */}
          <Card>
            <CardContent className="p-4">
              <PanelLabel className="mb-1">Pace / ペース</PanelLabel>
              <div className="divide-y divide-border/60">
                <PaceRow label="直近3周平均" value={formatLapTime(t.recent3Avg)} highlight />
                <PaceRow label="ドライ平均" value={formatLapTime(t.avgDry)} />
                <PaceRow label="ウェット平均" value={formatLapTime(t.avgWet)} />
                <PaceRow label="想定ラップ" value={formatLapTime(t.assumedLapSec)} />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* 直近ラップ */}
      <Card>
        <CardHeader className="pb-2">
          <PanelLabel>Timing / 直近ラップ</PanelLabel>
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

// 燃料ゲージ（ステータス色: 30%未満=注意 / 15%未満=危険）
function FuelGauge({ remaining, tank }: { remaining: number | null; tank: number }) {
  if (remaining == null || tank <= 0) return <div className="h-2 rounded-full bg-muted" />;
  const ratio = Math.max(0, Math.min(1, remaining / tank));
  const color = ratio < 0.15 ? '#f87171' : ratio < 0.3 ? '#fbbf24' : '#34d399';
  return (
    <div className="h-2 rounded-full bg-muted overflow-hidden">
      <div className="h-full rounded-full" style={{ width: `${ratio * 100}%`, backgroundColor: color }} />
    </div>
  );
}

function KV({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-[10px] tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className="font-display text-xl font-bold">{value}</div>
      {sub ? <div className="text-[10px] text-muted-foreground font-mono">{sub}</div> : null}
    </div>
  );
}

function PaceRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`font-mono text-base ${highlight ? 'font-bold' : 'text-muted-foreground'}`}>{value}</span>
    </div>
  );
}
