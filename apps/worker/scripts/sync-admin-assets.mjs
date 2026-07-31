#!/usr/bin/env node
// 管理画面 (apps/web の Next.js static export) を Worker の静的アセット
// ディレクトリへ同期する。
//
// なぜ必要か:
//   管理画面を Cloudflare Pages (別オリジン) から配信していた頃は、Worker の
//   セッション Cookie がサードパーティ Cookie 扱いになり、iOS Safari 等の
//   既定設定でログインが維持できなかった。Worker 自身の /admin/* から配信して
//   同一オリジンにすると SameSite=Lax の Cookie が使えて問題が根絶される。
//
// 配置先:
//   apps/web/out/**  →  apps/worker/dist/client/admin/**
//   `vite build` が dist/client を作り直すので、必ずビルド後に実行すること。
//
// apps/web/out が無い場合は「まだ管理画面をビルドしていない」だけなので、
// 警告を出して正常終了する（`pnpm --filter worker build` 単体を壊さないため）。

import { cp, mkdir, rm, stat, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workerDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(workerDir, '../..');

const SOURCE_DIR = join(repoRoot, 'apps/web/out');
const ASSETS_DIR = join(workerDir, 'dist/client');
// admin-auth-config.ts の ADMIN_BASE_PATH / next.config.ts の basePath と揃える。
const ADMIN_DIR_NAME = 'admin';
const TARGET_DIR = join(ASSETS_DIR, ADMIN_DIR_NAME);

// Cloudflare Pages 専用のメタファイル。Workers Assets ではアセットルートに
// 置かれた場合のみ意味を持つので、admin/ 配下へ持ち込んでも無害だが、
// 混乱を避けるため除外する。
const EXCLUDED_ENTRIES = new Set(['_redirects', '_headers', '_worker.js']);

async function countFiles(dir) {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) total += await countFiles(join(dir, entry.name));
    else total += 1;
  }
  return total;
}

async function main() {
  if (!existsSync(SOURCE_DIR)) {
    console.warn(
      `[sync-admin-assets] ${SOURCE_DIR} が見つかりません。` +
        `管理画面は同梱されません（先に \`pnpm --filter web build\` を実行してください）。`,
    );
    return;
  }

  const sourceStat = await stat(SOURCE_DIR);
  if (!sourceStat.isDirectory()) {
    throw new Error(`[sync-admin-assets] ${SOURCE_DIR} はディレクトリではありません`);
  }

  await mkdir(ASSETS_DIR, { recursive: true });
  // 前回ビルドのハッシュ付きチャンクが残ると容量制限を圧迫するので毎回消す。
  await rm(TARGET_DIR, { recursive: true, force: true });
  await mkdir(TARGET_DIR, { recursive: true });

  for (const entry of await readdir(SOURCE_DIR, { withFileTypes: true })) {
    if (EXCLUDED_ENTRIES.has(entry.name)) continue;
    await cp(join(SOURCE_DIR, entry.name), join(TARGET_DIR, entry.name), {
      recursive: true,
    });
  }

  const fileCount = await countFiles(TARGET_DIR);
  console.log(
    `[sync-admin-assets] ${fileCount} files → dist/client/${ADMIN_DIR_NAME}/ ` +
      `(管理画面URL: <worker>/${ADMIN_DIR_NAME}/)`,
  );
}

main().catch((err) => {
  console.error('[sync-admin-assets] 失敗:', err);
  process.exit(1);
});
