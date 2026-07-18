// 路面コンディションと OUT/IN の定数・表示ラベル

export const CONDITIONS = ['D', 'W', 'SC'] as const;
export type Condition = (typeof CONDITIONS)[number] | 'EX1' | 'EX2';

export const CONDITION_LABEL: Record<string, string> = {
  D: 'ドライ',
  W: 'ウェット',
  SC: 'SC',
  EX1: 'EX1',
  EX2: 'EX2',
};

// 各コンディションの表示色（バッジ/チャート用）
export const CONDITION_COLOR: Record<string, string> = {
  D: '#2563eb', // 青
  W: '#0891b2', // シアン
  SC: '#b45309', // 橙（白文字が読めるよう暗め）
  EX1: '#6b7280',
  EX2: '#6b7280',
};

// チャート系列色（dataviz validate_palette.js 検証済み・ダーク面）
// 実績/計画は CVD ΔE 26.7 で全チェック PASS。
// W/SC はステータス扱いのマーカー色（サーフェス色リング＋ツールチップのラベルを必ず併用）
export const CHART_COLORS = {
  actual: '#ef4444', // 実績
  plan: '#3b82f6', // 計画
  wet: '#22d3ee', // ウェット周マーカー
  sc: '#f59e0b', // SC 周マーカー
  reference: '#fbbf24', // 基準線（想定タイム/ガス欠等）
} as const;

export const OUT_IN = ['OUT', 'IN'] as const;
export type OutIn = (typeof OUT_IN)[number];
