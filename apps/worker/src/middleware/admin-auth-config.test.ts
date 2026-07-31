import { describe, expect, test } from 'vitest';
import {
  ADMIN_BASE_PATH,
  parseAllowedOrigins,
  resolveAdminAuthConfig,
  resolveAdminBaseUrl,
  resolveCorsOrigin,
} from './admin-auth-config.js';

const WORKER_URL = 'https://line-harness.example.workers.dev';

// Worker 同一オリジン配信 (現行の正) の設定。
const sameOriginEnv = {
  WORKER_URL,
  ADMIN_ORIGIN: `${WORKER_URL}${ADMIN_BASE_PATH}`,
  ADMIN_ALLOW_CROSS_SITE: 'false',
};

// 旧構成: 管理画面を Cloudflare Pages の別オリジンから配信していた頃。
const crossSiteEnv = {
  WORKER_URL,
  ADMIN_ORIGIN: 'https://line-harness-admin.pages.dev',
  ADMIN_ALLOW_CROSS_SITE: 'true',
};

describe('resolveAdminBaseUrl', () => {
  test('ADMIN_ORIGIN の base path を保持する（通知のディープリンク用）', () => {
    expect(resolveAdminBaseUrl(sameOriginEnv)).toBe(`${WORKER_URL}/admin`);
  });

  test('末尾スラッシュを落とす', () => {
    expect(resolveAdminBaseUrl({ ADMIN_ORIGIN: `${WORKER_URL}/admin/` })).toBe(
      `${WORKER_URL}/admin`,
    );
  });

  test('カンマ区切りで複数許可しているときは先頭を正とする', () => {
    expect(
      resolveAdminBaseUrl({
        ADMIN_ORIGIN: `${WORKER_URL}/admin, https://line-harness-admin.pages.dev`,
      }),
    ).toBe(`${WORKER_URL}/admin`);
  });

  test('ADMIN_ORIGIN 未設定なら WORKER_URL + /admin にフォールバックする', () => {
    expect(resolveAdminBaseUrl({ WORKER_URL })).toBe(`${WORKER_URL}/admin`);
  });

  test('どちらも未設定ならリクエスト到達オリジン + /admin', () => {
    // 初回セットアップ直後 (vars 未設定) でも同一オリジンのリンクを出せる。
    expect(resolveAdminBaseUrl({}, { requestOrigin: 'https://fresh.example.workers.dev' })).toBe(
      'https://fresh.example.workers.dev/admin',
    );
  });

  test('手がかりが何も無ければ undefined', () => {
    expect(resolveAdminBaseUrl({})).toBeUndefined();
    expect(resolveAdminBaseUrl({ ADMIN_ORIGIN: '' })).toBeUndefined();
  });
});

describe('parseAllowedOrigins', () => {
  test('base path 付きの ADMIN_ORIGIN でも CORS 許可は origin 単位になる', () => {
    expect(parseAllowedOrigins(sameOriginEnv)).toEqual([WORKER_URL]);
  });
});

describe('resolveAdminAuthConfig（同一オリジン配信）', () => {
  test('SameSite=Lax を発行し、cross-site 判定にならない', () => {
    const config = resolveAdminAuthConfig(sameOriginEnv);
    expect(config.sameSite).toBe('Lax');
    expect(config.crossSite).toBe(false);
    expect(config.secure).toBe(true);
    // Lax なので iOS Safari のサードパーティ Cookie ブロックの影響を受けない。
    expect(config.misconfigured).toBeNull();
  });

  test('別オリジン配信では従来どおり SameSite=None が必要', () => {
    const config = resolveAdminAuthConfig(crossSiteEnv);
    expect(config.sameSite).toBe('None');
    expect(config.crossSite).toBe(true);
    expect(config.misconfigured).toBeNull();
  });

  test('別オリジンなのに cross-site 許可がないと misconfigured を返す', () => {
    const config = resolveAdminAuthConfig({
      ...crossSiteEnv,
      ADMIN_ALLOW_CROSS_SITE: 'false',
    });
    expect(config.sameSite).toBe('Lax');
    expect(config.crossSite).toBe(true);
    expect(config.misconfigured).toContain('cross-site');
  });

  test('WORKER_URL が古くても、実際に到達したオリジンで判定する', () => {
    // WORKER_URL は旧 workers.dev のまま、実アクセスはカスタムドメイン。
    const config = resolveAdminAuthConfig(
      {
        WORKER_URL: 'https://line-harness.example.workers.dev',
        ADMIN_ORIGIN: 'https://crm.example.com/admin',
        ADMIN_ALLOW_CROSS_SITE: 'false',
      },
      { requestOrigin: 'https://crm.example.com' },
    );
    expect(config.crossSite).toBe(false);
    expect(config.sameSite).toBe('Lax');
    expect(config.misconfigured).toBeNull();
  });

  test('ローカル開発 (loopback) では cross-site guard を無効化する', () => {
    // wrangler dev / next dev から本番 ADMIN_ORIGIN 設定のまま叩くケース。
    // ここで guard を効かせるとローカルでログインできなくなる。
    const config = resolveAdminAuthConfig(sameOriginEnv, {
      requestOrigin: 'http://127.0.0.1:8799',
    });
    expect(config.crossSite).toBe(false);
    expect(config.misconfigured).toBeNull();
  });
});

describe('resolveCorsOrigin（同一オリジン配信）', () => {
  test('管理画面と同じ Worker オリジンからのリクエストを許可する', () => {
    expect(
      resolveCorsOrigin(sameOriginEnv, WORKER_URL, `${WORKER_URL}/api/capabilities`),
    ).toBe(WORKER_URL);
  });

  test('無関係なオリジンは許可しない', () => {
    expect(
      resolveCorsOrigin(sameOriginEnv, 'https://evil.example.com', `${WORKER_URL}/api/capabilities`),
    ).toBe('');
  });
});
