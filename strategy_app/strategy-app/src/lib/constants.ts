// 路面コンディションと OUT/IN の定数・表示ラベル

// ライダー交代規定: 1人あたりの最大連続走行時間（分）。これを超える前に交代が必要。
export const RIDER_MAX_STINT_MIN = 60;

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

// 競合分析（複数車比較）の車ごとカテゴリ色。
// dataviz の検証済みダーク 8 色（validate_palette.js をアプリのダーク面 #0b0e14 で全チェック PASS）。
// 「車＝エンティティ」に固定順で割り当て、順位で塗り替えないこと（色の同一性を保つ）。
export const CAR_PALETTE = [
  '#3987e5', // 青
  '#008300', // 緑
  '#d55181', // マゼンタ
  '#c98500', // 黄
  '#199e70', // アクア
  '#d95926', // オレンジ
  '#9085e9', // バイオレット
  '#e66767', // 赤
] as const;
