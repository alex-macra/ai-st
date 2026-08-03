import { describe, it, expect, beforeEach } from 'vitest';
import supertest from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../app.js';
import { insertCase } from '../db.js';
import type { Case, Finding, StructuredReport } from '../shared/types.js';
import { mintAuthCookie, authedSupertest, type TestAuth } from './authHelper.js';

let auth: TestAuth = undefined as unknown as TestAuth;

function makeCase(overrides: Partial<Case> = {}): Case {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    studyHash: createHash32(),
    name: `test-${randomUUID().slice(0, 8)}`,
    status: 'draft',
    cohort: 'adult',
    findings: [],
    createdBy: auth.userId,
    preprocessorVersion: '0.1.0',
    promptVersion: 'none',
    modelVersion: 'none',
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function createHash32(): string {
  return Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

describe('cases API', () => {
  let request: ReturnType<typeof supertest>;

  beforeEach(() => {
    const app = createApp({ rateLimitMax: 1000, uploadRateLimitMax: 1000 });
    auth = mintAuthCookie();
    request = authedSupertest(app, auth);
  });

  describe('GET /api/cases', () => {
    it('returns empty list when no cases exist', async () => {
      const res = await request.get('/api/cases');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ cases: [] });
    });

    it('returns inserted cases', async () => {
      const c = makeCase();
      insertCase(c);
      const res = await request.get('/api/cases');
      expect(res.status).toBe(200);
      expect(res.body.cases).toHaveLength(1);
      expect(res.body.cases[0].id).toBe(c.id);
    });

    it('filters by status', async () => {
      const draft = makeCase({ status: 'draft' });
      const pending = makeCase({ status: 'pending_review' });
      insertCase(draft);
      insertCase(pending);
      const res = await request.get('/api/cases?status=pending_review');
      expect(res.status).toBe(200);
      expect(res.body.cases.every((c: Case) => c.status === 'pending_review')).toBe(true);
    });

    it('rejects invalid status filter', async () => {
      const res = await request.get('/api/cases?status=nonsense');
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/cases/:id', () => {
    it('returns 404 for unknown case', async () => {
      const res = await request.get('/api/cases/does-not-exist');
      expect(res.status).toBe(404);
    });

    it('returns the case by id', async () => {
      const c = makeCase();
      insertCase(c);
      const res = await request.get(`/api/cases/${c.id}`);
      expect(res.status).toBe(200);
      expect(res.body.case.id).toBe(c.id);
    });

    it('keeps signed-off cases readable', async () => {
      const c = makeCase({ status: 'signed_off' });
      insertCase(c);
      const res = await request.get(`/api/cases/${c.id}`);
      expect(res.status).toBe(200);
      expect(res.body.case.status).toBe('signed_off');
    });
  });

  describe('PATCH /api/cases/:id/status', () => {
    it('updates status and records audit entry', async () => {
      const c = makeCase({ status: 'draft' });
      insertCase(c);

      const res = await request
        .patch(`/api/cases/${c.id}/status`)
        .send({ status: 'pending_review' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ ok: true, status: 'pending_review' });

      const auditRes = await request.get(`/api/cases/${c.id}/audit`);
      expect(auditRes.status).toBe(200);
      expect(auditRes.body.auditLog).toHaveLength(1);
      expect(auditRes.body.auditLog[0].action).toBe('status_changed_to_pending_review');
    });

    it('rejects invalid status', async () => {
      const c = makeCase();
      insertCase(c);
      const res = await request
        .patch(`/api/cases/${c.id}/status`)
        .send({ status: 'invalid' });
      expect(res.status).toBe(400);
    });

    it('cannot bypass review gates by setting signed_off directly', async () => {
      const c = makeCase({ status: 'draft' });
      insertCase(c);
      const res = await request
        .patch(`/api/cases/${c.id}/status`)
        .send({ status: 'signed_off' });
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: 'SIGN_OFF_REQUIRES_REVIEW' });

      const fetched = await request.get(`/api/cases/${c.id}`);
      expect(fetched.body.case.status).toBe('draft');
    });

    it('does not allow a signed-off case to return to an editable status', async () => {
      const c = makeCase({ status: 'signed_off' });
      insertCase(c);

      const res = await request
        .patch(`/api/cases/${c.id}/status`)
        .send({ status: 'draft' });

      expect(res.status).toBe(409);
      expect((await request.get(`/api/cases/${c.id}`)).body.case.status).toBe('signed_off');
    });

    it('returns 404 for unknown case', async () => {
      const res = await request
        .patch('/api/cases/ghost/status')
        .send({ status: 'pending_review' });
      expect(res.status).toBe(404);
    });
  });

  describe('analysis mutation gates', () => {
    const finding: Finding = {
      id: 'F-001',
      claim: 'Synthetic workflow finding.',
      confidence: 'high',
      evidence: [{ type: 'report_page', source: 'synthetic', value: 'present' }],
    };
    const report: StructuredReport = {
      summary: 'Synthetic summary.',
      studyQuality: { channelIssues: [] },
      respiratoryIndices: {},
      oxygenation: {},
      positional: {},
      impression: '',
      citations: { summary: ['F-001'] },
    };

    it('rejects analysis and action-plan writes for signed-off cases', async () => {
      const c = makeCase({ status: 'signed_off', findings: [finding], structuredReport: report });
      insertCase(c);

      expect((await request.post(`/api/cases/${c.id}/analyze`).send({})).status).toBe(409);
      expect((await request.post(`/api/cases/${c.id}/action-plan`).send({})).status).toBe(409);
    });

    it('requires completed human review before action-plan generation', async () => {
      const c = makeCase({ status: 'pending_review', findings: [finding], structuredReport: report });
      insertCase(c);

      const response = await request.post(`/api/cases/${c.id}/action-plan`).send({});

      expect(response.status).toBe(422);
      expect(response.body).toMatchObject({ code: 'review_required', unreviewedFindingCount: 1 });
      expect(response.body.unreviewedSections).toContain('summary');
    });
  });

  describe('DELETE /api/cases/:id', () => {
    it('deletes the case and its audit log', async () => {
      const c = makeCase({ status: 'draft' });
      insertCase(c);
      await request.patch(`/api/cases/${c.id}/status`).send({ status: 'pending_review' });

      const del = await request.delete(`/api/cases/${c.id}`);
      expect(del.status).toBe(200);
      expect(del.body).toMatchObject({ ok: true });

      const fetched = await request.get(`/api/cases/${c.id}`);
      expect(fetched.status).toBe(404);
    });

    it('returns 409 for signed-off cases', async () => {
      const c = makeCase({ status: 'signed_off' });
      insertCase(c);
      const del = await request.delete(`/api/cases/${c.id}`);
      expect(del.status).toBe(409);
    });

    it('returns 404 for unknown case', async () => {
      const res = await request.delete('/api/cases/does-not-exist');
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/cases/:id/screenshots/:screenshotId', () => {
    function makeCaseWithScreenshot(screenshotId: string): Case {
      return makeCase({
        casePackage: JSON.stringify({
          schema_version: '0.4',
          screenshot_metadata: [{ id: screenshotId, originalName: 'eeg.png' }]
        })
      });
    }

    it('removes the screenshot from case_package and returns ok', async () => {
      const ssId = randomUUID();
      const c = makeCaseWithScreenshot(ssId);
      insertCase(c);

      const res = await request.delete(`/api/cases/${c.id}/screenshots/${ssId}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ ok: true });

      const fetched = await request.get(`/api/cases/${c.id}`);
      expect(fetched.status).toBe(200);
      const pkg = JSON.parse((fetched.body as { case: Case }).case.casePackage ?? '{}') as Record<string, unknown>;
      expect(pkg['screenshot_metadata']).toEqual([]);
    });

    it('returns 404 when screenshot id is not in metadata', async () => {
      const c = makeCaseWithScreenshot(randomUUID());
      insertCase(c);
      const res = await request.delete(`/api/cases/${c.id}/screenshots/${randomUUID()}`);
      expect(res.status).toBe(404);
    });

    it('returns 409 for signed-off cases', async () => {
      const ssId = randomUUID();
      const c = makeCaseWithScreenshot(ssId);
      insertCase({ ...c, status: 'signed_off' });
      const res = await request.delete(`/api/cases/${c.id}/screenshots/${ssId}`);
      expect(res.status).toBe(409);
    });

    it('returns 404 for unknown case', async () => {
      const res = await request.delete(`/api/cases/does-not-exist/screenshots/${randomUUID()}`);
      expect(res.status).toBe(404);
    });
  });
});
