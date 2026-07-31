import type { Env } from '../index.js';

export type AdminSameSite = 'Strict' | 'Lax' | 'None';

/**
 * Worker と同一オリジンで管理画面を配信するときの base path。
 *
 * 別オリジン (Cloudflare Pages) 配信ではサードパーティ Cookie 扱いになり、
 * iOS Safari 等がセッション Cookie を落としてログインが維持できなかった。
 * Worker 自身の `/admin/*` から配信することで SameSite=Lax が使える。
 *
 * 変更する場合は次の3箇所を必ず揃えること:
 *   - apps/web/next.config.ts の basePath
 *   - apps/worker/scripts/sync-admin-assets.mjs の同期先ディレクトリ
 *   - wrangler.toml の ADMIN_ORIGIN の末尾パス
 */
export const ADMIN_BASE_PATH = '/admin';

export interface AdminAuthConfig {
  allowedOrigins: string[];
  sameSite: AdminSameSite;
  secure: boolean;
  crossSite: boolean;
  misconfigured: string | null;
}

export type AdminAuthEnv = {
  WORKER_URL?: string;
  ADMIN_ORIGIN?: string;
  ADMIN_COOKIE_SAMESITE?: string;
  ADMIN_ALLOW_CROSS_SITE?: string;
};

const MULTI_TENANT_SUFFIXES = [
  'pages.dev',
  'workers.dev',
  'github.io',
  'vercel.app',
  'netlify.app',
];

export function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export function isLoopbackOrigin(value: string | undefined | null): boolean {
  if (!value) return false;
  try {
    const host = new URL(value).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
  } catch {
    return false;
  }
}

export function normalizeOrigin(value: string | undefined | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function registrableDomain(host: string): string {
  const labels = host.toLowerCase().split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  for (const suffix of MULTI_TENANT_SUFFIXES) {
    const suffixLabels = suffix.split('.');
    if (labels.slice(-suffixLabels.length).join('.') === suffix) {
      return labels.slice(-(suffixLabels.length + 1)).join('.');
    }
  }
  return labels.slice(-2).join('.');
}

export function isCrossSite(originA: string, originB: string): boolean {
  try {
    const a = new URL(originA);
    const b = new URL(originB);
    return registrableDomain(a.hostname) !== registrableDomain(b.hostname);
  } catch {
    return true;
  }
}

function parseSameSite(value: string | undefined): AdminSameSite | null {
  if (!value) return null;
  switch (value.trim().toLowerCase()) {
    case 'strict':
      return 'Strict';
    case 'lax':
      return 'Lax';
    case 'none':
      return 'None';
    default:
      return null;
  }
}

export function parseAllowedOrigins(env: AdminAuthEnv): string[] {
  if (!env.ADMIN_ORIGIN) return [];
  return env.ADMIN_ORIGIN.split(',')
    .map((value) => normalizeOrigin(value.trim()))
    .filter((value): value is string => Boolean(value));
}

/**
 * 管理画面のベースURL (origin + base path)。LINE 通知内のディープリンク用。
 *
 * 解決順:
 *   1. ADMIN_ORIGIN — パス付きの値を許容する。Worker 同一オリジン配信では
 *      `https://xxx.workers.dev/admin` のように base path まで含める。
 *      CORS / Cookie 判定は normalizeOrigin() で origin だけを取り出すので、
 *      パス部分はディープリンク生成にしか影響しない。
 *      カンマ区切りで複数許可している場合は先頭を「正」とみなす。
 *   2. WORKER_URL + /admin
 *   3. リクエストが到達したオリジン + /admin
 *
 * 2・3 があるおかげで、初回セットアップ時に Worker URL が未確定でも
 * (ADMIN_ORIGIN を設定しなくても) 同一オリジン配信のリンクが正しく出る。
 */
export function resolveAdminBaseUrl(
  env: AdminAuthEnv,
  opts: { requestOrigin?: string } = {},
): string | undefined {
  const explicit = env.ADMIN_ORIGIN?.split(',')[0]?.trim();
  if (explicit) {
    const normalized = stripTrailingSlash(explicit);
    if (normalized) return normalized;
  }
  const fallbackOrigin = normalizeOrigin(env.WORKER_URL) ?? normalizeOrigin(opts.requestOrigin);
  if (!fallbackOrigin) return undefined;
  return `${fallbackOrigin}${ADMIN_BASE_PATH}`;
}

export function resolveAdminAuthConfig(
  env: AdminAuthEnv,
  opts: { requestOrigin?: string } = {},
): AdminAuthConfig {
  const allowedOrigins = parseAllowedOrigins(env);

  // Cookie が実際に送られるかどうかを決めるのは「そのリクエストが到達した
  // オリジン」なので、判定にはまず requestOrigin を使う。WORKER_URL は
  // requestOrigin が無い場合のフォールバック。
  // (WORKER_URL が古いカスタムドメインのまま放置されていても、実際の
  //  アクセス先で正しく判定できるようにするため)
  const requestOrigin = normalizeOrigin(opts.requestOrigin);
  const workerOrigin = requestOrigin ?? normalizeOrigin(env.WORKER_URL);

  // ローカル開発 (wrangler dev / next dev) は本番の ADMIN_ORIGIN に対して
  // 必ず cross-site になるが、実運用の Cookie 挙動とは無関係なので
  // guard を無効化する。これがないとローカルでログインできない。
  const loopback = isLoopbackOrigin(opts.requestOrigin);

  const crossSite =
    !loopback &&
    allowedOrigins.length > 0 &&
    workerOrigin != null &&
    allowedOrigins.some((origin) => isCrossSite(origin, workerOrigin));

  const explicit = parseSameSite(env.ADMIN_COOKIE_SAMESITE);
  const allowCrossSite = env.ADMIN_ALLOW_CROSS_SITE === 'true';
  const sameSite: AdminSameSite = explicit ?? (allowCrossSite ? 'None' : 'Lax');

  let misconfigured: string | null = null;
  if (crossSite && sameSite !== 'None') {
    misconfigured =
      `Admin origin (${allowedOrigins.join(', ')}) is cross-site to the Worker API ` +
      `(${workerOrigin ?? env.WORKER_URL ?? 'unset'}); a SameSite=${sameSite} session cookie ` +
      `will not be sent and login would break. Either serve the admin from the Worker itself ` +
      `(${ADMIN_BASE_PATH} 配下), or set ADMIN_ALLOW_CROSS_SITE=true ` +
      `(issues SameSite=None; Secure cookies).`;
  } else if (sameSite === 'None' && allowedOrigins.length === 0) {
    misconfigured =
      `SameSite=None admin cookies require an explicit ADMIN_ORIGIN allowlist for ` +
      `credentialed CORS, but ADMIN_ORIGIN is unset.`;
  }

  return { allowedOrigins, sameSite, secure: true, crossSite, misconfigured };
}

export function resolveCorsOrigin(
  env: Env['Bindings'] | AdminAuthEnv,
  origin: string | null | undefined,
  requestUrl: string,
): string {
  let requestOrigin = '';
  try {
    requestOrigin = new URL(requestUrl).origin;
  } catch {
    requestOrigin = '';
  }
  if (!origin) return requestOrigin;

  if (isLoopbackOrigin(requestOrigin) && isLoopbackOrigin(origin)) {
    return origin;
  }

  const { allowedOrigins } = resolveAdminAuthConfig(env);
  const allowed = new Set(
    [...allowedOrigins, requestOrigin].filter(Boolean).map(stripTrailingSlash),
  );
  return allowed.has(stripTrailingSlash(origin)) ? origin : '';
}
