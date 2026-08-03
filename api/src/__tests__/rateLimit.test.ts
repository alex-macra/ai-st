import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';
import supertest from 'supertest';
import type { Express } from 'express';
import { createRateLimiter, type RateLimitOptions } from '../middleware/rateLimit.js';

const require = createRequire(import.meta.url);
const express = require('express') as typeof import('express');

function testApp(options: RateLimitOptions, trustProxy: false | 'loopback' = false): Express {
  const app = express();
  app.set('trust proxy', trustProxy);
  app.use(createRateLimiter(options));
  app.get('/', (_req, res) => res.json({ ok: true }));
  return app;
}

describe('createRateLimiter', () => {
  it('preserves legacy limit and remaining headers', async () => {
    const app = testApp({ windowMs: 60_000, maxRequests: 3 });
    const first = await supertest(app).get('/');
    const second = await supertest(app).get('/');
    const third = await supertest(app).get('/');

    expect(first.status).toBe(200);
    expect(first.headers['x-ratelimit-limit']).toBe('3');
    expect(first.headers['x-ratelimit-remaining']).toBe('2');
    expect(second.headers['x-ratelimit-remaining']).toBe('1');
    expect(third.headers['x-ratelimit-remaining']).toBe('0');
  });

  it('returns the compatible 429 body and Retry-After header', async () => {
    const app = testApp({ windowMs: 60_000, maxRequests: 1 });
    await supertest(app).get('/');
    const blocked = await supertest(app).get('/');

    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(blocked.body).toMatchObject({ error: 'Rate limit exceeded' });
    expect(blocked.body.retryAfterSec).toBeGreaterThan(0);
  });

  it('isolates counters by trusted client IP', async () => {
    const app = testApp({ windowMs: 60_000, maxRequests: 1 }, 'loopback');
    const first = await supertest(app).get('/').set('X-Forwarded-For', '198.51.100.1');
    const other = await supertest(app).get('/').set('X-Forwarded-For', '198.51.100.2');
    const repeated = await supertest(app).get('/').set('X-Forwarded-For', '198.51.100.1');

    expect(first.status).toBe(200);
    expect(other.status).toBe(200);
    expect(repeated.status).toBe(429);
  });

  it('resets after the configured window', async () => {
    const app = testApp({ windowMs: 20, maxRequests: 1 });
    expect((await supertest(app).get('/')).status).toBe(200);
    expect((await supertest(app).get('/')).status).toBe(429);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect((await supertest(app).get('/')).status).toBe(200);
  });

  it('bypasses loopback addresses when configured', async () => {
    const app = testApp({ windowMs: 60_000, maxRequests: 1, skipLoopback: true });
    for (let index = 0; index < 4; index += 1) {
      const response = await supertest(app).get('/');
      expect(response.status).toBe(200);
      expect(response.headers['x-ratelimit-limit']).toBeUndefined();
    }
  });

  it('recognizes trusted IPv6 loopback forms', async () => {
    const app = testApp({ windowMs: 60_000, maxRequests: 1, skipLoopback: true }, 'loopback');
    for (const ip of ['::1', '::ffff:127.0.0.1']) {
      expect((await supertest(app).get('/').set('X-Forwarded-For', ip)).status).toBe(200);
      expect((await supertest(app).get('/').set('X-Forwarded-For', ip)).status).toBe(200);
    }
  });
});
