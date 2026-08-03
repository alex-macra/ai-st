import { test, expect } from '@playwright/test';

// End-to-end exercise of the application auth boundary. Uses the DEV_OTP_BYPASS
// env flag (code '000000' accepted) instead of real email delivery. The dev
// synthetic reviewer is seeded into the auth-test DB by global-setup.ts.

const DEV_EMAIL = 'reviewer@example.test';

test.describe('auth — protected route flow', () => {
  test('GET /api/auth/me returns 401 without a session cookie', async ({ request }) => {
    const res = await request.get('/api/auth/me');
    expect(res.status()).toBe(401);
  });

  test('GET /api/auth/me returns 401 with a malformed cookie', async ({ request }) => {
    const res = await request.get('/api/auth/me', {
      headers: { cookie: 'somno_session=not-a-real-jwt' },
    });
    expect(res.status()).toBe(401);
  });

  test('login → verify → /me round-trip with DEV_OTP_BYPASS', async ({ request }) => {
    // 1. POST /api/auth/login — returns 200 even if user doesn't exist (no enumeration)
    const loginRes = await request.post('/api/auth/login', { data: { email: DEV_EMAIL } });
    expect(loginRes.ok(), `login: ${loginRes.status()} ${await loginRes.text()}`).toBeTruthy();

    // 2. POST /api/auth/verify with '000000' — DEV_OTP_BYPASS accepts it.
    const verifyRes = await request.post('/api/auth/verify', {
      data: { email: DEV_EMAIL, code: '000000' },
    });
    expect(verifyRes.ok(), `verify: ${verifyRes.status()} ${await verifyRes.text()}`).toBeTruthy();

    // The verify response sets the auth cookie. APIRequestContext follows
    // the cookie jar automatically, so subsequent requests are authenticated.
    const verifyBody = (await verifyRes.json()) as { user: { email: string } };
    expect(verifyBody.user.email).toBe(DEV_EMAIL);

    // 3. GET /api/auth/me — should now return the user.
    const meRes = await request.get('/api/auth/me');
    expect(meRes.ok(), `/me: ${meRes.status()} ${await meRes.text()}`).toBeTruthy();
    const meBody = (await meRes.json()) as { user: { email: string; isAdmin: boolean } };
    expect(meBody.user.email).toBe(DEV_EMAIL);
  });

  test('verify rejects a wrong OTP code', async ({ request }) => {
    const res = await request.post('/api/auth/verify', {
      data: { email: DEV_EMAIL, code: '123456' },
    });
    expect(res.status()).toBe(400);
  });

  test('logout clears the session cookie', async ({ request }) => {
    // First obtain a session.
    await request.post('/api/auth/login', { data: { email: DEV_EMAIL } });
    const verify = await request.post('/api/auth/verify', {
      data: { email: DEV_EMAIL, code: '000000' },
    });
    expect(verify.ok()).toBeTruthy();

    const logout = await request.post('/api/auth/logout');
    expect(logout.ok()).toBeTruthy();
    const setCookie = logout.headers()['set-cookie'] ?? '';
    expect(setCookie).toMatch(/somno_session=/);
    expect(setCookie).toMatch(/Max-Age=0|Expires=/);
  });
});
