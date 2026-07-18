// DB 切替スクリプト: SQLite ⇔ Neon(PostgreSQL)
// 使い方: npm run db:use:sqlite / npm run db:use:neon
//
// .env の SQLITE_DATABASE_URL / NEON_DATABASE_URL のうち選んだ方を
// DATABASE_URL に書き込み、対応するスキーマで prisma generate を実行する。
// （Prisma は provider を環境変数で切り替えられないため、スキーマ2枚持ち＋再生成方式）

import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(appRoot, ".env");

const target = process.argv[2];
if (target !== "sqlite" && target !== "neon") {
  console.error("使い方: node scripts/use-db.mjs <sqlite|neon>");
  process.exit(1);
}

const env = readFileSync(envPath, "utf8");
const sourceKey = target === "sqlite" ? "SQLITE_DATABASE_URL" : "NEON_DATABASE_URL";
const match = env.match(new RegExp(`^${sourceKey}="(.*)"`, "m"));
if (!match || !match[1]) {
  console.error(`.env に ${sourceKey} が設定されていません。`);
  process.exit(1);
}
const url = match[1];

if (!/^DATABASE_URL=/m.test(env)) {
  console.error(".env に DATABASE_URL の行がありません。");
  process.exit(1);
}
writeFileSync(envPath, env.replace(/^DATABASE_URL=.*$/m, `DATABASE_URL="${url}"`));

const schema =
  target === "sqlite" ? "prisma/schema.prisma" : "prisma/schema.postgres.prisma";
console.log(`DATABASE_URL を ${target} に切り替えました。prisma generate を実行します…`);
const result = spawnSync("npx", ["prisma", "generate", `--schema=${schema}`], {
  cwd: appRoot,
  stdio: "inherit",
  shell: true,
});
process.exit(result.status ?? 1);
