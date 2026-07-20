'use client';

// 自チームの総合順位パネル。
// 計時サーバーはライブ取得のためクライアントから /api/standings を 10 秒ごとにポーリングする。
// 車番の決め方:
//   - carno prop 指定あり（共有ページ /share）: その車番に固定。入力UI・localStorage は使わない。
//   - carno prop なし（通常ダッシュボード）: 取込画面と同じ localStorage キー（scrape.carno）を共有し、画面で入力できる。
import { useCallback, useEffect, useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { PanelLabel } from '@/components/panel-label';

const CARNO_KEY = 'scrape.carno';

interface Props {
  // 指定すると車番をこの値に固定し、入力UIを出さない（共有ページ用）
  carno?: string | null;
  // 閲覧専用（共有ページ）。carno が未指定でも入力UI/localStorage を使わず「未設定」表示にする
  readOnly?: boolean;
  // 自チームがピット中かどうかを親へ通知（共有ダッシュボードの大バナー用）
  onPit?: (pit: boolean) => void;
}

interface StandingResponse {
  connected: boolean;
  carno?: string;
  found?: boolean;
  totalTeams?: number;
  our?: {
    pos: number | null;
    carno: string;
    teamName: string;
    className: string;
    classPos: number | null;
    lap: number | null;
    gap: string;
    pit?: boolean;
  } | null;
  ahead?: { pos: number | null; carno: string; teamName: string } | null;
  error?: string;
}

// 計時の Gap 文字列を表示用に整形。
// ""=首位 / "1 LAP"=周回遅れ / "2.967" や "1:29.672"=秒差
function gapText(gap: string | undefined): string {
  const g = (gap ?? '').trim();
  if (!g) return '首位';
  if (/lap/i.test(g)) {
    const n = g.match(/\d+/)?.[0];
    return n ? `${n}周` : g;
  }
  return `+${g}`;
}

export default function StandingTile({ carno: fixedCarno, readOnly = false, onPit }: Props) {
  const hasFixed = fixedCarno != null && fixedCarno.trim() !== '';
  // 「固定モード」= 入力・localStorage を使わない。readOnly（共有ページ）または車番 prop 指定時。
  const controlled = readOnly || hasFixed;
  const [carno, setCarno] = useState('');
  const [input, setInput] = useState('');
  const [data, setData] = useState<StandingResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);

  // 固定モードでなければ保存済み車番を復元。未設定なら入力を促す
  useEffect(() => {
    if (controlled) {
      setEditing(false);
      return;
    }
    const saved = typeof window !== 'undefined' ? localStorage.getItem(CARNO_KEY) : null;
    if (saved) {
      setCarno(saved);
      setInput(saved);
    } else {
      setEditing(true);
    }
  }, [controlled]);

  // 実際に問い合わせる車番。固定値があればそれ、readOnly で未指定なら空（=未設定表示）、
  // それ以外（通常ダッシュボード）は localStorage 由来の carno。
  const activeCarno = hasFixed ? (fixedCarno as string).trim() : readOnly ? '' : carno;

  const fetchStanding = useCallback(async (target: string) => {
    if (!target) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/standings?carno=${encodeURIComponent(target)}`, { cache: 'no-store' });
      setData((await res.json()) as StandingResponse);
    } catch {
      setData({ connected: false, error: '取得に失敗しました' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeCarno) fetchStanding(activeCarno);
  }, [activeCarno, fetchStanding]);
  useEffect(() => {
    if (!activeCarno) return;
    const id = setInterval(() => fetchStanding(activeCarno), 10000);
    return () => clearInterval(id);
  }, [activeCarno, fetchStanding]);

  // 自チームがピット中か（計時 PIT フラグ）。親へ通知し、下でも大きく表示する
  const pitActive = !!(data?.connected && data?.found && data?.our?.pit);
  const onPitRef = useRef(onPit);
  useEffect(() => {
    onPitRef.current = onPit;
  });
  useEffect(() => {
    onPitRef.current?.(pitActive);
  }, [pitActive]);

  const save = () => {
    const v = input.trim();
    if (!v) return;
    setCarno(v);
    setEditing(false);
    if (typeof window !== 'undefined') localStorage.setItem(CARNO_KEY, v);
  };

  return (
    <Card className={`overflow-hidden ${pitActive ? 'ring-2 ring-amber-500/70' : ''}`}>
      <div className={`h-[3px] ${pitActive ? 'bg-amber-500' : 'bg-gradient-to-r from-primary via-primary/40 to-transparent'}`} />
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2 gap-2">
          <PanelLabel>Standing / 自チーム順位（総合）</PanelLabel>
          <div className="flex items-center gap-2 text-xs">
            {activeCarno && !editing && <span className="font-mono font-bold text-primary">#{activeCarno}</span>}
            {loading && <span className="text-muted-foreground">更新中…</span>}
            {!controlled && !editing && (
              <button onClick={() => setEditing(true)} className="text-muted-foreground hover:underline">
                車番変更
              </button>
            )}
          </div>
        </div>

        {/* ピット中は大きく表示 */}
        {pitActive && (
          <div className="mb-3 rounded-md bg-amber-500/20 border-2 border-amber-500/60 px-3 py-2.5 flex items-center gap-3 animate-pulse">
            <span className="font-display text-3xl md:text-4xl font-black text-amber-400 leading-none whitespace-nowrap">🅿 PIT IN</span>
            <span className="text-sm text-amber-200 font-mono">#{activeCarno} ピット作業中</span>
          </div>
        )}

        {editing && !controlled ? (
          <div className="flex items-end gap-2">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">自チームの車番（ゼッケンNo）</label>
              <Input
                inputMode="numeric"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && save()}
                placeholder="例: 7"
                className="w-24 h-10 text-center font-mono"
              />
            </div>
            <Button onClick={save} className="h-10">
              設定
            </Button>
            <span className="text-xs text-muted-foreground pb-2">取込画面の車番と共有します</span>
          </div>
        ) : !activeCarno ? (
          <div className="text-sm text-muted-foreground">自車番号が未設定です。</div>
        ) : !data ? (
          <div className="text-sm text-muted-foreground">読み込み中…</div>
        ) : data.connected === false ? (
          <div className="text-sm text-amber-500">
            計時サーバー未接続（{data.error}）。サーキットの計時が稼働中かご確認ください。
          </div>
        ) : !data.found ? (
          <div className="text-sm text-muted-foreground">
            車番 #{activeCarno} が順位表に見つかりません（計測開始前、または車番違い）。
          </div>
        ) : (
          <div className="grid grid-cols-3 divide-x divide-border">
            <div className="pr-3">
              <div className="text-[10px] tracking-[0.16em] text-muted-foreground">順位（総合）</div>
              <div className="font-display text-3xl font-bold text-primary leading-tight">
                {data.our?.pos ?? '—'}
                <span className="text-base text-muted-foreground font-semibold">位</span>
              </div>
              <div className="text-[10px] text-muted-foreground font-mono truncate">
                {data.totalTeams ?? '—'}台中 ・ #{data.our?.carno}
              </div>
            </div>
            <div className="px-3">
              <div className="text-[10px] tracking-[0.16em] text-muted-foreground">前チームとの差</div>
              <div className="font-display text-3xl font-bold leading-tight">{gapText(data.our?.gap)}</div>
              <div className="text-[10px] text-muted-foreground font-mono">直上の順位との差</div>
            </div>
            <div className="pl-3">
              <div className="text-[10px] tracking-[0.16em] text-muted-foreground">前チーム</div>
              <div className="font-display text-3xl font-bold leading-tight">
                {data.ahead ? `#${data.ahead.carno}` : '—'}
              </div>
              <div className="text-[10px] text-muted-foreground font-mono truncate">
                {data.ahead ? data.ahead.teamName : '首位（前走車なし）'}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
