import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../index.js';
import {
  ADMIN_AUTH_COOKIE,
  CSRF_COOKIE,
  adminSessionCookie,
  authenticateApiToken,
  csrfCookie,
  csrfTokenFromCookie,
  expiredCookie,
} from '../middleware/auth.js';
import { resolveAdminAuthConfig } from '../middleware/admin-auth-config.js';

export const adminAuth = new Hono<Env>();

function getLoginToken(c: Context<Env>): string {
  const authHeader = c.req.header('Authorization')?.trim();
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice('Bearer '.length).trim();
  }
  return '';
}

async function handleAdminLogin(c: Context<Env>) {
  const config = resolveAdminAuthConfig(c.env, { requestOrigin: new URL(c.req.url).origin });
  if (config.misconfigured) {
    console.error('[admin-auth] refused login:', config.misconfigured);
    return c.json({ success: false, error: config.misconfigured }, 500);
  }

  const apiKey = getLoginToken(c);
  const staff = await authenticateApiToken(c, apiKey || null);

  if (!staff) {
    return c.json({ success: false, error: 'Unauthorized' });
  }

  const csrfToken = crypto.randomUUID();
  c.header('Set-Cookie', adminSessionCookie(apiKey, config.sameSite), { append: true });
  c.header('Set-Cookie', csrfCookie(csrfToken, config.sameSite), { append: true });
  return c.json({ success: true, data: staff, csrfToken });
}

adminAuth.post('/api/auth/login', handleAdminLogin);
adminAuth.post('/api/admin-auth/login', handleAdminLogin);
adminAuth.post('/api/admin-login', handleAdminLogin);

adminAuth.post('/api/auth/logout', async (c) => {
  const { sameSite } = resolveAdminAuthConfig(c.env, { requestOrigin: new URL(c.req.url).origin });
  c.header('Set-Cookie', expiredCookie(ADMIN_AUTH_COOKIE, sameSite), { append: true });
  c.header('Set-Cookie', expiredCookie(CSRF_COOKIE, sameSite), { append: true });
  return c.json({ success: true, data: null });
});

adminAuth.get('/api/auth/session', async (c) => {
  const config = resolveAdminAuthConfig(c.env, { requestOrigin: new URL(c.req.url).origin });
  let csrfToken = csrfTokenFromCookie(c);
  if (!csrfToken) {
    csrfToken = crypto.randomUUID();
    c.header('Set-Cookie', csrfCookie(csrfToken, config.sameSite), { append: true });
  }
  return c.json({ success: true, data: c.get('staff'), csrfToken });
});
