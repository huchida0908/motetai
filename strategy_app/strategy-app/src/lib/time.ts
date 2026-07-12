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

// 秒 -> "M:SS"（ミリ秒不要な箇所用。例: 残り時間など）
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
