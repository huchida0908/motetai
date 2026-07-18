'use client';

import { useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';
import { formatLapTime, formatMinSec } from '@/lib/time';
import { CONDITION_COLOR, CONDITION_LABEL } from '@/lib/constants';

export interface LapPoint {
  lap: number;
  timeSec: number;
  condition: string;
  outIn: string | null;
}

export interface PlanPoint {
  lap: number;
  timeSec: number;
  outIn: string | null;
}

// 周回数推移の 1 点（t=経過秒, laps=通算周回）
export interface ProgressPoint {
  t: number;
  laps: number;
}

// 燃料推移の 1 点（lap=周番号, fuelL=その周終了時の残燃料）
export interface FuelPoint {
  lap: number;
  fuelL: number;
}
export interface FuelSeries {
  plan: FuelPoint[];
  actual: FuelPoint[];
  startFuelL: number;
  tankCapacityL: number;
}

type Mode = 'lapTime' | 'progress' | 'fuel';

// 計画 vs 実績チャート。2 つの表示を切り替えられる:
// - ラップタイム: 横軸=周、縦軸=ラップタイム（ピット周は外れ値のため除外）
// - 周回数推移: 横軸=経過時間、縦軸=通算周回数（耐久レースの消化ペース）
export default function LapChart({
  series,
  planSeries,
  progress,
  fuelSeries,
  raceDurationMin,
  assumedLapSec,
}: {
  series: LapPoint[];
  planSeries?: PlanPoint[];
  progress?: { plan: ProgressPoint[]; actual: ProgressPoint[] };
  fuelSeries?: FuelSeries;
  raceDurationMin?: number;
  assumedLapSec: number;
}) {
  const [mode, setMode] = useState<Mode>('lapTime');
  const hasProgress = progress != null && (progress.plan.length > 0 || progress.actual.length > 0);
  const hasFuel = fuelSeries != null && (fuelSeries.plan.length > 0 || fuelSeries.actual.length > 0);

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <div className="flex gap-1 rounded-md border p-0.5">
          {(
            [
              ['lapTime', 'ラップタイム'],
              ['progress', '周回数推移'],
              ['fuel', '燃料残量'],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              disabled={(m === 'progress' && !hasProgress) || (m === 'fuel' && !hasFuel)}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                mode === m
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground disabled:opacity-40'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {mode === 'lapTime' ? (
        <LapTimeChart series={series} planSeries={planSeries} assumedLapSec={assumedLapSec} />
      ) : mode === 'progress' ? (
        <ProgressChart progress={progress!} raceDurationMin={raceDurationMin} />
      ) : (
        <FuelChart fuelSeries={fuelSeries!} />
      )}
    </div>
  );
}

// ── ラップタイム表示（従来） ──────────────────────────
function LapTimeChart({
  series,
  planSeries,
  assumedLapSec,
}: {
  series: LapPoint[];
  planSeries?: PlanPoint[];
  assumedLapSec: number;
}) {
  const actual = series.filter((p) => !p.outIn);
  const plan = (planSeries ?? []).filter((p) => !p.outIn);

  if (actual.length === 0 && plan.length === 0) {
    return <div className="h-72 flex items-center justify-center text-muted-foreground text-sm">まだラップがありません</div>;
  }

  // lap でマージして 2 系列（actual / plan）を持つデータに変換
  const byLap = new Map<number, { lap: number; actual?: number; plan?: number; condition?: string }>();
  for (const p of actual) {
    byLap.set(p.lap, { lap: p.lap, actual: p.timeSec, condition: p.condition });
  }
  for (const p of plan) {
    const row = byLap.get(p.lap) ?? { lap: p.lap };
    row.plan = p.timeSec;
    byLap.set(p.lap, row);
  }
  const data = [...byLap.values()].sort((a, b) => a.lap - b.lap);

  // Y 軸レンジ（両系列＋基準線が必ず入るように余白をとる）
  const times = [
    ...actual.map((d) => d.timeSec),
    ...plan.map((d) => d.timeSec),
    ...(plan.length === 0 ? [assumedLapSec] : []),
  ];
  const min = Math.min(...times) - 2;
  const max = Math.max(...times) + 2;

  return (
    <ResponsiveContainer width="100%" height={288}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis dataKey="lap" tick={{ fontSize: 12 }} stroke="var(--muted-foreground)" />
        <YAxis
          domain={[min, max]}
          tickFormatter={(v) => formatLapTime(v as number)}
          width={64}
          tick={{ fontSize: 12 }}
          stroke="var(--muted-foreground)"
        />
        <Tooltip
          formatter={(v: number, name, item) => {
            if (name === 'plan') return [formatLapTime(v), '計画'];
            const c = (item?.payload as { condition?: string })?.condition;
            return [`${formatLapTime(v)}${c ? `（${CONDITION_LABEL[c] ?? c}）` : ''}`, '実績'];
          }}
          labelFormatter={(l) => `Lap ${l}`}
          contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
        />
        {plan.length > 0 && (
          <Legend
            formatter={(v) => (v === 'plan' ? '計画' : '実績')}
            wrapperStyle={{ fontSize: 12 }}
          />
        )}
        {plan.length === 0 && (
          <ReferenceLine
            y={assumedLapSec}
            stroke="#f59e0b"
            strokeDasharray="4 4"
            label={{ value: `想定 ${formatLapTime(assumedLapSec)}`, position: 'insideTopRight', fontSize: 11, fill: '#b45309' }}
          />
        )}
        {plan.length > 0 && (
          <Line
            type="monotone"
            dataKey="plan"
            stroke="#f59e0b"
            strokeWidth={2}
            strokeDasharray="6 4"
            dot={false}
            isAnimationActive={false}
            connectNulls
          />
        )}
        <Line
          type="monotone"
          dataKey="actual"
          stroke="var(--primary)"
          strokeWidth={2}
          isAnimationActive={false}
          connectNulls
          dot={(props: { cx?: number; cy?: number; payload?: { condition?: string }; index?: number }) => {
            const { cx, cy, payload } = props;
            if (cx == null || cy == null || !payload?.condition) return <circle key={props.index} r={0} />;
            return <circle key={props.index} cx={cx} cy={cy} r={3.5} fill={CONDITION_COLOR[payload.condition] ?? 'var(--primary)'} />;
          }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── 周回数推移表示（横軸=経過時間、縦軸=通算周回） ──────────────────────────
function ProgressChart({
  progress,
  raceDurationMin,
}: {
  progress: { plan: ProgressPoint[]; actual: ProgressPoint[] };
  raceDurationMin?: number;
}) {
  // 原点（スタート時点 0 周）を先頭に足す
  const plan = progress.plan.length > 0 ? [{ t: 0, laps: 0 }, ...progress.plan] : [];
  const actual = progress.actual.length > 0 ? [{ t: 0, laps: 0 }, ...progress.actual] : [];

  if (plan.length === 0 && actual.length === 0) {
    return <div className="h-72 flex items-center justify-center text-muted-foreground text-sm">データがありません</div>;
  }

  const durationSec = raceDurationMin != null ? raceDurationMin * 60 : null;
  const maxT = Math.max(
    durationSec ?? 0,
    ...plan.map((p) => p.t),
    ...actual.map((p) => p.t),
  );
  const maxLaps = Math.max(...plan.map((p) => p.laps), ...actual.map((p) => p.laps));

  // 1 時間ごとの目盛り
  const hourTicks: number[] = [];
  for (let t = 0; t <= maxT; t += 3600) hourTicks.push(t);

  const fmtElapsed = (sec: number) => (sec % 3600 === 0 ? `${sec / 3600}h` : formatMinSec(sec));

  return (
    <ResponsiveContainer width="100%" height={288}>
      <LineChart margin={{ top: 8, right: 12, bottom: 4, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis
          type="number"
          dataKey="t"
          domain={[0, maxT]}
          ticks={hourTicks}
          tickFormatter={fmtElapsed}
          tick={{ fontSize: 12 }}
          stroke="var(--muted-foreground)"
        />
        <YAxis
          type="number"
          dataKey="laps"
          domain={[0, Math.ceil(maxLaps * 1.05)]}
          allowDecimals={false}
          width={40}
          tick={{ fontSize: 12 }}
          stroke="var(--muted-foreground)"
        />
        <Tooltip
          formatter={(v: number, name) => [`${v} 周`, name === 'plan' ? '計画' : '実績']}
          labelFormatter={(t) => `経過 ${formatMinSec(Number(t))}`}
          contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
        />
        <Legend formatter={(v) => (v === 'plan' ? '計画' : '実績')} wrapperStyle={{ fontSize: 12 }} />
        {durationSec != null && (
          <ReferenceLine
            x={durationSec}
            stroke="#dc2626"
            strokeDasharray="4 4"
            label={{ value: 'レース終了', position: 'insideTopRight', fontSize: 11, fill: '#dc2626' }}
          />
        )}
        {plan.length > 0 && (
          <Line
            data={plan}
            name="plan"
            type="stepAfter"
            dataKey="laps"
            stroke="#f59e0b"
            strokeWidth={2}
            strokeDasharray="6 4"
            dot={false}
            isAnimationActive={false}
          />
        )}
        {actual.length > 0 && (
          <Line
            data={actual}
            name="actual"
            type="stepAfter"
            dataKey="laps"
            stroke="var(--primary)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        )}
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── 燃料残量推移（横軸=Lap、縦軸=残L。給油で跳ね上がるノコギリ形） ──────────────────────────
function FuelChart({ fuelSeries }: { fuelSeries: FuelSeries }) {
  // Lap 0 = スタート時の搭載燃料を起点に足す
  const plan = fuelSeries.plan.length > 0 ? [{ lap: 0, fuelL: fuelSeries.startFuelL }, ...fuelSeries.plan] : [];
  const actual = fuelSeries.actual.length > 0 ? [{ lap: 0, fuelL: fuelSeries.startFuelL }, ...fuelSeries.actual] : [];

  if (plan.length === 0 && actual.length === 0) {
    return <div className="h-72 flex items-center justify-center text-muted-foreground text-sm">データがありません</div>;
  }

  const allFuel = [...plan.map((p) => p.fuelL), ...actual.map((p) => p.fuelL)];
  const minFuel = Math.min(0, ...allFuel);
  const maxLap = Math.max(...plan.map((p) => p.lap), ...actual.map((p) => p.lap));

  return (
    <ResponsiveContainer width="100%" height={288}>
      <LineChart margin={{ top: 8, right: 12, bottom: 4, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis
          type="number"
          dataKey="lap"
          domain={[0, maxLap]}
          allowDecimals={false}
          tick={{ fontSize: 12 }}
          stroke="var(--muted-foreground)"
        />
        <YAxis
          type="number"
          dataKey="fuelL"
          domain={[Math.floor(minFuel), Math.ceil(fuelSeries.tankCapacityL)]}
          tickFormatter={(v) => `${v}L`}
          width={44}
          tick={{ fontSize: 12 }}
          stroke="var(--muted-foreground)"
        />
        <Tooltip
          formatter={(v: number, name) => [`${v.toFixed(2)} L`, name === 'plan' ? '計画' : '実績']}
          labelFormatter={(l) => (Number(l) === 0 ? 'スタート' : `Lap ${l}`)}
          contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
        />
        <Legend formatter={(v) => (v === 'plan' ? '計画' : '実績')} wrapperStyle={{ fontSize: 12 }} />
        <ReferenceLine
          y={0}
          stroke="#dc2626"
          strokeDasharray="4 4"
          label={{ value: 'ガス欠', position: 'insideBottomRight', fontSize: 11, fill: '#dc2626' }}
        />
        {plan.length > 0 && (
          <Line
            data={plan}
            name="plan"
            type="linear"
            dataKey="fuelL"
            stroke="#f59e0b"
            strokeWidth={2}
            strokeDasharray="6 4"
            dot={false}
            isAnimationActive={false}
          />
        )}
        {actual.length > 0 && (
          <Line
            data={actual}
            name="actual"
            type="linear"
            dataKey="fuelL"
            stroke="var(--primary)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        )}
      </LineChart>
    </ResponsiveContainer>
  );
}
