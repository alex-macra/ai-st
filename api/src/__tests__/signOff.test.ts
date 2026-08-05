// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, beforeEach } from 'vitest';
import supertest from 'supertest';
import {
  insertCase,
  updateCaseFindings,
  updateSectionReview,
  updateFindingDecision,
} from '../db.js';
import { emptyStructuredReport, makeCase, makeFinding, testApp } from './factories.js';

describe('POST /api/cases/:id/sign-off', () => {
  let request: ReturnType<typeof supertest>;

  beforeEach(() => {
    request = testApp();
  });

  it('returns 404 for unknown case', async () => {
    const res = await request
      .post('/api/cases/ghost/sign-off')
      .send({ reviewerName: 'Dr Synthetic' });
    expect(res.status).toBe(404);
  });

  it('rejects sign-off that carries no reviewer name', async () => {
    const c = makeCase();
    insertCase(c);
    const res = await request.post(`/api/cases/${c.id}/sign-off`).send({});
    expect(res.status).toBe(400);
  });

  it('rejects a blank reviewer name', async () => {
    const c = makeCase();
    insertCase(c);
    const res = await request.post(`/api/cases/${c.id}/sign-off`).send({ reviewerName: '   ' });
    expect(res.status).toBe(400);
  });

  it('rejects with 422 when case has no findings', async () => {
    const c = makeCase({ findings: [] });
    insertCase(c);
    const res = await request
      .post(`/api/cases/${c.id}/sign-off`)
      .send({ reviewerName: 'Dr Synthetic' });
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

    const res = await request
      .post(`/api/cases/${c.id}/sign-off`)
      .send({ reviewerName: 'Dr Synthetic' });
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
      impression: 'Moderate OSA - refer for treatment evaluation.',
    });
    updateCaseFindings(c.id, [f], 'narr', c.modelVersion, now, report);
    updateFindingDecision(c.id, f.id, 'confirm', undefined, now);

    const res = await request
      .post(`/api/cases/${c.id}/sign-off`)
      .send({ reviewerName: 'Dr Synthetic' });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/sections must be reviewed/i);
    expect(res.body.unreviewedSections).toEqual(
      expect.arrayContaining(['summary', 'respiratoryIndices', 'impression']),
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
      impression: 'Done.',
    });
    updateCaseFindings(c.id, [f], 'narr', c.modelVersion, now, report);
    updateFindingDecision(c.id, f.id, 'confirm', undefined, now);
    updateSectionReview(c.id, 'impression', { decision: 'confirm', reviewedAt: now }, now);

    const res = await request
      .post(`/api/cases/${c.id}/sign-off`)
      .send({ reviewerName: 'Dr Synthetic' });
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
      impression: 'Impression.',
    });
    updateCaseFindings(c.id, [f], 'narr', c.modelVersion, now, report);
    updateFindingDecision(c.id, f.id, 'confirm', undefined, now);
    for (const k of ['summary', 'respiratoryIndices', 'impression'] as const) {
      updateSectionReview(c.id, k, { decision: 'confirm', reviewedAt: now }, now);
    }

    const res = await request
      .post(`/api/cases/${c.id}/sign-off`)
      .send({ reviewerName: 'Dr Synthetic' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });

    const fetched = await request.get(`/api/cases/${c.id}`);
    expect(fetched.body.case.status).toBe('signed_off');

    const audit = await request.get(`/api/cases/${c.id}/audit`);
    expect(audit.body.auditLog.some((r: { action: string }) => r.action === 'signed_off')).toBe(
      true,
    );
  });

  it('rejects re-sign-off with 409 once already signed off', async () => {
    const c = makeCase();
    insertCase(c);
    const f = makeFinding();
    const now = new Date().toISOString();
    updateCaseFindings(c.id, [f], null, c.modelVersion, now);
    updateFindingDecision(c.id, f.id, 'confirm', undefined, now);

    const ok = await request
      .post(`/api/cases/${c.id}/sign-off`)
      .send({ reviewerName: 'Dr Synthetic' });
    expect(ok.status).toBe(200);

    const dup = await request
      .post(`/api/cases/${c.id}/sign-off`)
      .send({ reviewerName: 'Dr Synthetic' });
    expect(dup.status).toBe(409);
  });
});
