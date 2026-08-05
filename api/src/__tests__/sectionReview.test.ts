// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, beforeEach } from 'vitest';
import supertest from 'supertest';
import { insertCase, updateCaseFindings } from '../db.js';
import type { StructuredReport } from '../shared/types.js';
import { makeCase, testApp } from './factories.js';

function reportWithSummary(): StructuredReport {
  return {
    summary: 'Patient with mild OSA on HSAT.',
    studyQuality: { channelIssues: [] },
    respiratoryIndices: { ahi: 7.4 },
    oxygenation: {},
    positional: {},
    impression: 'Mild OSA.',
    citations: {},
  };
}

describe('PATCH /api/cases/:id/sections/:sectionKey', () => {
  let request: ReturnType<typeof supertest>;

  beforeEach(() => {
    request = testApp();
  });

  it('returns 400 for unknown section key', async () => {
    const c = makeCase();
    insertCase(c);
    updateCaseFindings(
      c.id,
      [],
      null,
      c.modelVersion,
      new Date().toISOString(),
      reportWithSummary(),
    );

    const res = await request
      .patch(`/api/cases/${c.id}/sections/notARealSection`)
      .send({ decision: 'confirm' });
    expect(res.status).toBe(400);
  });

  it('returns 404 when case does not exist', async () => {
    const res = await request
      .patch('/api/cases/ghost/sections/summary')
      .send({ decision: 'confirm' });
    expect(res.status).toBe(404);
  });

  it('returns 409 when case has no structured report', async () => {
    const c = makeCase();
    insertCase(c);
    const res = await request
      .patch(`/api/cases/${c.id}/sections/summary`)
      .send({ decision: 'confirm' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/run analysis/i);
  });

  it('returns 409 when case is signed off', async () => {
    const c = makeCase({ status: 'signed_off' });
    insertCase(c);
    updateCaseFindings(
      c.id,
      [],
      null,
      c.modelVersion,
      new Date().toISOString(),
      reportWithSummary(),
    );
    const res = await request
      .patch(`/api/cases/${c.id}/sections/summary`)
      .send({ decision: 'confirm' });
    expect(res.status).toBe(409);
  });

  it('rejects edit decision without editedValue', async () => {
    const c = makeCase();
    insertCase(c);
    updateCaseFindings(
      c.id,
      [],
      null,
      c.modelVersion,
      new Date().toISOString(),
      reportWithSummary(),
    );

    const res = await request
      .patch(`/api/cases/${c.id}/sections/summary`)
      .send({ decision: 'edit' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/editedValue required/i);
  });

  it('persists section review and writes audit entry', async () => {
    const c = makeCase();
    insertCase(c);
    updateCaseFindings(
      c.id,
      [],
      null,
      c.modelVersion,
      new Date().toISOString(),
      reportWithSummary(),
    );

    const res = await request
      .patch(`/api/cases/${c.id}/sections/summary`)
      .send({ decision: 'confirm' });
    expect(res.status).toBe(200);

    const fetched = await request.get(`/api/cases/${c.id}`);
    expect(fetched.body.case.sectionReviews?.summary?.decision).toBe('confirm');

    const audit = await request.get(`/api/cases/${c.id}/audit`);
    expect(
      audit.body.auditLog.some((r: { action: string }) => r.action === 'section_confirm'),
    ).toBe(true);
  });

  it('persists editedValue when decision is edit', async () => {
    const c = makeCase();
    insertCase(c);
    updateCaseFindings(
      c.id,
      [],
      null,
      c.modelVersion,
      new Date().toISOString(),
      reportWithSummary(),
    );

    const res = await request
      .patch(`/api/cases/${c.id}/sections/summary`)
      .send({ decision: 'edit', editedValue: 'Mild OSA per reviewer rewrite.' });
    expect(res.status).toBe(200);

    const fetched = await request.get(`/api/cases/${c.id}`);
    expect(fetched.body.case.sectionReviews?.summary).toMatchObject({
      decision: 'edit',
      editedValue: 'Mild OSA per reviewer rewrite.',
    });
  });
});
