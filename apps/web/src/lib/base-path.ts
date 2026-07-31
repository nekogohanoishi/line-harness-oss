/**
 * 管理画面の base path。
 *
 * 管理画面は Worker と同一オリジンの `/admin` 配下から配信される
 * (next.config.ts の basePath)。next/link・next/navigation は basePath を
 * 自動で付けるが、生の `window.location` 遷移や `<a href="/...">` は付かない。
 * そういう箇所ではこの adminPath() を通すこと。
 */
export const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/+$/, '')

/** 管理画面内のパス (`/login` 等) を basePath 込みの絶対パスへ変換する。 */
export function adminPath(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`
  return `${BASE_PATH}${normalized}`
}
