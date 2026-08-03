import { describe, it, expect, beforeEach } from 'vitest';
import supertest from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../app.js';
import { insertCase, updateCaseFindings, updateFindingDecision } from '../db.js';
import type { Case, Finding } from '../shared/types.js';
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
    name: `fr-${randomUUID().slice(0, 8)}`,
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
    claim: 'AHI elevated at 22.4/h',
    evidence: [{ type: 'edf_metric', source: 'ahi', value: 22.4 }],
    confidence: 'high',
    ...overrides
  };
}

describe('PATCH /api/cases/:id/findings/:findingId', () => {
  let request: ReturnType<typeof supertest>;

  beforeEach(() => {
    const app = createApp({ rateLimitMax: 1000, uploadRateLimitMax: 1000 });
    auth = mintAuthCookie();
    request = authedSupertest(app, auth);
  });

  it('returns 404 when case does not exist', async () => {
    const res = await request.patch('/api/cases/ghost/findings/F-x').send({ decision: 'confirm' });
    expect(res.status).toBe(404);
  });

  it('returns 404 when finding does not exist on case', async () => {
    const c = makeCase();
    insertCase(c);
    const res = await request
      .patch(`/api/cases/${c.id}/findings/F-not-here`)
      .send({ decision: 'confirm' });
    expect(res.status).toBe(404);
  });

  it('rejects invalid decision values', async () => {
    const c = makeCase();
    insertCase(c);
    const f = makeFinding();
    updateCaseFindings(c.id, [f], null, c.modelVersion, new Date().toISOString());

    const res = await request
      .patch(`/api/cases/${c.id}/findings/${f.id}`)
      .send({ decision: 'bogus' });
    expect(res.status).toBe(400);
  });

  it('rejects edit decision without editedClaim', async () => {
    const c = makeCase();
    insertCase(c);
    const f = makeFinding();
    updateCaseFindings(c.id, [f], null, c.modelVersion, new Date().toISOString());

    const res = await request
      .patch(`/api/cases/${c.id}/findings/${f.id}`)
      .send({ decision: 'edit' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/editedClaim required/i);
  });

  it('persists confirm decision and writes audit entry', async () => {
    const c = makeCase();
    insertCase(c);
    const f = makeFinding();
    updateCaseFindings(c.id, [f], null, c.modelVersion, new Date().toISOString());

    const res = await request
      .patch(`/api/cases/${c.id}/findings/${f.id}`)
      .send({ decision: 'confirm' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, decision: 'confirm' });

    const fetched = await request.get(`/api/cases/${c.id}`);
    const persisted = fetched.body.case.findings.find((x: Finding) => x.id === f.id);
    expect(persisted.reviewerDecision).toBe('confirm');
    expect(persisted.reviewedAt).toBeTruthy();

    const audit = await request.get(`/api/cases/${c.id}/audit`);
    expect(audit.body.auditLog.some((r: { action: string }) => r.action === 'finding_confirm')).toBe(true);
  });

  it('persists editedClaim when decision is edit', async () => {
    const c = makeCase();
    insertCase(c);
    const f = makeFinding();
    updateCaseFindings(c.id, [f], null, c.modelVersion, new Date().toISOString());

    const res = await request
      .patch(`/api/cases/${c.id}/findings/${f.id}`)
      .send({ decision: 'edit', editedClaim: 'AHI 18.0/h - mild OSA per reviewer recount' });
    expect(res.status).toBe(200);

    const fetched = await request.get(`/api/cases/${c.id}`);
    const persisted = fetched.body.case.findings.find((x: Finding) => x.id === f.id);
    expect(persisted.reviewerDecision).toBe('edit');
    expect(persisted.editedClaim).toBe('AHI 18.0/h - mild OSA per reviewer recount');
  });

  it('clears editedClaim when reviewer switches from edit to confirm', async () => {
    const c = makeCase();
    insertCase(c);
    const f = makeFinding();
    const now = new Date().toISOString();
    updateCaseFindings(c.id, [f], null, c.modelVersion, now);
    updateFindingDecision(c.id, f.id, 'edit', 'previous edit', now);

    const res = await request
      .patch(`/api/cases/${c.id}/findings/${f.id}`)
      .send({ decision: 'confirm' });
    expect(res.status).toBe(200);

    const fetched = await request.get(`/api/cases/${c.id}`);
    const persisted = fetched.body.case.findings.find((x: Finding) => x.id === f.id);
    expect(persisted.reviewerDecision).toBe('confirm');
    expect(persisted.editedClaim).toBeUndefined();
  });

  it('returns 409 when case is signed off', async () => {
    const c = makeCase({ status: 'signed_off' });
    insertCase(c);
    const f = makeFinding();
    updateCaseFindings(c.id, [f], null, c.modelVersion, new Date().toISOString());

    const res = await request
      .patch(`/api/cases/${c.id}/findings/${f.id}`)
      .send({ decision: 'confirm' });
    expect(res.status).toBe(409);
  });
});
