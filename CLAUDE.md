# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## リポジトリ概要

バイク耐久レース（ツインリンクもてぎ / もて耐）向けのレース支援ツール集。UI・コメントはすべて日本語。

**メインの開発対象は `new_dashboard_app/race_dashboard_app`（レースダッシュボード）。** それ以外のディレクトリは過去の試作やデータ置き場が多い:

- `new_dashboard_app/race_dashboard_app` — **現行のダッシュボード（Next.js）。開発の中心。**
- `time_scraping/` — 公式計時サイト（racenow-motegi-1.racelive.jp）から Selenium でラップデータをスクレイピングし DB に保存する Python 群。ダッシュボードのデータ供給元。`LapRecordAllPara.py` が複数チーム並列取得版。
- `strategy_app/` — 耐久レース戦略アプリ（Next.js、別 Prisma スキーマ: riders / fuel_types / segments / actual_laps / race_configs）。要件は `strategy_app/要件定義/要件定義全体.md` を参照。
- `race-dashboard-project/` — 旧 Flask 版ダッシュボード（レガシー）。
- `setting_managiment/` — 旧 Next.js アプリ（レガシー）。
- `dashboard/`, `lap管理/`, `イベント/` — データ・記録置き場（コードなし）。
- ルートの `README.md` はコードの説明ではなく、出走前チェックリスト等のレース運用メモ。

## 開発サーバー運用ルール（重要・複数エージェント並行対策）

このリポジトリは **Claude Code（CLAUDE.md）と Codex（AGENTS.md）が並行で作業する**ことがある。各自が Next.js の dev サーバーを乱立させると、同じ `.next` ディレクトリを奪い合って **「起動済みなのにビルドが壊れる」障害が多発**する（`_buildManifest.js.tmp` の ENOENT、`Next.js package not found`、`Cannot find module './xxx.js'`、チャンク欠落など）。対象は `strategy_app/strategy-app` や `new_dashboard_app/race_dashboard_app` などの Next.js アプリ。以下を厳守する。

1. **ポートは 3000 固定・1プロセスのみ。`http://localhost:3000` を常に正とする。**
2. **起動前に必ず既存を確認し、動いていれば再利用する（新規に立てない）**：
   ```bash
   curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/live   # 200 なら起動済み → それを使う
   ```
   200 が返るなら新たに `npm run dev` しない。ソースはホットリロードされるので既存サーバーに反映される。
3. **同一プロジェクトで 2 つ以上の `next dev` を絶対に動かさない。** サーバーが 3001 / 3002 に逃げたら「既に 3000 で起動済み」の危険信号 → 逃げたプロセスは止めて 3000 の既存を使う。
4. 新規に立てる場合はポートを明示する：`npm run dev -- -p 3000`
5. **`npx next ...` を使わない。** node_modules と別バージョンの Next を引いて `.next` を壊す（実際に 15.3.2 ↔ 15.5.20 の齟齬でビルド破損が起きた）。必ず `npm run dev`（ローカルの next）を使う。
6. **壊れた時の復旧**：全 dev サーバーを停止 → `.next` を削除 → 1 つだけ起動し直す。
   ```bash
   rm -rf strategy_app/strategy-app/.next   # 対象アプリの .next
   ```
7. **確認・停止（Windows / PowerShell）**：
   ```powershell
   Get-NetTCPConnection -LocalPort 3000 -State Listen | Select-Object OwningProcess          # 3000 の使用プロセス
   Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ? { $_.CommandLine -like '*next*dev*' } | Select ProcessId, CommandLine   # next dev 一覧
   Stop-Process -Id <PID> -Force
   ```
8. 作業終了時も **dev サーバーは 3000 に 1 つだけ残す**（自分が余分に立てたものは止める）。

> ※ このルールは AGENTS.md にも同じ内容を記載している。両エージェントで足並みを揃えること。

## コマンド（race_dashboard_app）

すべて `new_dashboard_app/race_dashboard_app/` で実行する:

```bash
npm run dev      # 開発サーバー (Turbopack, http://localhost:3000)
npm run build    # 本番ビルド
npm run lint     # ESLint (eslint-config-next)
npx prisma generate   # スキーマ変更後にクライアント再生成
npx tsx src/scripts/test-db-connection.ts   # DB 接続確認
npx tsx src/scripts/fetch-laps.ts           # laps テーブルのデータ確認
```

テストは存在しない（テストフレームワーク未導入）。

## race_dashboard_app のアーキテクチャ

Next.js 15 (App Router) + React 19 + Tailwind CSS 4 + Prisma 6 (MySQL) + Chart.js (react-chartjs-2)。

データフロー:

```
公式計時サイト → time_scraping/*.py (Selenium) → MySQL laps テーブル
  → API Routes (src/app/api/*) → クライアントコンポーネントがポーリング → 表示
```

- `src/app/page.tsx` — ダッシュボード本体（クライアントコンポーネント）。`/api/current-rankings` と `/api/best-lap-times` を **10秒ごと** にポーリング。
- `src/components/LapTimeChart.tsx` — Chart.js の折れ線グラフ。`/api/lap-times` を **30秒ごと** にポーリング。SSR 不可のため `page.tsx` から `dynamic(..., { ssr: false })` で読み込む。
- `src/app/api/*/route.ts` — 3 本の GET API。いずれも `prisma.$queryRaw` の生 SQL を使う（下記のデータモデル上の理由による）。

### データモデルの注意点（重要）

`laps` テーブル（`prisma/schema.prisma` の `Lap` モデル）は **全カラムが String**（スクレイピング由来のため）。主キーは `@@id([lap, name])` の複合キー。そのため:

- 数値順ソートは SQL 側で `CAST(lap AS UNSIGNED)` / `CAST(rank AS UNSIGNED)` が必要。Prisma の `orderBy` では文字列順になってしまうので、集計系クエリは `$queryRaw` を使うのが既存パターン。
- `record` は `"2:31.025"` 形式の文字列。秒数への変換ロジックは `api/lap-times/route.ts` にある（分:秒.ミリ秒 → 秒）。

### Prisma の特殊構成

- Prisma Client は **`src/generated/prisma` に出力**される設定（`node_modules/@prisma/client` ではない）。生成物はコミット済み。インポートは `@/generated/prisma` から行う。
- **`src/lib/prisma.ts` がリポジトリに存在しない**が、全 API ルートとスクリプトが `@/lib/prisma` から `prisma` シングルトンをインポートしている。クローン直後はビルドが通らないため、`@/generated/prisma` の `PrismaClient` をエクスポートするシングルトンを `src/lib/prisma.ts` に作成する必要がある。
- DB 接続は環境変数 `DATABASE_URL`（MySQL）。`.env*` は gitignore 済みなので各自用意する。

## time_scraping（データ収集）

- Selenium + Chrome。計時サイトのページ内 JS 変数（`monitorList` 等）を `execute_script` で読んで各チームの gap ページ URL を組み立て、テーブルをスクレイピングする。
- `save_data_to_DB.py` は Excel (`gap.xlsx`) 経由で DB へ保存する旧フロー（接続先は Supabase/PostgreSQL と、ダッシュボードの MySQL とは別）。
