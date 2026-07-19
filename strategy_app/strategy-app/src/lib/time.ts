// ラップタイムの秒 <-> 表示文字列 変換ユーティリティ。
// 内部表現は一貫して「秒（Float, 0.001 精度）」で扱い、
// 入力/表示のときだけ M:SS.mmm 形式に変換する。これで 0.001 秒の入力・保持を確実にする。

// 秒 -> "M:SS.mmm"（例: 146.271 -> "2:26.271"）
export function formatLapTime(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null || Number.isNaN(totalSeconds)) return '-';
  const sign = totalSeconds < 0 ? '-' : '';
  const s = Math.abs(totalSeconds);
  const minutes = Math.floor(s / 60);
  const seconds = s - minutes * 60;
  const secStr = seconds.toFixed(3).padStart(6, '0'); // "06.271"
  return `${sign}${minutes}:${secStr}`;
}

// 秒 -> "H時間M分"（時間が 0 なら "M分"）。残り時間・経過時間の表示用。
// 分は切り捨て（残り時間を過大表示しないため）。
export function formatHourMin(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null || Number.isNaN(totalSeconds)) return '-';
  const sign = totalSeconds < 0 ? '−' : '';
  const totalMin = Math.floor(Math.abs(totalSeconds) / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${sign}${h}時間${m}分` : `${sign}${m}分`;
}

// 秒 -> "M:SS"（ミリ秒不要な箇所用。例: 開始までのカウントダウンなど）
export function formatMinSec(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null || Number.isNaN(totalSeconds)) return '-';
  const sign = totalSeconds < 0 ? '-' : '';
  const s = Math.round(Math.abs(totalSeconds));
  const minutes = Math.floor(s / 60);
  const seconds = s % 60;
  return `${sign}${minutes}:${String(seconds).padStart(2, '0')}`;
}

// 分・秒（秒は小数可）-> 秒。Excel の「分」列＋「秒」列の入力に対応。
export function minSecToSeconds(min: number, sec: number): number {
  return (Number(min) || 0) * 60 + (Number(sec) || 0);
}

// 分・整数秒・ミリ秒 -> 秒。ライブ入力の 3 枠（M : SS . mmm）を秒へ合成する。
// ミリ秒は 3 桁の値（例: 271 -> 0.271 秒）として扱う。
export function partsToSeconds(min: number | string, sec: number | string, ms: number | string): number {
  return (Number(min) || 0) * 60 + (Number(sec) || 0) + (Number(ms) || 0) / 1000;
}

// 秒 -> { min, sec, ms }。3 枠へ分解する（ミリ秒は 0..999 の整数）。
export function secondsToParts(totalSeconds: number | null | undefined): { min: number; sec: number; ms: number } {
  const totalMs = Math.round(Math.max(0, Number(totalSeconds) || 0) * 1000);
  return {
    min: Math.floor(totalMs / 60000),
    sec: Math.floor((totalMs % 60000) / 1000),
    ms: totalMs % 1000,
  };
}

// ISO文字列/Date -> <input type="datetime-local"> 用の "YYYY-MM-DDTHH:mm"（ローカル時刻）。
export function toDatetimeLocal(iso: string | Date | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// "2:26.271" / "2:26" / "146.271"（秒のみ）などの文字列 -> 秒。
// 解析できない場合は null。
export function parseLapTime(input: string): number | null {
  if (input == null) return null;
  const str = String(input).trim();
  if (str === '') return null;

  if (str.includes(':')) {
    const [mPart, sPart] = str.split(':');
    const m = Number(mPart);
    const s = Number(sPart);
    if (Number.isNaN(m) || Number.isNaN(s)) return null;
    return m * 60 + s;
  }
  // コロン無しは「秒」とみなす
  const s = Number(str);
  return Number.isNaN(s) ? null : s;
}
