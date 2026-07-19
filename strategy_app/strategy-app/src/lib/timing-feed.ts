// もて耐 公式計時サーバー（racenow-motegi）のライブ購読ヘルパ（サーバー専用）。
//
// 【重要】計時サーバーは Socket.IO v2.3.0。v4 クライアントは非互換なので
//   socket.io-client@2 を使う（package.json 参照）。
//
// 【仕組み】サーバーは接続直後に「全履歴」を1イベントで送ってくる。
//   よって常時接続は不要 —— リクエストのたびに「接続 → 全取得 → 即切断」で完結する。
//   これにより Vercel などサーバーレス環境でもライブ取得できる。
//
//   一覧/順位: http://<HOST>:7001  emit("init")            → 'tm-init'（全チーム配列）
//   個車ラップ: http://<HOST>:7002  emit("init",{carno})     → 'tm-personal-all'（全ラップ配列）
//
// 【carno の正体】carno には行の TeamNo（＝ゼッケン。例 104）を渡す。r.ID は内部エントリー番号
//   （1..N の連番。例 25）で socket のキーではない。実測: carno=104→ラップ有 / carno=25→0。
//
// 接続先は環境変数で上書き可能（サーキットで IP/ポートが変わった場合に対応）。

import io from 'socket.io-client';

const HOST = process.env.TIMING_HOST || 'http://52.24.223.254';
const LIST_PORT = process.env.TIMING_LIST_PORT || '7001';
const CAR_PORT = process.env.TIMING_CAR_PORT || '7002';

export interface TeamRow {
  carno: string;
  teamName: string;
  className: string;
  pos: number | null;
  lap: number | null;
  driverNameJ: string;
}

export interface ScrapedLap {
  lap: number; // 周番号（そのチームの通算周回）
  lapTimeSec: number; // ラップタイム（秒）= 計時の LastLap
  sec1: number | null;
  sec2: number | null;
  sec3: number | null;
  sec4: number | null;
  maxSpeed: number | null;
  pit: boolean; // 計時の PIT フラグ（この周にピット）
  totalTimeSec: number | null;
}

// 数値化（空文字/変換不能は null）
const toNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
// 0 も「値なし」とみなす（計時は 0 を未計測として空表示する）
const nz = (v: unknown): number | null => {
  const n = toNum(v);
  return n && n !== 0 ? n : null;
};

// 1 回きりの接続で初期スナップショットを1イベントだけ受け取る汎用処理。
function grabOnce<T>(opts: {
  url: string;
  event: string; // 待ち受けるイベント名
  initPayload?: unknown; // emit("init", initPayload)。undefined なら引数なしで emit
  timeoutMs?: number;
}): Promise<T> {
  const { url, event, initPayload, timeoutMs = 7000 } = opts;
  return new Promise<T>((resolve, reject) => {
    // polling を先に確立（素の HTTP でどこからでも通る）→ 可能なら websocket に自動昇格。
    const socket = io(url, {
      reconnection: false,
      forceNew: true,
      transports: ['polling', 'websocket'],
      timeout: 6000,
    });

    let settled = false;
    const finish = (err: Error | null, data?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        /* noop */
      }
      if (err) reject(err);
      else resolve(data as T);
    };

    const timer = setTimeout(
      () => finish(new Error(`計時サーバー応答タイムアウト（${event}）`)),
      timeoutMs,
    );

    socket.on('connect', () => {
      if (initPayload === undefined) socket.emit('init');
      else socket.emit('init', initPayload);
    });
    socket.on(event, (msg: T) => finish(null, msg));
    socket.on('connect_error', (e: unknown) =>
      finish(e instanceof Error ? e : new Error(`計時サーバーへ接続できません: ${String(e)}`)),
    );
    socket.on('connect_timeout', () => finish(new Error('計時サーバー接続タイムアウト')));
    socket.on('error', (e: unknown) =>
      finish(e instanceof Error ? e : new Error(String((e as { message?: string })?.message ?? 'socket error'))),
    );
  });
}

// 全チーム一覧（順位付き）。取込UIの車番セレクタ用。
export async function fetchTeams(): Promise<TeamRow[]> {
  const raw = await grabOnce<Record<string, unknown>[]>({
    url: `${HOST}:${LIST_PORT}`,
    event: 'tm-init',
  });
  const arr = Array.isArray(raw) ? raw : [];
  return arr
    .map((r) => ({
      carno: String(r.TeamNo ?? r.ID ?? '').trim(), // TeamNo=ゼッケン。個車socketのキーはこれ（内部ID=r.IDではない）
      teamName: String(r.TeamName ?? '').trim(),
      className: String(r.ClassName ?? '').trim(),
      pos: nz(r.Pos),
      lap: nz(r.Lap),
      driverNameJ: String(r.DriverNameJ ?? '').trim(),
    }))
    .filter((t) => t.carno)
    .sort((a, b) => (a.pos ?? 9999) - (b.pos ?? 9999));
}

// 順位表の 1 行（ダッシュボードの自チーム順位パネル用）。
export interface StandingRow {
  pos: number | null; // 総合順位
  classPos: number | null; // クラス内順位
  carno: string; // ゼッケンNo（＝計時の ID）
  teamName: string;
  className: string;
  lap: number | null;
  gap: string; // 直上（ひとつ前の順位）との差。同一周なら秒(例 "2.967")、周回遅れは "1 LAP"、首位は ""
  classGap: string; // クラス内で直上との差
  totalTimeSec: number | null;
}

// 全チームの順位表（順位付き・差つき）。ダッシュボード表示用。
export async function fetchStandings(): Promise<StandingRow[]> {
  const raw = await grabOnce<Record<string, unknown>[]>({
    url: `${HOST}:${LIST_PORT}`,
    event: 'tm-init',
  });
  const arr = Array.isArray(raw) ? raw : [];
  return arr
    .map((r) => ({
      pos: nz(r.Pos),
      classPos: nz(r.ClassPos) ?? nz(r.ClassPosition),
      carno: String(r.TeamNo ?? r.ID ?? '').trim(), // TeamNo=ゼッケン。個車socketのキーはこれ（内部ID=r.IDではない）
      teamName: String(r.TeamName ?? '').trim(),
      className: String(r.ClassName ?? '').trim(),
      lap: nz(r.Lap),
      gap: String(r.Gap ?? '').trim(),
      classGap: String(r.ClassGap ?? '').trim(),
      totalTimeSec: toNum(r.TotalTime),
    }))
    .filter((t) => t.carno)
    .sort((a, b) => (a.pos ?? 9999) - (b.pos ?? 9999));
}

// 指定車番の全ラップ（昇順）。
export async function fetchCarLaps(carno: string): Promise<ScrapedLap[]> {
  const raw = await grabOnce<Record<string, unknown> | Record<string, unknown>[]>({
    url: `${HOST}:${CAR_PORT}`,
    event: 'tm-personal-all',
    initPayload: { carno: String(carno) },
  });
  const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return arr
    .map((r) => ({
      lap: Number(r.Lap),
      lapTimeSec: Number(r.LastLap),
      sec1: nz(r.Sec1Time),
      sec2: nz(r.Sec2Time),
      sec3: nz(r.Sec3Time),
      sec4: nz(r.Sec4Time),
      maxSpeed: nz(r.MaxSpeed),
      pit: Number(r.PIT) === 1,
      totalTimeSec: nz(r.TotalTime),
    }))
    .filter((l) => Number.isFinite(l.lap) && l.lap > 0)
    .sort((a, b) => a.lap - b.lap);
}
