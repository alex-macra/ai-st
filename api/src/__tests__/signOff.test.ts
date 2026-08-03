import { describe, it, expect, beforeEach } from 'vitest';
import supertest from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../app.js';
import { insertCase, updateCaseFindings, updateSectionReview, updateFindingDecision } from '../db.js';
import type { Case, Finding, StructuredReport } from '../shared/types.js';
import { mintAuthCookie, authedSupertest, type TestAuth } from './authHelper.js';

let auth: TestAuth = undefined as unknown as TestAuth;

function hex64(): string {
  return Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

function makeCase(overrides: Partial<Case> = {}): Case {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    studyHash: hex64(),
    name: `signoff-${randomUUID().slice(0, 8)}`,
    status: 'pending_review',
    cohort: 'adult',
    findings: [],
    createdBy: auth.userId,
    preprocessorVersion: '0.1.0',
    promptVersion: '1.2.0',
    modelVersion: 'gpt-5.4-mini',
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: `F-${randomUUID()}`,
    claim: 'AHI elevated at 22.4/h consistent with moderate OSA',
    evidence: [{ type: 'edf_metric', source: 'ahi', value: 22.4 }],
    confidence: 'high',
    ...overrides
  };
}

function emptyStructuredReport(overrides: Partial<StructuredReport> = {}): StructuredReport {
  return {
    summary: '',
    studyQuality: { channelIssues: [] },
    respiratoryIndices: {},
    oxygenation: {},
    positional: {},
    impression: '',
    citations: {},
    ...overrides
  };
}

describe('POST /api/cases/:id/sign-off', () => {
  let request: ReturnType<typeof supertest>;

  beforeEach(() => {
    const app = createApp({ rateLimitMax: 1000, uploadRateLimitMax: 1000 });
    auth = mintAuthCookie();
    request = authedSupertest(app, auth);
  });

  it('returns 404 for unknown case', async () => {
    const res = await request.post('/api/cases/ghost/sign-off').send({});
    expect(res.status).toBe(404);
  });

  it('returns 401 without an auth cookie', async () => {
    const c = makeCase();
    insertCase(c);
    const app = createApp({ rateLimitMax: 1000, uploadRateLimitMax: 1000 });
    const noAuth = supertest(app);
    const res = await noAuth.post(`/api/cases/${c.id}/sign-off`).send({});
    expect(res.status).toBe(401);
  });

  it('rejects with 422 when case has no findings', async () => {
    const c = makeCase({ findings: [] });
    insertCase(c);
    const res = await request.post(`/api/cases/${c.id}/sign-off`).send({});
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/no findings/i);
  });

  it('rejects with 422 listing unreviewed count when any finding is unreviewed', async () => {
    const c = makeCase();
    insertCase(c);
    const a = makeFinding();
    const b = makeFinding();
    const now = new Date().toISOString();
    updateCaseFindings(c.id, [a, b], null, c.modelVersion, now);
    updateFindingDecision(c.id, a.id, 'confirm', undefined, now);

    const res = await request.post(`/api/cases/${c.id}/sign-off`).send({});
    expect(res.status).toBe(422);
    expect(res.body.unreviewedCount).toBe(1);
  });

  it('rejects with 422 when populated report sections are unreviewed', async () => {
    const c = makeCase();
    insertCase(c);
    const f = makeFinding();
    const now = new Date().toISOString();
    const report = emptyStructuredReport({
      summary: 'Patient with moderate OSA on HSAT.',
      respiratoryIndices: { ahi: 22.4 },
      impression: 'Moderate OSA - refer for treatment evaluation.'
    });
    updateCaseFindings(c.id, [f], 'narr', c.modelVersion, now, report);
    updateFindingDecision(c.id, f.id, 'confirm', undefined, now);

    const res = await request.post(`/api/cases/${c.id}/sign-off`).send({});
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/sections must be reviewed/i);
    expect(res.body.unreviewedSections).toEqual(
      expect.arrayContaining(['summary', 'respiratoryIndices', 'impression'])
    );
  });

  it('treats empty-string and empty-object sections as not populated', async () => {
    const c = makeCase();
    insertCase(c);
    const f = makeFinding();
    const now = new Date().toISOString();
    const report = emptyStructuredReport({
      summary: '   ',
      studyQuality: { channelIssues: [] },
      respiratoryIndices: {},
      impression: 'Done.'
    });
    updateCaseFindings(c.id, [f], 'narr', c.modelVersion, now, report);
    updateFindingDecision(c.id, f.id, 'confirm', undefined, now);
    updateSectionReview(c.id, 'impression', { decision: 'confirm', reviewedAt: now }, now);

    const res = await request.post(`/api/cases/${c.id}/sign-off`).send({});
    expect(res.status).toBe(200);
  });

  it('signs off when all findings and populated sections are reviewed', async () => {
    const c = makeCase();
    insertCase(c);
    const f = makeFinding();
    const now = new Date().toISOString();
    const report = emptyStructuredReport({
      summary: 'Summary.',
      respiratoryIndices: { ahi: 22.4 },
      impression: 'Impression.'
    });
    updateCaseFindings(c.id, [f], 'narr', c.modelVersion, now, report);
    updateFindingDecision(c.id, f.id, 'confirm', undefined, now);
    for (const k of ['summary', 'respiratoryIndices', 'impression'] as const) {
      updateSectionReview(c.id, k, { decision: 'confirm', reviewedAt: now }, now);
    }

    const res = await request.post(`/api/cases/${c.id}/sign-off`).send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });

    const fetched = await request.get(`/api/cases/${c.id}`);
    expect(fetched.body.case.status).toBe('signed_off');

    const audit = await request.get(`/api/cases/${c.id}/audit`);
    expect(audit.body.auditLog.some((r: { action: string }) => r.action === 'signed_off')).toBe(true);
  });

  it('rejects re-sign-off with 409 once already signed off', async () => {
    const c = makeCase();
    insertCase(c);
    const f = makeFinding();
    const now = new Date().toISOString();
    updateCaseFindings(c.id, [f], null, c.modelVersion, now);
    updateFindingDecision(c.id, f.id, 'confirm', undefined, now);

    const ok = await request.post(`/api/cases/${c.id}/sign-off`).send({});
    expect(ok.status).toBe(200);

    const dup = await request.post(`/api/cases/${c.id}/sign-off`).send({});
    expect(dup.status).toBe(409);
  });
});
