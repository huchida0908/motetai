# もて耐 レース戦略アプリ（strategy-app）

バイク耐久レース（ツインリンクもてぎ / もて耐）向けの戦略支援ツール。
`lap管理` の Excel が担っていた **ラップ記録・燃料計算・ピット/スティント管理** をアプリ化する。

## セットアップ

```bash
npm install
npx prisma generate          # Prisma クライアント生成（src/generated/prisma へ出力）
npx prisma db push           # SQLite の dev.db を作成しスキーマを反映
npx tsx prisma/seed.ts       # 初期データ（もて耐設定・ドライバー4名・スティント1）
npm run dev                  # http://localhost:3000
```

- **DB は SQLite（`prisma/dev.db`）**。サーキットの回線不安定を考慮し、ローカルで完結・オフライン動作させるため。
  戦略 PC でアプリを起動し、スマホは同一 LAN/ホットスポットで `http://<PCのIP>:3000` に接続する運用を想定。
  MySQL 等へ移す場合は `.env` の `DATABASE_URL` と `prisma/schema.prisma` の `datasource.provider` を変更する。
- `.env` と `src/generated/prisma`、`prisma/dev.db` は Git 管理外。
- 検証データのクリア: `npx tsx prisma/reset-laps.ts`（ラップ削除・スティント1本・レース未開始に戻す）

## Phase 1 で実装済みの機能

- **ライブ入力 `/live`**: ラップタイムを「分＋秒（0.001 秒精度）」で入力。路面（ドライ/ウェット/SC）・OUT/IN・走者を指定して記録。直前周コピー / 直前取消。
- **燃料計算**: 路面別レートから 1 周ごとの使用量・残燃料・**可能Lap数**（あと何周走れるか）を自動算出。ピットで新スティントを開始すると給油量にリセット。
- **ライブタイル**: 残燃料 / 可能Lap数 / 現スティント周回 / 通算周回 / 直近3周平均 / 残り時間。
- **ダッシュボード `/`**: 現在状況サマリ（実データ）。
- **設定 `/settings`**: レース設定（時間・コース長・タンク・燃費レート・想定タイム）とドライバー管理。

## 主要ファイル

- `prisma/schema.prisma` — データモデル（RaceConfig / Stint / ActualLap / Rider ほか）
- `src/lib/race-calc.ts` — 燃料・ペース計算（DB 非依存の純関数）
- `src/lib/live.ts` — ライブ状態の組み立て（サーバー）
- `src/lib/time.ts` — ラップタイムの秒 ⇄ M:SS.mmm 変換
- `src/app/live/` — ライブ入力画面 / `src/app/api/` — API ルート群

## 今後（Phase 2 以降の想定）

- レースクロックの本格化（着地周回予測・残ピット回数）、計画 vs 実績チャート
- スティント/ピット計画（ガント）、ライダー交代
- 他チーム順位モニタ（`race_dashboard_app` のスクレイピング統合）、CSV/PDF エクスポート
