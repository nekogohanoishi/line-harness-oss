import * as p from "@clack/prompts";
import pc from "picocolors";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureAuth } from "../steps/auth.js";
import { wrangler } from "../lib/wrangler.js";
import { execa } from "execa";

interface SetupState {
  projectName?: string;
  workerName?: string;
  adminUrl?: string;
  accountId?: string;
  d1DatabaseId?: string;
  d1DatabaseName?: string;
  [key: string]: unknown;
}

function loadState(repoDir: string): SetupState | null {
  // setup.ts writes to `.line-harness-setup.json`. The earlier file name
  // (`.line-harness-config.json`) was a pre-rename leftover that caused the
  // update command to never find prior state and always re-prompt — leading
  // users to type the wrong name and target a non-existent Worker. Try the
  // canonical name first, then fall back for legacy installs.
  const candidates = [".line-harness-setup.json", ".line-harness-config.json"];
  for (const name of candidates) {
    const path = join(repoDir, name);
    if (!existsSync(path)) continue;
    try {
      return JSON.parse(readFileSync(path, "utf-8"));
    } catch {
      // corrupt file — try next candidate
    }
  }
  return null;
}

/**
 * The OSS wrangler.toml ships with placeholders (`YOUR_DEV_ACCOUNT_ID` /
 * `YOUR_DEV_D1_DATABASE_ID`) so it never leaks the upstream maintainer's IDs
 * into git history. setup.ts patches them in-place before `wrangler deploy`
 * and restores afterwards. The update flow must do the same — otherwise
 * `wrangler deploy` reads the placeholder verbatim and Cloudflare returns
 * `Could not route to /accounts/YOUR_DEV_ACCOUNT_ID/...`.
 *
 * Returns the original content so the caller can restore via
 * `restoreWranglerToml()` in a finally block.
 */
function patchWranglerToml(
  repoDir: string,
  accountId: string,
  databaseId?: string,
): string | null {
  const tomlPath = join(repoDir, "apps/worker/wrangler.toml");
  if (!existsSync(tomlPath)) return null;
  const original = readFileSync(tomlPath, "utf-8");
  let content = original.replace(
    /account_id\s*=\s*"[^"]*"/g,
    `account_id = "${accountId}"`,
  );
  if (databaseId) {
    content = content.replace(
      /database_id\s*=\s*"[^"]*"/g,
      `database_id = "${databaseId}"`,
    );
  }
  writeFileSync(tomlPath, content);
  return original;
}

function restoreWranglerToml(repoDir: string, original: string | null): void {
  if (original === null) return;
  const tomlPath = join(repoDir, "apps/worker/wrangler.toml");
  try {
    writeFileSync(tomlPath, original);
  } catch {
    // Best effort — user can `git -C ~/.line-harness checkout apps/worker/wrangler.toml`.
  }
}

export async function runUpdate(repoDir: string): Promise<void> {
  p.intro(pc.bgCyan(pc.black(" LINE Harness アップデート ")));

  // Load saved config or ask for project name
  const savedState = loadState(repoDir);
  let projectName: string;

  if (savedState?.projectName) {
    projectName = savedState.projectName;
    p.log.success(`プロジェクト名: ${projectName}`);
  } else {
    const name = await p.text({
      message: "プロジェクト名（setup 時に指定した名前）",
      placeholder: "line-harness",
      defaultValue: "line-harness",
    });
    if (p.isCancel(name)) {
      p.cancel("アップデートをキャンセルしました");
      process.exit(0);
    }
    projectName = (name as string).trim() || "line-harness";
  }

  // Migration apply uses the D1 binding (DB name); fall back to project name.
  const dbName = savedState?.d1DatabaseName ?? projectName;

  await ensureAuth();

  // Patch wrangler.toml with the saved account_id / database_id so `wrangler
  // deploy` routes to the right Cloudflare account. Restored in finally below.
  let originalToml: string | null = null;
  if (savedState?.accountId) {
    originalToml = patchWranglerToml(
      repoDir,
      savedState.accountId,
      savedState.d1DatabaseId,
    );
  } else {
    p.log.warn(
      "状態ファイルに accountId が無いため wrangler.toml を patch しません。" +
        "デプロイが routing エラーになった場合は、apps/worker/wrangler.toml の" +
        "`account_id` を手動で実 ID に書き換えるか、再度 setup を実行してください。",
    );
  }

  const s = p.spinner();

  try {
    // Run pending migrations
    s.start("マイグレーション確認中...");
    try {
      await wrangler(
        ["d1", "migrations", "apply", dbName, "--remote"],
        { cwd: join(repoDir, "packages/db") },
      );
      s.stop("マイグレーション完了");
    } catch {
      s.stop("マイグレーション完了（変更なし）");
    }

    // Redeploy Worker.
    //
    // `wrangler deploy` reads `dist/line_harness/wrangler.json` (vite build
    // 成果物) preferentially over the source `wrangler.toml`. If we patch
    // `wrangler.toml` but skip the vite build, wrangler will pick up the
    // STALE dist json (still containing `YOUR_DEV_ACCOUNT_ID`) and the deploy
    // fails routing. So we run the build step first, mirroring the
    // `vite build && wrangler deploy` pattern in apps/worker/package.json.
    s.start("Worker 再ビルド中...");
    const workerDir = join(repoDir, "apps/worker");
    await execa("pnpm", ["run", "build"], { cwd: workerDir });
    s.stop("Worker 再ビルド完了");

    s.start("Worker 再デプロイ中...");
    await wrangler(["deploy", "--name", projectName], { cwd: workerDir });
    s.stop("Worker 再デプロイ完了");

    // Rebuild and redeploy Admin UI
    const adminProjectName = savedState?.adminUrl
      ? new URL(savedState.adminUrl as string).hostname.replace(".pages.dev", "")
      : `${projectName}-admin`;
    s.start("Admin UI 再デプロイ中...");
    const webDir = join(repoDir, "apps/web");
    await execa("pnpm", ["run", "build"], { cwd: webDir });
    await wrangler(
      ["pages", "deploy", "out", "--project-name", adminProjectName],
      { cwd: webDir },
    );
    s.stop("Admin UI 再デプロイ完了");

    p.outro(pc.green("アップデート完了！"));
  } finally {
    restoreWranglerToml(repoDir, originalToml);
  }
}
