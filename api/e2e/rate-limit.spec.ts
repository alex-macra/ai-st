import { test, expect } from '@playwright/test';

// somnotouch's rate limiter defaults to skipLoopback:true; this suite sets
// TEST_RATE_LIMIT_INCLUDE_LOOPBACK=1 to override so loopback bursts reach 429.

test.describe('global rate limiter', () => {
  test('first request sets X-RateLimit-Limit + X-RateLimit-Remaining', async ({ request }) => {
    const res = await request.get('/healthz');
    expect(res.status()).toBe(200);
    const headers = res.headers();
    expect(headers['x-ratelimit-limit']).toBe('5');
    const remaining = Number(headers['x-ratelimit-remaining']);
    expect(Number.isFinite(remaining)).toBe(true);
    expect(remaining).toBeGreaterThanOrEqual(0);
    expect(remaining).toBeLessThanOrEqual(5);
  });

  test('X-RateLimit-Reset is a future unix timestamp', async ({ request }) => {
    const res = await request.get('/healthz');
    const reset = Number(res.headers()['x-ratelimit-reset']);
    const nowSec = Math.floor(Date.now() / 1000);
    expect(reset).toBeGreaterThan(nowSec);
    expect(reset).toBeLessThan(nowSec + 120);
  });

  test('burst over the limit returns 429 with Retry-After + retryAfterSec', async ({ request }) => {
    let block: Awaited<ReturnType<typeof request.get>> | undefined;
    for (let i = 0; i < 20; i++) {
      const res = await request.get('/healthz');
      if (res.status() === 429) {
        block = res;
        break;
      }
    }
    expect(block, 'expected at least one 429 in 20 burst requests').toBeDefined();
    expect(block!.status()).toBe(429);

    const body = (await block!.json()) as { error: string; retryAfterSec: number };
    expect(body).toMatchObject({ error: 'Rate limit exceeded' });
    expect(typeof body.retryAfterSec).toBe('number');
    expect(body.retryAfterSec).toBeGreaterThan(0);

    const retryAfter = Number(block!.headers()['retry-after']);
    expect(retryAfter).toBeGreaterThan(0);
  });
});
