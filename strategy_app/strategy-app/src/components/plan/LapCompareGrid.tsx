'use client';

// 計画/実績/対比の周単位グリッド。
// - スティントごとにセクション区切り
// - 複数行選択（チェックボックス・Shift 範囲・スティント内 全選択）
// - 編集モードでセルをインライン入力＋選択行へ一括適用
// 実際の保存や state 保持は親（/plan）が持ち、ここは表示と選択・編集イベントの発火に徹する。

import { useEffect, useMemo, useState, type ReactNode, type MouseEvent as ReactMouseEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatLapTime, formatMinSec } from '@/lib/time';
import { CONDITIONS, CONDITION_LABEL, CONDITION_COLOR } from '@/lib/constants';

export type GridMode = 'plan' | 'actual' | 'compare';

export interface GridRider {
  id: string;
  name: string;
  color?: string | null;
}

// 編集で親へ渡すパッチ。timeStr は生入力（親が parseLapTime する）
export interface CellPatch {
  riderId?: string | null;
  condition?: string;
  outIn?: 'OUT' | 'IN' | null;
  timeStr?: string;
}

// 1 行分。mode により使う列を出し分ける（編集対象サイドの実効値を top-level に持つ）
export interface GridRow {
  lapNumber: number;
  stintNumber: number | null;
  selectable: boolean; // 選択可否（false の行は編集対象にできない）
  // 編集対象サイド（plan では計画、actual/compare では実績）の実効値
  riderId: string | null;
  condition: string;
  outIn: 'OUT' | 'IN' | null;
  timeSec: number | null;
  timeStr?: string; // 編集中の生入力（あれば優先表示）
  edited: boolean; // 上書き/編集済み → ハイライト
  frozen?: boolean; // plan 走行済み（実績が付いた周）＝「走行済」表示専用。編集はロックしない
  // plan 表示補助（読み取り専用）
  fuelRemainingL?: number | null;
  cumTimeSec?: number | null;
  tireChange?: boolean; // OUT 周のタイヤ交換マーク
  // compare 用（相手＝計画サイド、読み取り専用）
  planRiderId?: string | null;
  planTimeSec?: number | null;
  planOutIn?: 'OUT' | 'IN' | null;
  diffSec?: number | null;
  cumDiffSec?: number | null;
  isExtra?: boolean; // 計画超過の実績周
}

interface LapCompareGridProps {
  mode: GridMode;
  editing: boolean;
  rows: GridRow[];
  riders: GridRider[];
  riderName: (id: string | null) => string;
  // セクション見出しに添える補助（スティントの担当名など）
  stintLabel?: (stintNumber: number) => string | undefined;
  onCellChange?: (lapNumber: number, patch: CellPatch) => void;
  onBulkChange?: (lapNumbers: number[], patch: CellPatch) => void;
  onReset?: (lapNumbers: number[]) => void; // plan: 上書き解除 / actual・compare: 編集取消
  resetLabel?: string;
  onDeleteRow?: (lapNumber: number) => void; // actual のみ
  tabbed?: boolean; // ST 単位でタブ分割し、選択中のスティントだけ表示する
  emptyText?: string;
}

// ── 行選択フック（Shift 範囲対応） ─────────────────────
function useRowSelection() {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [anchor, setAnchor] = useState<number | null>(null);

  const toggle = (lap: number, shiftKey: boolean, ordered: number[]) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (shiftKey && anchor != null) {
        const a = ordered.indexOf(anchor);
        const b = ordered.indexOf(lap);
        if (a >= 0 && b >= 0) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          for (let i = lo; i <= hi; i++) next.add(ordered[i]);
          setAnchor(lap);
          return next;
        }
      }
      if (next.has(lap)) next.delete(lap);
      else next.add(lap);
      return next;
    });
    setAnchor(lap);
  };
  const setMany = (laps: number[], on: boolean) =>
    setSelected((prev) => {
      const n = new Set(prev);
      laps.forEach((l) => (on ? n.add(l) : n.delete(l)));
      return n;
    });
  const clear = () => setSelected(new Set());
  return { selected, toggle, setMany, clear };
}

export function LapCompareGrid({
  mode,
  editing,
  rows,
  riders,
  riderName,
  stintLabel,
  onCellChange,
  onBulkChange,
  onReset,
  resetLabel,
  onDeleteRow,
  tabbed,
  emptyText,
}: LapCompareGridProps) {
  const { selected, toggle, setMany, clear } = useRowSelection();
  // ST タブの選択中スティント（tabbed 時のみ使用）。groups のキー（"1" 等）を持つ
  const [activeTab, setActiveTab] = useState<string | null>(null);

  // モード切替・編集終了・タブ切替で選択をリセット
  useEffect(() => {
    clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, editing, activeTab]);

  const showOutInEdit = mode === 'actual';
  const showCondEdit = mode === 'plan' || mode === 'actual';
  const isCompare = mode === 'compare';

  // スティントごとにグループ化
  const groups = useMemo(() => {
    const map = new Map<number | string, GridRow[]>();
    for (const r of rows) {
      const key = r.isExtra ? 'extra' : r.stintNumber ?? 'none';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return Array.from(map.entries()).map(([key, rs]) => {
      const laps = rs.map((r) => r.lapNumber);
      const stNo = typeof key === 'number' ? key : null;
      return {
        key: String(key),
        stintNumber: stNo,
        isExtra: key === 'extra',
        rows: rs,
        from: Math.min(...laps),
        to: Math.max(...laps),
      };
    });
  }, [rows]);

  // tabbed 時: 選択中スティントが無くなったら先頭へ寄せる
  useEffect(() => {
    if (!tabbed) return;
    if (groups.length === 0) {
      if (activeTab !== null) setActiveTab(null);
      return;
    }
    if (activeTab == null || !groups.some((g) => g.key === activeTab)) {
      setActiveTab(groups[0].key);
    }
  }, [tabbed, groups, activeTab]);

  // 表示対象グループ（tabbed なら選択タブのみ、通常は全スティント）
  const visibleGroups = useMemo(
    () => (tabbed && activeTab != null ? groups.filter((g) => g.key === activeTab) : groups),
    [tabbed, activeTab, groups],
  );
  const visibleRows = useMemo(() => visibleGroups.flatMap((g) => g.rows), [visibleGroups]);

  // Shift 範囲用: 選択可能な lapNumber を表示順に（tabbed 時は表示中スティント内に限定）
  const orderedSelectable = useMemo(() => visibleRows.filter((r) => r.selectable).map((r) => r.lapNumber), [visibleRows]);
  const selectedArr = useMemo(() => orderedSelectable.filter((l) => selected.has(l)), [orderedSelectable, selected]);

  // 一括バーの入力
  const [bulkRider, setBulkRider] = useState('');
  const [bulkCond, setBulkCond] = useState('D');
  const [bulkOutIn, setBulkOutIn] = useState('');
  const [bulkTime, setBulkTime] = useState('');

  const applyBulk = (patch: CellPatch) => {
    if (selectedArr.length === 0) return;
    onBulkChange?.(selectedArr, patch);
  };

  // 列数: compare=9 / plan=8（チェック・Lap・走者・区分・路面・タイム・残L・累積）/ actual=7（末尾に削除列）
  const colCount = isCompare ? 9 : mode === 'plan' ? 8 : 7;

  return (
    <div className="space-y-3">
      {/* 一括編集バー（編集モード時） */}
      {editing && (
        <div className="flex items-center gap-2 flex-wrap text-sm border rounded-md p-3 bg-muted/30">
          <span className="text-xs text-muted-foreground">
            選択 {selectedArr.length} 行に一括適用
          </span>
          {/* 走者 */}
          <select
            value={bulkRider}
            onChange={(e) => setBulkRider(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">走者…</option>
            {riders.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
          <Button
            variant="outline"
            className="h-9"
            disabled={selectedArr.length === 0 || bulkRider === ''}
            onClick={() => applyBulk({ riderId: bulkRider || null })}
          >
            走者を適用
          </Button>
          {/* 路面 */}
          {showCondEdit && (
            <>
              <select
                value={bulkCond}
                onChange={(e) => setBulkCond(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              >
                {CONDITIONS.map((c) => (
                  <option key={c} value={c}>{CONDITION_LABEL[c]}</option>
                ))}
              </select>
              <Button
                variant="outline"
                className="h-9"
                disabled={selectedArr.length === 0}
                onClick={() => applyBulk({ condition: bulkCond })}
              >
                路面を適用
              </Button>
            </>
          )}
          {/* OUT/IN（実績のみ） */}
          {showOutInEdit && (
            <>
              <select
                value={bulkOutIn}
                onChange={(e) => setBulkOutIn(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="">—（通常）</option>
                <option value="OUT">OUT</option>
                <option value="IN">IN（ピット）</option>
              </select>
              <Button
                variant="outline"
                className="h-9"
                disabled={selectedArr.length === 0}
                onClick={() => applyBulk({ outIn: (bulkOutIn || null) as 'OUT' | 'IN' | null })}
              >
                区分を適用
              </Button>
            </>
          )}
          {/* タイム */}
          <Input
            value={bulkTime}
            onChange={(e) => setBulkTime(e.target.value)}
            placeholder="2:26.271"
            className="w-28 h-9 font-mono"
          />
          <Button
            variant="outline"
            className="h-9"
            disabled={selectedArr.length === 0 || bulkTime.trim() === ''}
            onClick={() => applyBulk({ timeStr: bulkTime })}
          >
            タイムを適用
          </Button>
          <div className="flex-1" />
          {onReset && (
            <Button
              variant="ghost"
              className="h-9 text-xs"
              disabled={selectedArr.length === 0}
              onClick={() => onReset(selectedArr)}
            >
              {resetLabel ?? '選択をリセット'}
            </Button>
          )}
        </div>
      )}

      {/* ST タブ（tabbed 時） */}
      {tabbed && groups.length > 0 && (
        <div className="flex flex-wrap gap-1 rounded-md border p-1">
          {groups.map((g) => {
            const active = g.key === activeTab;
            const tLabel = g.isExtra ? '計画超過' : g.stintNumber != null ? `ST${g.stintNumber}` : '未割当';
            const sub = g.isExtra ? '' : g.stintNumber != null ? stintLabel?.(g.stintNumber) ?? '' : '';
            return (
              <button
                key={g.key}
                onClick={() => setActiveTab(g.key)}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                  active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
                title={sub || undefined}
              >
                {tLabel}
                {sub ? (
                  <span className={`ml-1.5 text-xs ${active ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>{sub}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}

      <div className="overflow-x-auto max-h-[40rem] overflow-y-auto">
        <table className="min-w-full text-sm">
          <thead className="text-muted-foreground border-b sticky top-0 bg-card z-10">
            <tr>
              <th className="w-8 py-2 px-2"></th>
              <th className="text-left py-2 px-2">Lap</th>
              {isCompare ? (
                <>
                  <th className="text-left py-2 px-2">計画走者</th>
                  <th className="text-left py-2 px-2">実績走者</th>
                  <th className="text-left py-2 px-2">区分</th>
                  <th className="text-right py-2 px-2">計画</th>
                  <th className="text-right py-2 px-2">実績</th>
                  <th className="text-right py-2 px-2">差</th>
                  <th className="text-right py-2 px-2">累積差</th>
                </>
              ) : (
                <>
                  <th className="text-left py-2 px-2">走者</th>
                  <th className="text-left py-2 px-2">区分</th>
                  <th className="text-left py-2 px-2">路面</th>
                  <th className="text-right py-2 px-2">{mode === 'plan' ? '計画タイム' : '実績タイム'}</th>
                  {mode === 'plan' ? (
                    <>
                      <th className="text-right py-2 px-2">残L</th>
                      <th className="text-right py-2 px-2">累積</th>
                    </>
                  ) : (
                    <th className="py-2 px-2"></th>
                  )}
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {visibleGroups.map((g) => {
              const groupSelectable = g.rows.filter((r) => r.selectable).map((r) => r.lapNumber);
              const allSelected = groupSelectable.length > 0 && groupSelectable.every((l) => selected.has(l));
              const label = g.isExtra
                ? '計画超過'
                : g.stintNumber != null
                  ? `ST${g.stintNumber}${stintLabel?.(g.stintNumber) ? ` ・ ${stintLabel(g.stintNumber)}` : ''}`
                  : 'スティント未割当';
              return (
                <FragmentGroup key={g.key}>
                  {/* セクション見出し */}
                  <tr className="bg-muted/40 border-b border-border/60">
                    <td className="py-1.5 px-2">
                      {editing && groupSelectable.length > 0 && (
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={(e) => setMany(groupSelectable, e.target.checked)}
                          className="h-4 w-4"
                          title="このスティントを全選択"
                        />
                      )}
                    </td>
                    <td colSpan={colCount - 1} className="py-1.5 px-2 text-xs font-semibold tracking-wide">
                      {label}
                      <span className="ml-2 font-mono text-muted-foreground">
                        Lap {g.from}–{g.to}（{g.rows.length}周）
                      </span>
                    </td>
                  </tr>
                  {g.rows.map((r) => (
                    <Row
                      key={r.lapNumber}
                      row={r}
                      mode={mode}
                      editing={editing}
                      riders={riders}
                      riderName={riderName}
                      selected={selected.has(r.lapNumber)}
                      onToggle={(shiftKey) => toggle(r.lapNumber, shiftKey, orderedSelectable)}
                      onCellChange={onCellChange}
                      onDeleteRow={onDeleteRow}
                      showOutInEdit={showOutInEdit}
                      showCondEdit={showCondEdit}
                    />
                  ))}
                </FragmentGroup>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={colCount} className="text-center py-8 text-muted-foreground">
                  {emptyText ?? 'データがありません'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// tbody 直下に複数 tr を返すためのフラグメント（key 用ラッパ）
function FragmentGroup({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

// ── 1 行 ─────────────────────
function Row({
  row: r,
  mode,
  editing,
  riders,
  riderName,
  selected,
  onToggle,
  onCellChange,
  onDeleteRow,
  showOutInEdit,
  showCondEdit,
}: {
  row: GridRow;
  mode: GridMode;
  editing: boolean;
  riders: GridRider[];
  riderName: (id: string | null) => string;
  selected: boolean;
  onToggle: (shiftKey: boolean) => void;
  onCellChange?: (lapNumber: number, patch: CellPatch) => void;
  onDeleteRow?: (lapNumber: number) => void;
  showOutInEdit: boolean;
  showCondEdit: boolean;
}) {
  const isCompare = mode === 'compare';
  // frozen（走行済＝実績が付いた周）でも編集可能にする。frozen は表示（ラベル/背景）専用。
  const editable = editing && r.selectable;
  // 選択中・編集済みのハイライトを frozen 背景より優先（frozen 周を編集中でも変更が分かるように）。
  const rowBg = selected
    ? 'bg-primary/10'
    : r.edited
      ? 'bg-amber-500/10'
      : r.frozen
        ? 'bg-muted/30'
        : r.isExtra
          ? 'bg-emerald-500/10'
          : '';

  const timeValue = r.timeStr ?? (r.timeSec != null ? formatLapTime(r.timeSec) : '');

  const riderSelect = (value: string | null, onChange: (v: string) => void) => (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 rounded border border-input bg-background px-1.5 text-xs max-w-[8rem]"
    >
      <option value="">—</option>
      {riders.map((rd) => (
        <option key={rd.id} value={rd.id}>{rd.name}</option>
      ))}
    </select>
  );

  return (
    <tr className={`border-b border-border/40 ${rowBg}`}>
      <td className="py-1 px-2">
        {editing && r.selectable && (
          <input
            type="checkbox"
            checked={selected}
            onChange={() => undefined}
            onClick={(e: ReactMouseEvent<HTMLInputElement>) => onToggle(e.shiftKey)}
            className="h-4 w-4"
          />
        )}
      </td>
      <td className="py-1 px-2 font-mono">
        {r.lapNumber}
        {r.frozen && <span className="ml-1 text-[10px] text-muted-foreground">走行済</span>}
      </td>

      {isCompare ? (
        <>
          {/* 計画走者（ro） */}
          <td className="py-1 px-2 text-muted-foreground">{r.isExtra ? '計画超過' : riderName(r.planRiderId ?? null)}</td>
          {/* 実績走者（edit） */}
          <td className="py-1 px-2">
            {editable
              ? riderSelect(r.riderId, (v) => onCellChange?.(r.lapNumber, { riderId: v || null }))
              : r.timeSec != null
                ? riderName(r.riderId)
                : '-'}
          </td>
          {/* 区分（計画 OUT/IN + 実績が違えば注記） */}
          <td className="py-1 px-2 text-xs whitespace-nowrap">
            {r.planOutIn ?? ''}
            {r.outIn && r.outIn !== r.planOutIn && <span className="text-amber-400 ml-1">実績:{r.outIn}</span>}
          </td>
          {/* 計画（ro） */}
          <td className="py-1 px-2 text-right font-mono text-muted-foreground">
            {r.planTimeSec != null ? formatLapTime(r.planTimeSec) : '-'}
          </td>
          {/* 実績（edit） */}
          <td className="py-1 px-2 text-right font-mono">
            {editable ? (
              <Input
                value={timeValue}
                onChange={(e) => onCellChange?.(r.lapNumber, { timeStr: e.target.value })}
                className="w-24 h-8 font-mono text-right inline-block"
              />
            ) : r.timeSec != null ? (
              formatLapTime(r.timeSec)
            ) : (
              '-'
            )}
          </td>
          {/* 差・累積差 */}
          <td className={`py-1 px-2 text-right font-mono ${diffClass(r.diffSec)}`}>
            {r.diffSec != null ? `${r.diffSec <= 0 ? '−' : '+'}${Math.abs(r.diffSec).toFixed(3)}` : '-'}
          </td>
          <td className={`py-1 px-2 text-right font-mono ${diffClass(r.cumDiffSec)}`}>
            {r.cumDiffSec != null ? `${r.cumDiffSec <= 0 ? '−' : '+'}${formatMinSec(Math.abs(r.cumDiffSec))}` : '-'}
          </td>
        </>
      ) : (
        <>
          {/* 走者 */}
          <td className="py-1 px-2">
            {editable ? riderSelect(r.riderId, (v) => onCellChange?.(r.lapNumber, { riderId: v || null })) : riderName(r.riderId)}
          </td>
          {/* 区分 OUT/IN */}
          <td className="py-1 px-2 text-xs whitespace-nowrap">
            {editable && showOutInEdit ? (
              <select
                value={r.outIn ?? ''}
                onChange={(e) => onCellChange?.(r.lapNumber, { outIn: (e.target.value || null) as 'OUT' | 'IN' | null })}
                className="h-8 rounded border border-input bg-background px-1 text-xs"
              >
                <option value="">—</option>
                <option value="OUT">OUT</option>
                <option value="IN">IN</option>
              </select>
            ) : (
              <>
                {r.outIn ?? ''}
                {r.outIn === 'OUT' && r.tireChange && (
                  <span className="ml-1 text-amber-400" title="このピットでタイヤ交換">🛞</span>
                )}
              </>
            )}
          </td>
          {/* 路面 */}
          <td className="py-1 px-2">
            {editable && showCondEdit ? (
              <select
                value={r.condition}
                onChange={(e) => onCellChange?.(r.lapNumber, { condition: e.target.value })}
                className="h-8 rounded border border-input bg-background px-1 text-xs"
              >
                {CONDITIONS.map((c) => (
                  <option key={c} value={c}>{CONDITION_LABEL[c]}</option>
                ))}
              </select>
            ) : (
              <span
                className="inline-block px-2 py-0.5 rounded-full text-xs text-white whitespace-nowrap"
                style={{ backgroundColor: CONDITION_COLOR[r.condition] ?? '#6b7280' }}
              >
                {CONDITION_LABEL[r.condition] ?? r.condition}
              </span>
            )}
          </td>
          {/* タイム */}
          <td className="py-1 px-2 text-right font-mono">
            {editable ? (
              <Input
                value={timeValue}
                onChange={(e) => onCellChange?.(r.lapNumber, { timeStr: e.target.value })}
                className="w-24 h-8 font-mono text-right inline-block"
              />
            ) : r.timeSec != null ? (
              formatLapTime(r.timeSec)
            ) : (
              <span className="text-muted-foreground">-</span>
            )}
          </td>
          {/* plan: 残L・累積 / actual: 削除 */}
          {mode === 'plan' ? (
            <>
              <td className={`py-1 px-2 text-right font-mono ${(r.fuelRemainingL ?? 0) < 0 ? 'text-destructive font-bold' : ''}`}>
                {r.fuelRemainingL != null ? r.fuelRemainingL.toFixed(2) : '-'}
              </td>
              <td className="py-1 px-2 text-right font-mono text-xs text-muted-foreground">
                {r.cumTimeSec != null ? formatMinSec(r.cumTimeSec) : '-'}
              </td>
            </>
          ) : (
            <td className="py-1 px-2 text-right whitespace-nowrap">
              {editing && onDeleteRow && (
                <Button variant="ghost" size="sm" className="text-destructive" onClick={() => onDeleteRow(r.lapNumber)}>
                  削除
                </Button>
              )}
            </td>
          )}
        </>
      )}
    </tr>
  );
}

// 差分の色分け: 負（速い）= 緑、正 = 赤
function diffClass(diff: number | null | undefined): string {
  if (diff == null) return '';
  return diff <= 0 ? 'text-emerald-400' : 'text-destructive';
}
