import * as p from "@clack/prompts";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { execa } from "execa";

interface BuildAdminOptions {
  repoDir: string;
}

/**
 * 管理画面 (apps/web) を「Worker と同一オリジン配信」向けにビルドする。
 *
 * 以前は Cloudflare Pages へ別オリジンでデプロイしていたが、Worker の
 * セッション Cookie がサードパーティ Cookie 扱いになり、iOS Safari 等の
 * 既定設定でログインが維持できなかった。現在は Worker の /admin 配下から
 * 配信するので、ここでは静的エクスポートを作るだけでよい。
 * dist/client/admin への配置は Worker ビルド
 * (apps/worker/scripts/sync-admin-assets.mjs) が行う。
 *
 * NEXT_PUBLIC_API_URL は空のままにする。空 = API を相対パスで叩く、つまり
 * 同一オリジン。Worker URL を知らなくてもビルドできるので、初回セットアップで
 * Worker デプロイ前にビルドしても問題ない。
 */
export async function buildAdmin(options: BuildAdminOptions): Promise<void> {
  const webDir = join(options.repoDir, "apps/web");

  const buildSpinner = p.spinner();
  buildSpinner.start("管理画面ビルド中...");

  const envContent = [
    "# 管理画面は Worker と同一オリジン (<worker>/admin) から配信されるため、",
    "# API は相対パスで叩く。ここを空にしておくのが同一オリジン運用の正。",
    "# 別オリジン運用に戻すときだけ NEXT_PUBLIC_API_URL に絶対URLを設定し、",
    "# Worker 側で ADMIN_ORIGIN の許可と ADMIN_ALLOW_CROSS_SITE=true を行う。",
    "",
  ].join("\n");
  writeFileSync(join(webDir, ".env.production"), envContent);

  try {
    await execa("pnpm", ["run", "build"], { cwd: webDir });
  } catch (error: any) {
    buildSpinner.stop("管理画面ビルド失敗");
    throw new Error(`管理画面のビルドに失敗しました: ${error.message}`);
  }
  buildSpinner.stop("管理画面ビルド完了");
}

/** 管理画面の公開URL。Worker と同一オリジンの /admin 配下。 */
export function adminUrlFor(workerUrl: string): string {
  return `${workerUrl.replace(/\/+$/, "")}/admin`;
}
