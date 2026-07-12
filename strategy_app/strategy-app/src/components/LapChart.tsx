'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';
import { formatLapTime } from '@/lib/time';
import { CONDITION_COLOR, CONDITION_LABEL } from '@/lib/constants';

export interface LapPoint {
  lap: number;
  timeSec: number;
  condition: string;
  outIn: string | null;
}

// 計画 vs 実績のラップ推移。ピット周(OUT/IN)はペースの外れ値のため除外する。
export default function LapChart({ series, assumedLapSec }: { series: LapPoint[]; assumedLapSec: number }) {
  const data = series.filter((p) => !p.outIn);

  if (data.length === 0) {
    return <div className="h-72 flex items-center justify-center text-muted-foreground text-sm">まだラップがありません</div>;
  }

  // Y 軸レンジ（想定ラインが必ず入るように余白をとる）
  const times = data.map((d) => d.timeSec).concat(assumedLapSec);
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
          formatter={(v: number, _n, item) => {
            const c = (item?.payload as LapPoint)?.condition;
            return [`${formatLapTime(v)}（${CONDITION_LABEL[c] ?? c}）`, 'ラップ'];
          }}
          labelFormatter={(l) => `Lap ${l}`}
          contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
        />
        <ReferenceLine
          y={assumedLapSec}
          stroke="#f59e0b"
          strokeDasharray="4 4"
          label={{ value: `想定 ${formatLapTime(assumedLapSec)}`, position: 'insideTopRight', fontSize: 11, fill: '#b45309' }}
        />
        <Line
          type="monotone"
          dataKey="timeSec"
          stroke="var(--primary)"
          strokeWidth={2}
          isAnimationActive={false}
          dot={(props: { cx?: number; cy?: number; payload?: LapPoint; index?: number }) => {
            const { cx, cy, payload } = props;
            if (cx == null || cy == null || !payload) return <circle key={props.index} r={0} />;
            return <circle key={props.index} cx={cx} cy={cy} r={3.5} fill={CONDITION_COLOR[payload.condition] ?? 'var(--primary)'} />;
          }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
