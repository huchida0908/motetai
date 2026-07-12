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
  SC: '#f59e0b', // 橙
  EX1: '#6b7280',
  EX2: '#6b7280',
};

export const OUT_IN = ['OUT', 'IN'] as const;
export type OutIn = (typeof OUT_IN)[number];
