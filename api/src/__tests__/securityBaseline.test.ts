// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../app.js';
import { authCookieOptions } from '../middleware/auth.js';
import { mintAuthCookie } from './authHelper.js';

describe('publication security baseline', () => {
  it('sets the expected security headers', async () => {
    const response = await supertest(createApp({ rateLimitMax: 1000 })).get('/healthz');

    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['permissions-policy']).toContain('camera=()');
  });

  it('keeps production session cookies HTTP-only, SameSite, and Secure', () => {
    expect(authCookieOptions({ NODE_ENV: 'production' })).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      path: '/',
    });
    expect(authCookieOptions({ NODE_ENV: 'development' }).secure).toBe(false);
  });

  it('rejects an unapproved browser origin for an authenticated mutation', async () => {
    const app = createApp({ corsOrigins: ['https://app.example.test'], rateLimitMax: 1000 });
    const auth = mintAuthCookie();
    const response = await supertest(app)
      .post('/api/auth/logout')
      .set('Cookie', auth.cookie)
      .set('Origin', 'https://attacker.example.test');

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'ORIGIN_NOT_ALLOWED' });
  });

  it('permits the configured browser origin', async () => {
    const app = createApp({ corsOrigins: ['https://app.example.test'], rateLimitMax: 1000 });
    const auth = mintAuthCookie();
    const response = await supertest(app)
      .post('/api/auth/logout')
      .set('Cookie', auth.cookie)
      .set('Origin', 'https://app.example.test');

    expect(response.status).toBe(200);
  });

  it('defaults to same-origin mutations when no CORS origin is configured', async () => {
    const app = createApp({ rateLimitMax: 1000 });
    const auth = mintAuthCookie();

    const accepted = await supertest(app)
      .post('/api/auth/logout')
      .set('Cookie', auth.cookie)
      .set('Host', 'app.example.test')
      .set('Origin', 'http://app.example.test');
    expect(accepted.status).toBe(200);

    const rejected = await supertest(app)
      .post('/api/auth/logout')
      .set('Cookie', auth.cookie)
      .set('Host', 'app.example.test')
      .set('Origin', 'http://attacker.example.test');
    expect(rejected.status).toBe(403);
  });

  it('requires administrator authorization before bulk case mutations', async () => {
    const app = createApp({ rateLimitMax: 1000 });
    const auth = mintAuthCookie();

    expect((await supertest(app).delete('/api/cases').set('Cookie', auth.cookie)).status).toBe(403);
    expect(
      (await supertest(app).post('/api/cases/clear-all').set('Cookie', auth.cookie)).status,
    ).toBe(403);
  });

  it('classifies malformed and oversized JSON as client errors', async () => {
    const app = createApp({ rateLimitMax: 1000 });

    const malformed = await supertest(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{');
    expect(malformed.status).toBe(400);
    expect(malformed.body.code).toBe('INVALID_JSON');

    const oversized = await supertest(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify('x'.repeat(70 * 1024)));
    expect(oversized.status).toBe(413);
    expect(oversized.body.code).toBe('REQUEST_TOO_LARGE');
  });
});
