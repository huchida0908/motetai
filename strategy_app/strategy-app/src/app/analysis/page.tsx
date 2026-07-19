'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PanelLabel } from '@/components/panel-label';
import CompareChart from '@/components/CompareChart';
import { formatLapTime } from '@/lib/time';
import { CAR_PALETTE } from '@/lib/constants';
import { computeCarStats, type CarFeed, type CarStats } from '@/lib/analysis';
import { Star, X } from 'lucide-react';

interface TeamRow {
  carno: string;
  teamName: string;
  className: string;
  pos: number | null;
  lap: number | null;
  driverNameJ: string;
}

const SELECTED_KEY = 'analysis.carnos';
const OWN_KEY = 'scrape.carno'; // 取込画面と共有（前回選んだ車番＝自車の既定）

export default function AnalysisPage() {
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(false);

  const [selected, setSelected] = useState<string[]>([]);
  const [ownCarno, setOwnCarno] = useState<string | null>(null);

  const [cars, setCars] = useState<CarFeed[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const [filter, setFilter] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [manual, setManual] = useState('');

  // 初回: 前回の選択・自車を復元
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const s = JSON.parse(localStorage.getItem(SELECTED_KEY) ?? '[]');
      if (Array.isArray(s)) setSelected(s.filter((x) => typeof x === 'string'));
    } catch {
      /* noop */
    }
    setOwnCarno(localStorage.getItem(OWN_KEY));
  }, []);

  // 選択が変わったら保存
  useEffect(() => {
    if (typeof window !== 'undefined') localStorage.setItem(SELECTED_KEY, JSON.stringify(selected));
  }, [selected]);

  // 車番 → 固定色。エンティティに一度割り当てた色は選択が変わっても保持する。
  const colorRef = useRef<Map<string, string>>(new Map());
  const colorMap = useMemo(() => {
    const m = colorRef.current;
    const used = new Set(m.values());
    for (const c of selected) {
      if (!m.has(c)) {
        const next = CAR_PALETTE.find((col) => !used.has(col)) ?? CAR_PALETTE[m.size % CAR_PALETTE.length];
        m.set(c, next);
        used.add(next);
      }
    }
    return new Map(m);
  }, [selected]);
  const colorOf = useCallback((c: string) => colorMap.get(c) ?? '#8b98a9', [colorMap]);

  const teamByCarno = useMemo(() => new Map(teams.map((t) => [t.carno, t])), [teams]);
  const nameOf = useCallback(
    (c: string) => {
      const t = teamByCarno.get(c);
      if (!t?.teamName) return `#${c}`;
      const short = t.teamName.length > 10 ? `${t.teamName.slice(0, 10)}…` : t.teamName;
      return `#${c} ${short}`;
    },
    [teamByCarno],
  );

  const loadTeams = useCallback(async () => {
    setTeamsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/scrape/teams', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'チーム一覧の取得に失敗しました');
      setTeams(json.teams ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'チーム一覧の取得に失敗しました');
    } finally {
      setTeamsLoading(false);
    }
  }, []);

  const fetchCars = useCallback(async (carnos: string[]) => {
    if (carnos.length === 0) {
      setCars([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/analysis/cars?carnos=${encodeURIComponent(carnos.join(','))}`, {
        cache: 'no-store',
      });
      const json = await res.json();
      if (!res.ok && !json.cars) throw new Error(json.error ?? '取得に失敗しました');
      setCars(json.cars ?? []);
      setLastUpdated(Date.now());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, []);

  // 選択が変わったら取得。自動更新 ON なら 10 秒ごと。
  useEffect(() => {
    fetchCars(selected);
  }, [selected, fetchCars]);
  useEffect(() => {
    if (selected.length === 0 || !autoRefresh) return;
    const id = setInterval(() => fetchCars(selected), 10000);
    return () => clearInterval(id);
  }, [selected, autoRefresh, fetchCars]);

  const toggleSelect = (carno: string) =>
    setSelected((prev) => (prev.includes(carno) ? prev.filter((c) => c !== carno) : [...prev, carno]));

  const addManual = () => {
    const v = manual.trim();
    if (!v) return;
    if (!selected.includes(v)) setSelected((prev) => [...prev, v]);
    setManual('');
  };

  const markOwn = (carno: string) => {
    setOwnCarno(carno);
    if (typeof window !== 'undefined') localStorage.setItem(OWN_KEY, carno);
    if (!selected.includes(carno)) setSelected((prev) => [...prev, carno]);
  };

  const classes = useMemo(
    () => [...new Set(teams.map((t) => t.className).filter(Boolean))].sort(),
    [teams],
  );
  const filteredTeams = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return teams.filter(
      (t) =>
        (!classFilter || t.className === classFilter) &&
        (!q || t.carno.includes(q) || t.teamName.toLowerCase().includes(q)),
    );
  }, [teams, filter, classFilter]);

  // 統計（ペースの速い順に順位付け。平均タイム未算出は末尾）
  const stats = useMemo(() => {
    const list = cars.map((c) => computeCarStats(c));
    const ranked = [...list].sort((a, b) => (a.avgLapSec ?? Infinity) - (b.avgLapSec ?? Infinity));
    const rankOf = new Map(ranked.map((s, i) => [s.carno, s.avgLapSec != null ? i + 1 : null]));
    return { list: ranked, rankOf };
  }, [cars]);

  const carErrors = cars.filter((c) => c.error);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">分析</h1>
          <p className="mt-0.5 text-[10px] tracking-[0.3em] text-muted-foreground uppercase">
            Field Analysis ・ 自車＆他車 横並び比較
          </p>
        </div>
        {selected.length > 0 && (
          <div className="flex items-center gap-3 text-sm">
            {lastUpdated && (
              <span className="text-muted-foreground text-xs">
                更新 {new Date(lastUpdated).toLocaleTimeString('ja-JP')}
              </span>
            )}
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
              <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
              自動更新(10秒)
            </label>
            <Button variant="ghost" onClick={() => fetchCars(selected)} disabled={loading} className="h-8 px-3 text-xs">
              {loading ? '取得中…' : '今すぐ更新'}
            </Button>
          </div>
        )}
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive border border-destructive/30 rounded-md px-4 py-2 text-sm">
          {error}
        </div>
      )}
      {carErrors.length > 0 && (
        <div className="bg-amber-500/10 text-amber-500 border border-amber-500/30 rounded-md px-4 py-2 text-sm">
          一部の車番でラップを取得できませんでした: {carErrors.map((c) => `#${c.carno}`).join(', ')}
        </div>
      )}

      {/* 比較対象の選択 */}
      <Card>
        <CardHeader className="pb-2">
          <PanelLabel>Compare / 比較する車を選ぶ</PanelLabel>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-end gap-2 flex-wrap">
            <Button variant="outline" onClick={loadTeams} disabled={teamsLoading} className="h-10">
              {teamsLoading ? '一覧取得中…' : '出走一覧を取得'}
            </Button>
            <div className="mx-1 text-muted-foreground text-sm">または</div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">車番を直接追加</label>
              <div className="flex gap-2">
                <Input
                  inputMode="numeric"
                  value={manual}
                  onChange={(e) => setManual(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addManual()}
                  placeholder="例: 7"
                  className="w-24 h-10 text-center font-mono"
                />
                <Button onClick={addManual} className="h-10">
                  追加
                </Button>
              </div>
            </div>
          </div>

          {/* 選択中チップ */}
          {selected.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap pt-1">
              <span className="text-xs text-muted-foreground">選択中 {selected.length}台:</span>
              {selected.map((c) => (
                <span
                  key={c}
                  className="inline-flex items-center gap-1.5 rounded-full border pl-2 pr-1 py-0.5 text-sm"
                  style={{ borderColor: colorOf(c) }}
                >
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colorOf(c) }} />
                  <span className="font-mono">#{c}</span>
                  {c === ownCarno && <Star className="h-3 w-3 fill-primary text-primary" />}
                  <button
                    onClick={() => toggleSelect(c)}
                    className="ml-0.5 rounded-full p-0.5 text-muted-foreground hover:text-foreground hover:bg-accent"
                    aria-label={`#${c} を外す`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              <Button variant="ghost" onClick={() => setSelected([])} className="h-7 px-2 text-xs">
                全解除
              </Button>
            </div>
          )}

          {/* 出走一覧テーブル */}
          {teams.length > 0 && (
            <div className="space-y-2 pt-1">
              <div className="flex items-center gap-2 flex-wrap">
                <Input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="車番・チーム名で絞り込み"
                  className="h-9 w-56"
                />
                <select
                  value={classFilter}
                  onChange={(e) => setClassFilter(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="">全クラス</option>
                  {classes.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-muted-foreground">
                  {filteredTeams.length}/{teams.length}台
                </span>
              </div>

              <div className="overflow-x-auto max-h-80 overflow-y-auto rounded-md border border-border/60">
                <table className="min-w-full text-sm">
                  <thead className="text-muted-foreground border-b sticky top-0 bg-card">
                    <tr>
                      <th className="w-10 py-2 px-2 text-center">選択</th>
                      <th className="w-10 py-2 px-2 text-center">自車</th>
                      <th className="text-right py-2 px-2">順位</th>
                      <th className="text-left py-2 px-2">車番</th>
                      <th className="text-left py-2 px-2">チーム</th>
                      <th className="text-left py-2 px-2 hidden md:table-cell">クラス</th>
                      <th className="text-right py-2 px-2 hidden sm:table-cell">周回</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTeams.map((t) => {
                      const on = selected.includes(t.carno);
                      return (
                        <tr
                          key={t.carno}
                          className={`border-b border-border/40 cursor-pointer hover:bg-accent/40 ${on ? 'bg-primary/5' : ''}`}
                          onClick={() => toggleSelect(t.carno)}
                        >
                          <td className="py-1.5 px-2 text-center">
                            <input type="checkbox" checked={on} onChange={() => toggleSelect(t.carno)} onClick={(e) => e.stopPropagation()} />
                          </td>
                          <td className="py-1.5 px-2 text-center">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                markOwn(t.carno);
                              }}
                              aria-label={`#${t.carno} を自車に設定`}
                            >
                              <Star
                                className={`h-4 w-4 ${t.carno === ownCarno ? 'fill-primary text-primary' : 'text-muted-foreground/40 hover:text-muted-foreground'}`}
                              />
                            </button>
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono">{t.pos ?? '—'}</td>
                          <td className="py-1.5 px-2 font-mono font-bold">
                            <span className="inline-flex items-center gap-1.5">
                              {on && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: colorOf(t.carno) }} />}
                              #{t.carno}
                            </span>
                          </td>
                          <td className="py-1.5 px-2 max-w-[16rem] truncate">{t.teamName}</td>
                          <td className="py-1.5 px-2 hidden md:table-cell text-muted-foreground">{t.className}</td>
                          <td className="py-1.5 px-2 text-right font-mono hidden sm:table-cell">{t.lap ?? '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {selected.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            比較する車を選んでください。
            <br />
            「出走一覧を取得」してチェック、または車番を直接追加すると分析が始まります。
            <br />
            <span className="text-xs">★ で自車を指定すると強調表示されます。</span>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* ペース・統計テーブル */}
          <Card>
            <CardHeader className="pb-2">
              <PanelLabel>Pace / ペース・統計（クリーン周ベース）</PanelLabel>
            </CardHeader>
            <CardContent>
              <StatsTable stats={stats.list} rankOf={stats.rankOf} ownCarno={ownCarno} colorOf={colorOf} nameOf={nameOf} />
            </CardContent>
          </Card>

          {/* 比較チャート */}
          <Card>
            <CardHeader className="pb-2">
              <PanelLabel>Telemetry / 比較チャート</PanelLabel>
            </CardHeader>
            <CardContent>
              <CompareChart cars={cars} ownCarno={ownCarno} colorOf={colorOf} nameOf={nameOf} />
            </CardContent>
          </Card>

          {/* スティント / ピット内訳 */}
          <Card>
            <CardHeader className="pb-2">
              <PanelLabel>Stints / スティント・ピット内訳</PanelLabel>
            </CardHeader>
            <CardContent className="space-y-4">
              {stats.list.map((s) => (
                <StintRow key={s.carno} stats={s} ownCarno={ownCarno} color={colorOf(s.carno)} name={nameOf(s.carno)} />
              ))}
              {stats.list.every((s) => s.stintCount === 0) && (
                <div className="text-center py-6 text-muted-foreground text-sm">スティントを検出できるラップがまだありません</div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ── ペース・統計テーブル ──────────────────────────────
function StatsTable({
  stats,
  rankOf,
  ownCarno,
  colorOf,
  nameOf,
}: {
  stats: CarStats[];
  rankOf: Map<string, number | null>;
  ownCarno: string | null;
  colorOf: (c: string) => string;
  nameOf: (c: string) => string;
}) {
  // 各指標のフィールドベスト（強調用）
  const bestOf = (pick: (s: CarStats) => number | null, dir: 'min' | 'max' = 'min') => {
    const vals = stats.map(pick).filter((v): v is number => v != null);
    if (!vals.length) return null;
    return dir === 'min' ? Math.min(...vals) : Math.max(...vals);
  };
  const fastBest = bestOf((s) => s.bestLapSec);
  const fastAvg = bestOf((s) => s.avgLapSec);
  const fastTheo = bestOf((s) => s.theoreticalBestSec);
  const topSpd = bestOf((s) => s.topSpeed, 'max');

  const hl = (v: number | null, best: number | null) =>
    v != null && best != null && v === best ? 'text-primary font-bold' : '';

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm tabular-nums">
        <thead className="text-muted-foreground border-b">
          <tr>
            <th className="text-right py-2 px-2">#</th>
            <th className="text-left py-2 px-2">車</th>
            <th className="text-right py-2 px-2">周</th>
            <th className="text-right py-2 px-2">ベスト</th>
            <th className="text-right py-2 px-2">平均</th>
            <th className="text-right py-2 px-2 hidden md:table-cell">中央値</th>
            <th className="text-right py-2 px-2" title="クリーン周の標準偏差（小さいほど安定）">安定σ</th>
            <th className="text-right py-2 px-2 hidden lg:table-cell" title="各セクターベストの和">理論ベスト</th>
            <th className="text-right py-2 px-2 hidden lg:table-cell">最高速</th>
            <th className="text-right py-2 px-2 hidden sm:table-cell">ピット</th>
          </tr>
        </thead>
        <tbody>
          {stats.map((s) => {
            const own = s.carno === ownCarno;
            const rank = rankOf.get(s.carno);
            return (
              <tr key={s.carno} className={`border-b border-border/40 ${own ? 'bg-primary/5' : ''}`}>
                <td className="py-2 px-2 text-right font-mono text-muted-foreground">{rank ?? '—'}</td>
                <td className="py-2 px-2">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: colorOf(s.carno) }} />
                    <span className="font-medium truncate max-w-[12rem]">{nameOf(s.carno)}</span>
                    {own && <Star className="h-3 w-3 fill-primary text-primary shrink-0" />}
                  </span>
                </td>
                <td className="py-2 px-2 text-right font-mono">{s.lapCount || '—'}</td>
                <td className={`py-2 px-2 text-right font-mono ${hl(s.bestLapSec, fastBest)}`}>{formatLapTime(s.bestLapSec)}</td>
                <td className={`py-2 px-2 text-right font-mono ${hl(s.avgLapSec, fastAvg)}`}>{formatLapTime(s.avgLapSec)}</td>
                <td className="py-2 px-2 text-right font-mono hidden md:table-cell">{formatLapTime(s.medianLapSec)}</td>
                <td className="py-2 px-2 text-right font-mono">{s.stdevSec != null ? `${s.stdevSec.toFixed(2)}s` : '—'}</td>
                <td
                  className={`py-2 px-2 text-right font-mono hidden lg:table-cell ${hl(s.theoreticalBestSec, fastTheo)}`}
                  title={s.bestSectors.map((x, i) => `S${i + 1} ${x != null ? x.toFixed(3) : '—'}`).join(' / ')}
                >
                  {formatLapTime(s.theoreticalBestSec)}
                </td>
                <td className={`py-2 px-2 text-right font-mono hidden lg:table-cell ${hl(s.topSpeed, topSpd)}`}>
                  {s.topSpeed != null ? `${s.topSpeed.toFixed(1)}` : '—'}
                </td>
                <td className="py-2 px-2 text-right font-mono hidden sm:table-cell">{s.pitCount}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-muted-foreground">
        平均・中央値・安定σ はベストラップの107%以内の「クリーン周」で算出（SCや混雑周を除外）。<span className="text-primary">赤字</span>=各項目のトップ。
      </p>
    </div>
  );
}

// ── スティント / ピット内訳 ──────────────────────────
function StintRow({
  stats,
  ownCarno,
  color,
  name,
}: {
  stats: CarStats;
  ownCarno: string | null;
  color: string;
  name: string;
}) {
  const own = stats.carno === ownCarno;
  return (
    <div className={`rounded-md border p-3 ${own ? 'border-primary/40 bg-primary/5' : 'border-border/60'}`}>
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
        <span className="font-medium">{name}</span>
        {own && <Star className="h-3 w-3 fill-primary text-primary" />}
        <span className="text-xs text-muted-foreground font-mono ml-1">
          {stats.stintCount}スティント ・ ピット{stats.pitCount}回
          {stats.avgStintLaps != null ? ` ・ 平均${stats.avgStintLaps.toFixed(1)}周/スティント` : ''}
        </span>
      </div>
      {stats.stints.length > 0 ? (
        <div className="flex gap-2 flex-wrap">
          {stats.stints.map((st) => (
            <div
              key={st.index}
              className="rounded-md border border-border/60 px-2.5 py-1.5 text-xs min-w-[9rem]"
              title={`ベスト ${formatLapTime(st.bestSec)}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold">S{st.index}</span>
                <span className="font-mono text-muted-foreground">
                  L{st.startLap}–{st.endLap}
                </span>
                {!st.endedByPit && (
                  <span className="text-[10px] text-amber-500 border border-amber-500/40 rounded px-1">走行中</span>
                )}
              </div>
              <div className="mt-0.5 font-mono">
                {st.lapCount}周 ・ 平均 {formatLapTime(st.avgSec)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-xs text-muted-foreground">ラップ未取得</div>
      )}
    </div>
  );
}
