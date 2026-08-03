import { describe, it, expect, beforeEach } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../app.js';
import { insertLicense, getLicense } from '../license.js';
import { getDb, getUserByEmail, upsertOtp } from '../db.js';

describe('POST /api/auth/activate', () => {
  let request: ReturnType<typeof supertest>;

  beforeEach(() => {
    const app = createApp({ rateLimitMax: 1000, uploadRateLimitMax: 1000 });
    request = supertest(app);
  });

  it('rejects an unknown license key', async () => {
    const res = await request
      .post('/api/auth/activate')
      .send({ email: 'reviewer@example.test', licenseKey: 'AAAA-BBBB-CCCC-DDDD' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid license/i);
  });

  it('burns the license, creates a user, and sets the auth cookie', async () => {
    insertLicense(getDb(), 'TEST-AAAA-BBBB-CCCC');

    const res = await request
      .post('/api/auth/activate')
      .send({ email: 'reviewer@example.test', licenseKey: 'TEST-AAAA-BBBB-CCCC' });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('reviewer@example.test');
    expect(res.headers['set-cookie']?.[0] ?? '').toMatch(/somno_session=/);

    const lic = getLicense(getDb(), 'TEST-AAAA-BBBB-CCCC');
    expect(lic?.used).toBe(1);
    expect(lic?.used_by).toBe('reviewer@example.test');

    expect(getUserByEmail('reviewer@example.test')).toBeDefined();
  });

  it('rejects re-use of a burned license', async () => {
    insertLicense(getDb(), 'TEST-XXXX-YYYY-ZZZZ');
    const first = await request
      .post('/api/auth/activate')
      .send({ email: 'a@example.test', licenseKey: 'TEST-XXXX-YYYY-ZZZZ' });
    expect(first.status).toBe(200);

    const second = await request
      .post('/api/auth/activate')
      .send({ email: 'b@example.test', licenseKey: 'TEST-XXXX-YYYY-ZZZZ' });
    expect(second.status).toBe(400);
    expect(second.body.error).toMatch(/already been used/i);
  });

  it('rejects activation when the email already has an account', async () => {
    insertLicense(getDb(), 'TEST-DUP1-DUP1-DUP1');
    insertLicense(getDb(), 'TEST-DUP2-DUP2-DUP2');
    await request
      .post('/api/auth/activate')
      .send({ email: 'duplicate@example.test', licenseKey: 'TEST-DUP1-DUP1-DUP1' });

    const res = await request
      .post('/api/auth/activate')
      .send({ email: 'duplicate@example.test', licenseKey: 'TEST-DUP2-DUP2-DUP2' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already exists/i);
  });
});

describe('POST /api/auth/verify', () => {
  let request: ReturnType<typeof supertest>;

  beforeEach(() => {
    const app = createApp({ rateLimitMax: 1000, uploadRateLimitMax: 1000 });
    request = supertest(app);
  });

  it('rejects a wrong code', async () => {
    insertLicense(getDb(), 'TEST-LOG1-LOG1-LOG1');
    await request
      .post('/api/auth/activate')
      .send({ email: 'login@example.test', licenseKey: 'TEST-LOG1-LOG1-LOG1' });
    upsertOtp('login@example.test', '123456');

    const res = await request
      .post('/api/auth/verify')
      .send({ email: 'login@example.test', code: '999999' });
    expect(res.status).toBe(400);
  });

  it('accepts a correct code, sets the cookie, and lets /me return the user', async () => {
    insertLicense(getDb(), 'TEST-LOG2-LOG2-LOG2');
    await request
      .post('/api/auth/activate')
      .send({ email: 'login2@example.test', licenseKey: 'TEST-LOG2-LOG2-LOG2' });
    upsertOtp('login2@example.test', '111111');

    const res = await request
      .post('/api/auth/verify')
      .send({ email: 'login2@example.test', code: '111111' });
    expect(res.status).toBe(200);
    const cookie = res.headers['set-cookie']?.[0] ?? '';
    expect(cookie).toMatch(/somno_session=/);

    const me = await request.get('/api/auth/me').set('Cookie', cookie);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('login2@example.test');
  });
});

describe('GET /api/auth/me', () => {
  it('returns 401 without a cookie', async () => {
    const app = createApp({ rateLimitMax: 1000, uploadRateLimitMax: 1000 });
    const res = await supertest(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });
});
