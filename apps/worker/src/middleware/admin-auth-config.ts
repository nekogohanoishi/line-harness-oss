import type { Env } from '../index.js';

export type AdminSameSite = 'Strict' | 'Lax' | 'None';

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

export function resolveAdminAuthConfig(
  env: AdminAuthEnv,
  opts: { requestOrigin?: string } = {},
): AdminAuthConfig {
  const allowedOrigins = parseAllowedOrigins(env);
  const workerOrigin = normalizeOrigin(env.WORKER_URL) ?? normalizeOrigin(opts.requestOrigin);

  const crossSite =
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
      `(${env.WORKER_URL ?? 'unset'}); a SameSite=${sameSite} session cookie will not be ` +
      `sent and login would break. Either serve the admin under a same-site custom domain, ` +
      `or set ADMIN_ALLOW_CROSS_SITE=true (issues SameSite=None; Secure cookies).`;
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
