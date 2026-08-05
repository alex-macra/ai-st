// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../app.js';
import {
  createCaseWithAudit,
  DemoCreatorUnavailableError,
  getCaseById,
  getDb,
  getUserById,
  insertCase,
} from '../db.js';
import { getLicense, insertLicense } from '../license.js';
import { DEMO_USER_EMAIL } from '../routes/auth.js';
import { purgeDemoArtifacts, purgeExpiredDemoData } from '../demoData.js';
import { mintAuthCookie } from './authHelper.js';

const originalKey = process.env['OPENAI_API_KEY'];
const originalDemoMode = process.env['SOMNOSCRIBE_DEMO_MODE'];
const originalSyntheticMode = process.env['SOMNOSCRIBE_SYNTHETIC_LLM'];
const originalDemoPrincipalLimit = process.env['SOMNOSCRIBE_DEMO_MAX_ACTIVE_PRINCIPALS'];

const PACKAGE = {
  schema_version: '0.4',
  preprocessor_version: '0.3.1',
  edf_available: true,
  candidate_windows: [],
};

function app(overrides: Parameters<typeof createApp>[0] = {}) {
  return createApp({ rateLimitMax: 1000, uploadRateLimitMax: 1000, ...overrides });
}

function setEnvironment(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function syntheticEdf(seed = 'synthetic-demo-study'): Buffer {
  const buffer = Buffer.alloc(256, 0x20);
  buffer.write('0       ', 0, 'ascii');
  buffer.write(seed.slice(0, 64), 8, 'ascii');
  return buffer;
}

afterEach(() => {
  setEnvironment('OPENAI_API_KEY', originalKey);
  setEnvironment('SOMNOSCRIBE_DEMO_MODE', originalDemoMode);
  setEnvironment('SOMNOSCRIBE_SYNTHETIC_LLM', originalSyntheticMode);
  setEnvironment('SOMNOSCRIBE_DEMO_MAX_ACTIVE_PRINCIPALS', originalDemoPrincipalLimit);
  vi.unstubAllGlobals();
});

describe('GET /api/config', () => {
  it('reports a configured provider without exposing the credential', async () => {
    setEnvironment('OPENAI_API_KEY', 'sk-test-openai-key');
    const response = await supertest(app()).get('/api/config');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      llmMode: 'openai',
      analysisAvailable: true,
      demoMode: false,
    });
    expect(JSON.stringify(response.body)).not.toContain('sk-test');
  });

  it('reports an unconfigured provider rather than failing to boot', async () => {
    setEnvironment('OPENAI_API_KEY', '');
    const response = await supertest(app()).get('/api/config');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ llmMode: 'unconfigured', analysisAvailable: false });
  });

  it('advertises the public demo switch before sign-in', async () => {
    setEnvironment('SOMNOSCRIBE_DEMO_MODE', 'true');
    const response = await supertest(app()).get('/api/config');

    expect(response.body).toEqual({ llmMode: 'demo', analysisAvailable: true, demoMode: true });
  });

  it('does not expose test-only synthetic LLM mode as a public demo', async () => {
    setEnvironment('SOMNOSCRIBE_SYNTHETIC_LLM', 'true');
    const response = await supertest(app()).get('/api/config');

    expect(response.body).toEqual({ llmMode: 'demo', analysisAvailable: true, demoMode: false });
  });

  it('does not advertise provider model controls while the offline model is active', async () => {
    setEnvironment('SOMNOSCRIBE_DEMO_MODE', 'true');

    const response = await supertest(app()).get('/api/models');

    expect(response.body).toEqual({ models: [], default: '' });
  });
});

describe('POST /api/auth/demo', () => {
  it('is absent unless the public demo switch is on', async () => {
    const response = await supertest(app()).post('/api/auth/demo');

    expect(response.status).toBe(404);
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('creates an isolated, expiring internal principal while exposing the stable demo identity', async () => {
    setEnvironment('SOMNOSCRIBE_DEMO_MODE', 'true');
    const first = await supertest(app()).post('/api/auth/demo');
    const second = await supertest(app()).post('/api/auth/demo');

    expect(first.status).toBe(200);
    expect(first.body.user).toMatchObject({
      email: DEMO_USER_EMAIL,
      isAdmin: false,
      tier: 'starter',
    });
    expect(first.headers['set-cookie']?.[0]).toContain('Max-Age=14400');
    expect(second.body.user.id).not.toBe(first.body.user.id);

    const stored = getUserById(first.body.user.id as string);
    expect(stored).toMatchObject({ isDemo: true, organizationId: null });
    expect(stored?.email).toMatch(/^demo-[0-9a-f-]+@example\.test$/);
    expect(stored?.email).not.toBe(DEMO_USER_EMAIL);
    expect(Date.parse(stored?.demoExpiresAt ?? '')).toBeGreaterThan(Date.now());
  });

  it('uses a distinct, conservative limiter instead of the normal auth limiter', async () => {
    setEnvironment('SOMNOSCRIBE_DEMO_MODE', 'true');
    const limited = app({ demoLoginRateLimitMax: 1, demoLoginRateLimitWindowMs: 60_000 });

    await supertest(limited).post('/api/auth/demo').expect(200);
    const response = await supertest(limited).post('/api/auth/demo');

    expect(response.status).toBe(429);
    expect(response.headers['retry-after']).toBeDefined();
  });

  it('caps active anonymous principals even when callers rotate source IPs', async () => {
    setEnvironment('SOMNOSCRIBE_DEMO_MODE', 'true');
    setEnvironment('SOMNOSCRIBE_DEMO_MAX_ACTIVE_PRINCIPALS', '1');
    // Other tests share the in-memory database in this worker. Expire and
    // clear their temporary principals before asserting this global cap.
    getDb()
      .prepare('UPDATE users SET demo_expires_at = ? WHERE is_demo = 1')
      .run(new Date(Date.now() - 1_000).toISOString());
    await purgeExpiredDemoData();

    const first = await supertest(app({ trustProxy: 1 }))
      .post('/api/auth/demo')
      .set('X-Forwarded-For', '198.51.100.1');
    const second = await supertest(app({ trustProxy: 1 }))
      .post('/api/auth/demo')
      .set('X-Forwarded-For', '198.51.100.2');

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(second.body).toMatchObject({ code: 'demo_session_capacity', retryAfterSeconds: 60 });
  });

  it('revokes a demo session immediately when the public switch turns off', async () => {
    setEnvironment('SOMNOSCRIBE_DEMO_MODE', 'true');
    const agent = supertest.agent(app());
    await agent.post('/api/auth/demo').expect(200);

    setEnvironment('SOMNOSCRIBE_DEMO_MODE', undefined);
    const response = await agent.get('/api/auth/me');

    expect(response.status).toBe(401);
    expect(response.headers['set-cookie']?.[0]).toContain('somno_session=;');
  });

  it('revokes an expired demo session even while demo mode stays on', async () => {
    setEnvironment('SOMNOSCRIBE_DEMO_MODE', 'true');
    const agent = supertest.agent(app());
    const signedIn = await agent.post('/api/auth/demo').expect(200);
    getDb()
      .prepare('UPDATE users SET demo_expires_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 1_000).toISOString(), signedIn.body.user.id as string);

    const response = await agent.get('/api/auth/me');

    expect(response.status).toBe(401);
    expect(response.headers['set-cookie']?.[0]).toContain('somno_session=;');
  });

  it('blocks demo users from account, organization, reference, and administrator surfaces', async () => {
    setEnvironment('SOMNOSCRIBE_DEMO_MODE', 'true');
    const agent = supertest.agent(app());
    await agent.post('/api/auth/demo').expect(200);

    await agent.patch('/api/auth/me/name').send({ name: 'Demo Editor' }).expect(403);
    await agent.post('/api/org/create').send({ name: 'Demo Org' }).expect(403);
    await agent.get('/api/org/me').expect(403);
    await agent.get('/api/references/status').expect(403);
    await agent.get('/api/admin/users').expect(403);
  });

  it('reserves the public demo email from activation and OTP paths', async () => {
    const licenseKey = 'TEST-DEMO-EMAIL-0001';
    insertLicense(getDb(), licenseKey);
    const request = supertest(app());

    await request
      .post('/api/auth/activate')
      .send({ email: DEMO_USER_EMAIL, licenseKey })
      .expect(400);
    expect(getLicense(getDb(), licenseKey)?.used).toBe(0);
    await request.post('/api/auth/login').send({ email: DEMO_USER_EMAIL }).expect(400);
    await request
      .post('/api/auth/verify')
      .send({ email: DEMO_USER_EMAIL, code: '000000' })
      .expect(400);
  });

  it('fails closed for a legacy literal demo account cookie', async () => {
    const legacy = mintAuthCookie({ email: DEMO_USER_EMAIL });

    const response = await supertest(app()).get('/api/auth/me').set('Cookie', legacy.cookie);

    expect(response.status).toBe(401);
    expect(response.headers['set-cookie']?.[0]).toContain('somno_session=;');
  });
});

describe('demo routes and uploads', () => {
  it('gates the demo routes when public demo mode is disabled', async () => {
    const response = await supertest(app())
      .get('/api/demo/study.edf')
      .set('Cookie', mintAuthCookie().cookie);

    expect(response.status).toBe(404);
  });

  it('allows only a demo principal to retrieve the generated recording', async () => {
    setEnvironment('SOMNOSCRIBE_DEMO_MODE', 'true');
    const recording = syntheticEdf();
    const fetchMock = vi.fn(async () => new Response(recording));
    vi.stubGlobal('fetch', fetchMock);

    const normal = await supertest(app())
      .get('/api/demo/study.edf')
      .set('Cookie', mintAuthCookie().cookie);
    expect(normal.status).toBe(403);

    const agent = supertest.agent(app());
    await agent.post('/api/auth/demo').expect(200);
    const response = await agent.get('/api/demo/study.edf');

    expect(response.status).toBe(200);
    expect(response.headers['content-disposition']).toContain('somnoscribe-demo-study.edf');
    expect(Buffer.from(response.body as Buffer).equals(recording)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not accept arbitrary files from a demo principal', async () => {
    setEnvironment('SOMNOSCRIBE_DEMO_MODE', 'true');
    const agent = supertest.agent(app());
    await agent.post('/api/auth/demo').expect(200);

    const response = await agent
      .post('/api/upload')
      .attach('pdf', Buffer.from('%PDF-1.4 not-the-demo-study'), 'report.pdf');

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('DEMO_STUDY_REQUIRED');
  });

  it('accepts only the server-verified generated recording through the normal upload path', async () => {
    setEnvironment('SOMNOSCRIBE_DEMO_MODE', 'true');
    const recording = syntheticEdf();
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/demo/study.edf')) return new Response(recording);
      if (url.endsWith('/ingest')) {
        return new Response(JSON.stringify(PACKAGE), {
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const agent = supertest.agent(app());
    await agent.post('/api/auth/demo').expect(200);
    const response = await agent.post('/api/upload').attach('edf', recording, 'study.edf');

    expect(response.status).toBe(201);
    const created = getCaseById(response.body.caseId as string);
    expect(created?.sourceKind).toBe('demo_synthetic');
    expect(created?.studyHash).toBe(createHash('sha256').update(recording).digest('hex'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects a different EDF before it reaches preprocessing', async () => {
    setEnvironment('SOMNOSCRIBE_DEMO_MODE', 'true');
    const recording = syntheticEdf('expected-demo-study');
    const fetchMock = vi.fn(async () => new Response(recording));
    vi.stubGlobal('fetch', fetchMock);

    const agent = supertest.agent(app());
    await agent.post('/api/auth/demo').expect(200);
    const response = await agent
      .post('/api/upload')
      .attach('edf', syntheticEdf('different-edf'), 'study.edf');

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('DEMO_STUDY_REQUIRED');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not expose non-demo source rows through a demo case scope', async () => {
    setEnvironment('SOMNOSCRIBE_DEMO_MODE', 'true');
    const agent = supertest.agent(app());
    const signedIn = await agent.post('/api/auth/demo').expect(200);
    const userId = signedIn.body.user.id as string;
    const now = new Date().toISOString();

    insertCase({
      id: randomUUID(),
      studyHash: 'a'.repeat(64),
      name: `uploaded-${randomUUID()}`,
      status: 'draft',
      cohort: 'adult',
      findings: [],
      createdBy: userId,
      sourceKind: 'upload',
      preprocessorVersion: 'test',
      promptVersion: 'test',
      modelVersion: 'test',
      createdAt: now,
      updatedAt: now,
    });

    const response = await agent.get('/api/cases');

    expect(response.status).toBe(200);
    expect(response.body.cases).toEqual([]);
  });

  it('reports a demo-study upstream failure without serving bytes', async () => {
    setEnvironment('SOMNOSCRIBE_DEMO_MODE', 'true');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 500 })),
    );
    const agent = supertest.agent(app());
    await agent.post('/api/auth/demo').expect(200);

    const response = await agent.get('/api/demo/study.edf');

    expect(response.status).toBe(502);
    expect(response.body).toMatchObject({ code: 'DEMO_STUDY_UNAVAILABLE' });
  });

  it('reports an unreachable preprocessor for a demo summary', async () => {
    setEnvironment('SOMNOSCRIBE_DEMO_MODE', 'true');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('fetch failed'))),
    );
    const agent = supertest.agent(app());
    await agent.post('/api/auth/demo').expect(200);

    const response = await agent.get('/api/demo/summary');

    expect(response.status).toBe(502);
    expect(response.body).toMatchObject({ code: 'PREPROCESSOR_UNREACHABLE' });
  });
});

describe('demo cleanup', () => {
  it('does not insert a synthetic case after its demo principal has been cleaned up', async () => {
    setEnvironment('SOMNOSCRIBE_DEMO_MODE', 'true');
    const signedIn = await supertest(app()).post('/api/auth/demo').expect(200);
    const userId = signedIn.body.user.id as string;
    const now = new Date().toISOString();
    const caseId = randomUUID();

    getDb()
      .prepare('UPDATE users SET demo_expires_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 1_000).toISOString(), userId);
    await purgeExpiredDemoData();

    expect(() =>
      createCaseWithAudit(
        {
          id: caseId,
          studyHash: 'd'.repeat(64),
          status: 'draft',
          cohort: 'adult',
          findings: [],
          createdBy: userId,
          sourceKind: 'demo_synthetic',
          preprocessorVersion: 'test',
          promptVersion: 'test',
          modelVersion: 'somnoscribe-offline-demo',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: randomUUID(),
          caseId,
          action: 'case_created',
          actorId: userId,
          createdAt: now,
        },
        'study',
      ),
    ).toThrow(DemoCreatorUnavailableError);
    expect(getCaseById(caseId)).toBeUndefined();
  });

  it('purges expired demo users, cases, and analysis audit rows', async () => {
    setEnvironment('SOMNOSCRIBE_DEMO_MODE', 'true');
    const signedIn = await supertest(app()).post('/api/auth/demo').expect(200);
    const userId = signedIn.body.user.id as string;
    const caseId = randomUUID();
    const now = new Date().toISOString();
    insertCase({
      id: caseId,
      studyHash: 'b'.repeat(64),
      name: `demo-${randomUUID()}`,
      status: 'signed_off',
      cohort: 'adult',
      findings: [],
      createdBy: userId,
      sourceKind: 'demo_synthetic',
      preprocessorVersion: 'test',
      promptVersion: 'test',
      modelVersion: 'test',
      createdAt: now,
      updatedAt: now,
    });
    getDb()
      .prepare(
        'INSERT INTO analysis_audit (id, case_id, user_id, tokens_in, tokens_out, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(randomUUID(), caseId, userId, 1, 1, now);
    getDb()
      .prepare('UPDATE users SET demo_expires_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 1_000).toISOString(), userId);

    await purgeExpiredDemoData();

    expect(getUserById(userId)).toBeUndefined();
    expect(getCaseById(caseId)).toBeUndefined();
    const usage = getDb()
      .prepare('SELECT COUNT(*) AS n FROM analysis_audit WHERE user_id = ?')
      .get(userId) as { n: number };
    expect(usage.n).toBe(0);
  });

  it('removes only validated demo artifacts under the configured roots', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'somnoscribe-demo-cleanup-'));
    const charts = path.join(root, 'charts');
    const screenshots = path.join(root, 'screenshots');
    const slices = path.join(root, 'slices');
    const caseId = randomUUID();
    const studyHash = 'c'.repeat(64);
    try {
      mkdirSync(path.join(screenshots, caseId), { recursive: true });
      mkdirSync(charts, { recursive: true });
      mkdirSync(slices, { recursive: true });
      writeFileSync(path.join(screenshots, caseId, 'synthetic.png'), 'synthetic');
      writeFileSync(path.join(charts, `${studyHash}_flow.png`), 'synthetic');
      writeFileSync(path.join(charts, 'keep.png'), 'keep');
      writeFileSync(path.join(slices, `${studyHash}.json`), '[]');
      writeFileSync(path.join(slices, 'keep.json'), '[]');

      const failures = await purgeDemoArtifacts(
        { caseIds: [caseId, '../not-a-case'], orphanedStudyHashes: [studyHash, '../not-a-hash'] },
        { charts, screenshots, slices },
      );

      expect(failures).toBe(0);
      expect(existsSync(path.join(screenshots, caseId))).toBe(false);
      expect(existsSync(path.join(charts, `${studyHash}_flow.png`))).toBe(false);
      expect(existsSync(path.join(slices, `${studyHash}.json`))).toBe(false);
      expect(existsSync(path.join(charts, 'keep.png'))).toBe(true);
      expect(existsSync(path.join(slices, 'keep.json'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
