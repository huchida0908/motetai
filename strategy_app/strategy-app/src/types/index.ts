// ライダー関連の型定義
export interface Rider {
  id: string;
  name: string;
  expectedLapTime: number; // 秒
  defaultFuelRate?: number; // L/周
  createdAt: Date;
  updatedAt: Date;
}

// 燃料タイプ関連の型定義
export interface FuelType {
  id: string;
  name: string;
  fuelRate: number; // L/周
  createdAt: Date;
  updatedAt: Date;
}

// 区間関連の型定義
export interface Segment {
  id: string;
  startLap: number;
  endLap: number;
  riderId: string;
  fuelTypeId: string;
  isPitStop: boolean;
  targetLapTime?: number; // 秒
  createdAt: Date;
  updatedAt: Date;
  rider?: Rider;
  fuelType?: FuelType;
}

// 実績ラップ関連の型定義
export interface ActualLap {
  id: string;
  lapNumber: number;
  lapTime: number; // 秒
  riderId?: string;
  timestamp: Date;
  createdAt: Date;
  rider?: Rider;
}

// レース設定関連の型定義
export interface RaceConfig {
  id: string;
  raceName: string;
  totalLaps: number;
  tankCapacity: number; // L
  initialFuel: number; // L
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// フォーム用の型定義
export interface RiderFormData {
  name: string;
  expectedLapTime: number;
  defaultFuelRate?: number;
}

export interface FuelTypeFormData {
  name: string;
  fuelRate: number;
}

export interface SegmentFormData {
  startLap: number;
  endLap: number;
  riderId: string;
  fuelTypeId: string;
  isPitStop: boolean;
  targetLapTime?: number;
}

export interface RaceConfigFormData {
  raceName: string;
  totalLaps: number;
  tankCapacity: number;
  initialFuel: number;
}

// ダッシュボード用の計算結果型
export interface FuelCalculation {
  currentFuel: number; // 現在の燃料残量
  remainingLaps: number; // 残り可能周回数
  nextPitLap: number; // 次のピットイン予定周
  nextPitETA: Date; // 次のピットイン予定時刻
}

export interface LapComparison {
  lapNumber: number;
  plannedTime: number;
  actualTime?: number;
  difference?: number;
}

// WebSocket関連の型定義
export interface SocketEvents {
  'lap-update': (data: ActualLap) => void;
  'race-status': (data: { currentLap: number; isActive: boolean }) => void;
}

// API レスポンス型
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
} 