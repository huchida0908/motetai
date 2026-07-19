'use client';

import { useMemo, useState } from 'react';
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
import { formatLapTime } from '@/lib/time';
import { lapTimeChartData, gapChartData, type CarFeed } from '@/lib/analysis';

type Mode = 'lapTime' | 'gap';

// 複数車の比較チャート。
// - ラップタイム: x=周番号, y=ラップ秒。各車を色分けで重ね描き（グリーン周のみ）。
// - ギャップ: 基準車の累計タイムに対する各車の差（＋=遅れ / −=先行）。
export default function CompareChart({
  cars,
  ownCarno,
  colorOf,
  nameOf,
}: {
  cars: CarFeed[];
  ownCarno: string | null;
  colorOf: (carno: string) => string;
  nameOf: (carno: string) => string;
}) {
  const [mode, setMode] = useState<Mode>('lapTime');
  const carnos = cars.map((c) => c.carno);

  // ギャップの基準車: 自車が対象にいればそれ、無ければ先頭
  const defaultRef = ownCarno && carnos.includes(ownCarno) ? ownCarno : carnos[0] ?? '';
  const [refCarno, setRefCarno] = useState<string>(defaultRef);
  const ref = carnos.includes(refCarno) ? refCarno : defaultRef;

  const lapData = useMemo(() => lapTimeChartData(cars), [cars]);
  const gapData = useMemo(() => gapChartData(cars, ref), [cars, ref]);

  const fmtGap = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}s`;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        {mode === 'gap' ? (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            基準車
            <select
              value={ref}
              onChange={(e) => setRefCarno(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
            >
              {carnos.map((c) => (
                <option key={c} value={c}>
                  #{c}
                </option>
              ))}
            </select>
            <span className="text-muted-foreground/70">に対する差（＋=遅れ）</span>
          </label>
        ) : (
          <span className="text-xs text-muted-foreground">グリーン周のみ（ピット/アウトラップ除外）</span>
        )}
        <div className="flex gap-1 rounded-md border p-0.5">
          {(
            [
              ['lapTime', 'ラップタイム'],
              ['gap', 'ギャップ'],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                mode === m ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {mode === 'lapTime' ? (
        <LapCompare data={lapData} carnos={carnos} ownCarno={ownCarno} colorOf={colorOf} nameOf={nameOf} />
      ) : (
        <GapCompare
          data={gapData}
          carnos={carnos.filter((c) => c !== ref)}
          refCarno={ref}
          ownCarno={ownCarno}
          colorOf={colorOf}
          nameOf={nameOf}
          fmtGap={fmtGap}
        />
      )}
    </div>
  );
}

const AXIS = 'var(--muted-foreground)';
const tooltipStyle = {
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  fontSize: 12,
} as const;

function LapCompare({
  data,
  carnos,
  ownCarno,
  colorOf,
  nameOf,
}: {
  data: Array<Record<string, number | null>>;
  carnos: string[];
  ownCarno: string | null;
  colorOf: (c: string) => string;
  nameOf: (c: string) => string;
}) {
  if (data.length === 0) {
    return (
      <div className="h-72 flex items-center justify-center text-muted-foreground text-sm">
        比較できるラップがまだありません
      </div>
    );
  }
  const times = data.flatMap((r) => carnos.map((c) => r[c]).filter((v): v is number => v != null));
  const min = Math.min(...times) - 1;
  const max = Math.max(...times) + 1;

  return (
    <ResponsiveContainer width="100%" height={320}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis dataKey="lap" type="number" domain={['dataMin', 'dataMax']} tick={{ fontSize: 12 }} stroke={AXIS} />
        <YAxis
          domain={[min, max]}
          tickFormatter={(v) => formatLapTime(v as number)}
          width={64}
          tick={{ fontSize: 12 }}
          stroke={AXIS}
        />
        <Tooltip
          formatter={(v: number, name) => [formatLapTime(v), `#${name}`]}
          labelFormatter={(l) => `Lap ${l}`}
          contentStyle={tooltipStyle}
          itemSorter={(item) => (item.value as number) ?? 0}
        />
        <Legend formatter={(v) => nameOf(String(v))} wrapperStyle={{ fontSize: 12 }} />
        {carnos.map((c) => {
          const own = c === ownCarno;
          return (
            <Line
              key={c}
              type="monotone"
              dataKey={c}
              name={c}
              stroke={colorOf(c)}
              strokeWidth={own ? 3 : 1.75}
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
              connectNulls
            />
          );
        })}
      </LineChart>
    </ResponsiveContainer>
  );
}

function GapCompare({
  data,
  carnos,
  refCarno,
  ownCarno,
  colorOf,
  nameOf,
  fmtGap,
}: {
  data: Array<Record<string, number | null>>;
  carnos: string[];
  refCarno: string;
  ownCarno: string | null;
  colorOf: (c: string) => string;
  nameOf: (c: string) => string;
  fmtGap: (v: number) => string;
}) {
  if (data.length === 0 || carnos.length === 0) {
    return (
      <div className="h-72 flex items-center justify-center text-muted-foreground text-sm">
        ギャップを計算できるデータがありません（累計タイム未取得）
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={320}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis dataKey="lap" type="number" domain={['dataMin', 'dataMax']} tick={{ fontSize: 12 }} stroke={AXIS} />
        <YAxis tickFormatter={(v) => fmtGap(v as number)} width={56} tick={{ fontSize: 12 }} stroke={AXIS} />
        <Tooltip
          formatter={(v: number, name) => [fmtGap(v), `#${name}`]}
          labelFormatter={(l) => `Lap ${l}`}
          contentStyle={tooltipStyle}
          itemSorter={(item) => (item.value as number) ?? 0}
        />
        <Legend formatter={(v) => nameOf(String(v))} wrapperStyle={{ fontSize: 12 }} />
        <ReferenceLine
          y={0}
          stroke="var(--muted-foreground)"
          strokeDasharray="4 4"
          label={{ value: `基準 #${refCarno}`, position: 'insideTopRight', fontSize: 11, fill: 'var(--muted-foreground)' }}
        />
        {carnos.map((c) => {
          const own = c === ownCarno;
          return (
            <Line
              key={c}
              type="monotone"
              dataKey={c}
              name={c}
              stroke={colorOf(c)}
              strokeWidth={own ? 3 : 1.75}
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
              connectNulls
            />
          );
        })}
      </LineChart>
    </ResponsiveContainer>
  );
}
