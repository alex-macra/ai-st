// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../app.js';

/**
 * A mutating route that exists on every deployment and needs no fixture. It
 * answers 404 once the request has cleared the origin and access-token guards,
 * which is exactly what these tests need to distinguish "blocked" from
 * "allowed through".
 */
const MUTATION = '/api/cases/does-not-exist/analyze';

afterEach(() => {
  delete process.env['SOMNOSCRIBE_ACCESS_TOKEN'];
});

describe('publication security baseline', () => {
  it('sets the expected security headers', async () => {
    const response = await supertest(createApp({ rateLimitMax: 1000 })).get('/healthz');

    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['permissions-policy']).toContain('camera=()');
  });

  it('rejects an unapproved browser origin for a mutation', async () => {
    const app = createApp({ corsOrigins: ['https://app.example.test'], rateLimitMax: 1000 });
    const response = await supertest(app)
      .post(MUTATION)
      .set('Origin', 'https://attacker.example.test');

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'ORIGIN_NOT_ALLOWED' });
  });

  it('permits the configured browser origin', async () => {
    const app = createApp({ corsOrigins: ['https://app.example.test'], rateLimitMax: 1000 });
    const response = await supertest(app).post(MUTATION).set('Origin', 'https://app.example.test');

    expect(response.status).toBe(404);
  });

  it('defaults to same-origin mutations when no CORS origin is configured', async () => {
    const app = createApp({ rateLimitMax: 1000 });

    const accepted = await supertest(app)
      .post(MUTATION)
      .set('Host', 'app.example.test')
      .set('Origin', 'http://app.example.test');
    expect(accepted.status).toBe(404);

    const rejected = await supertest(app)
      .post(MUTATION)
      .set('Host', 'app.example.test')
      .set('Origin', 'http://attacker.example.test');
    expect(rejected.status).toBe(403);
  });

  it('serves the API openly when no access token is configured', async () => {
    const app = createApp({ rateLimitMax: 1000 });
    expect((await supertest(app).get('/api/cases')).status).toBe(200);
  });

  it('requires the bearer token on /api once one is configured', async () => {
    process.env['SOMNOSCRIBE_ACCESS_TOKEN'] = 'shared-operator-token';
    const app = createApp({ rateLimitMax: 1000 });

    const missing = await supertest(app).get('/api/cases');
    expect(missing.status).toBe(401);
    expect(missing.body).toMatchObject({ code: 'ACCESS_TOKEN_REQUIRED' });

    expect(
      (await supertest(app).get('/api/cases').set('Authorization', 'Bearer wrong')).status,
    ).toBe(401);
    expect(
      (await supertest(app).get('/api/cases').set('Authorization', 'Bearer shared-operator-token'))
        .status,
    ).toBe(200);
  });

  it('leaves the capability probe reachable so the interface can render before a token', async () => {
    process.env['SOMNOSCRIBE_ACCESS_TOKEN'] = 'shared-operator-token';
    const app = createApp({ rateLimitMax: 1000 });
    expect((await supertest(app).get('/api/config')).status).toBe(200);
  });

  it('classifies malformed and oversized JSON as client errors', async () => {
    const app = createApp({ rateLimitMax: 1000 });

    const malformed = await supertest(app)
      .post(MUTATION)
      .set('Content-Type', 'application/json')
      .send('{');
    expect(malformed.status).toBe(400);
    expect(malformed.body.code).toBe('INVALID_JSON');

    const oversized = await supertest(app)
      .post(MUTATION)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify('x'.repeat(70 * 1024)));
    expect(oversized.status).toBe(413);
    expect(oversized.body.code).toBe('REQUEST_TOO_LARGE');
  });
});
