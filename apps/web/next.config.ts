import type { NextConfig } from 'next'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf-8'))

// 管理画面は Worker と同一オリジンの /admin 配下から配信する。
// 別オリジン (Cloudflare Pages) 配信ではセッション Cookie がサードパーティ
// Cookie 扱いになり、iOS Safari 等の既定設定でログインが維持できなかった。
//
// 変更する場合は apps/worker/src/middleware/admin-auth-config.ts の
// ADMIN_BASE_PATH、sync-admin-assets.mjs の同期先、wrangler.toml の
// ADMIN_ORIGIN 末尾パスも揃えること。
// ルート ("/") 直下に戻したい場合は NEXT_PUBLIC_BASE_PATH="" を指定する。
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '/admin'

const nextConfig: NextConfig = {
  output: 'export',
  basePath,
  transpilePackages: ['@line-crm/shared'],
  typescript: {
    ignoreBuildErrors: true,
  },
  env: {
    APP_VERSION: pkg.version,
    // クライアント側で basePath を参照するため (raw <a> / window.location 用)。
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
}
export default nextConfig
