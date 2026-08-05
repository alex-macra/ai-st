// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
// Happy-path smoke test of the full case lifecycle over real Express + SQLite.
// Two boundary stubs: the preprocessor is stubbed at fetch, and analyze output
// is written straight to the DB so no real LLM is needed.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import supertest from 'supertest';
import { randomUUID } from 'node:crypto';
import { updateCaseFindings } from '../db.js';
import type { Finding, StructuredReport } from '../shared/types.js';
import { testApp } from './factories.js';

function syntheticEdf(): Buffer {
  const buffer = Buffer.alloc(256, 0x20);
  buffer.write('0       ', 0, 'ascii');
  buffer.write('smoke-journey', 8, 'ascii');
  return buffer;
}

function stubPreprocessor(payload: Record<string, unknown>): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = vi.fn(
    async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  ) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

const PACKAGE = {
  schema_version: '0.4',
  preprocessor_version: '0.3.1',
  edf_available: true,
  study_metrics: {
    total_recording_sec: 25920,
    total_recording_hours: 7.2,
    candidate_count_total: 161,
    provisional_odi_per_hour: 22.4,
  },
  candidate_windows: [],
};

function fakeAnalysisOutput(): { findings: Finding[]; report: StructuredReport } {
  const findings: Finding[] = [
    {
      id: `F-${randomUUID()}`,
      claim: 'AHI elevated at 22.4/h consistent with moderate OSA',
      evidence: [{ type: 'edf_metric', source: 'ahi', value: 22.4 }],
      confidence: 'high',
    },
    {
      id: `F-${randomUUID()}`,
      claim: 'Position-dependent component (supine AHI 35.0/h vs lateral 12.4/h)',
      evidence: [
        { type: 'edf_metric', source: 'supine_ahi', value: 35.0 },
        { type: 'edf_metric', source: 'lateral_ahi', value: 12.4 },
      ],
      confidence: 'medium',
    },
  ];
  const report: StructuredReport = {
    summary: 'Adult patient, moderate OSA on HSAT.',
    studyQuality: { totalRecordingTime: '7h 12m', channelIssues: [] },
    respiratoryIndices: { ahi: 22.4 },
    oxygenation: { nadirSpO2: 81 },
    positional: { supineAhi: 35.0, nonSupineAhi: 12.4 },
    impression: 'Moderate OSA, position-dependent. Consider PAP titration.',
    citations: {},
  };
  return { findings, report };
}

describe('full case lifecycle (smoke)', () => {
  let request: ReturnType<typeof supertest>;
  let restore: () => void = () => {};

  beforeEach(() => {
    request = testApp();
  });

  afterEach(() => {
    restore();
  });

  it('upload → review findings → review sections → sign off → audit → delete', async () => {
    restore = stubPreprocessor(PACKAGE);

    const upload = await request
      .post('/api/upload')
      .field('cohort', 'adult')
      .attach('edf', syntheticEdf(), 'study.edf');
    expect(upload.status).toBe(201);
    const { caseId } = upload.body as { caseId: string };

    // Stand in for /analyze: write the analysis straight to the DB.
    const { findings, report } = fakeAnalysisOutput();
    updateCaseFindings(
      caseId,
      findings,
      'narrative',
      'gpt-5.4-mini',
      new Date().toISOString(),
      report,
    );

    // Sign-off is blocked while findings are unreviewed.
    const earlySignoff = await request
      .post(`/api/cases/${caseId}/sign-off`)
      .send({ reviewerName: 'Dr Synthetic' });
    expect(earlySignoff.status).toBe(422);
    expect(earlySignoff.body.unreviewedCount).toBe(2);

    for (const f of findings) {
      const r = await request
        .patch(`/api/cases/${caseId}/findings/${f.id}`)
        .send({ decision: 'confirm' });
      expect(r.status).toBe(200);
    }

    // Still blocked: populated sections are unreviewed.
    const midSignoff = await request
      .post(`/api/cases/${caseId}/sign-off`)
      .send({ reviewerName: 'Dr Synthetic' });
    expect(midSignoff.status).toBe(422);
    expect(midSignoff.body.unreviewedSections).toEqual(
      expect.arrayContaining([
        'summary',
        'respiratoryIndices',
        'oxygenation',
        'positional',
        'impression',
      ]),
    );

    for (const key of midSignoff.body.unreviewedSections as string[]) {
      const r = await request
        .patch(`/api/cases/${caseId}/sections/${key}`)
        .send({ decision: 'confirm' });
      expect(r.status).toBe(200);
    }

    const signoff = await request
      .post(`/api/cases/${caseId}/sign-off`)
      .send({ reviewerName: 'Dr Synthetic' });
    expect(signoff.status).toBe(200);

    const fetched = await request.get(`/api/cases/${caseId}`);
    expect(fetched.body.case.status).toBe('signed_off');

    const audit = await request.get(`/api/cases/${caseId}/audit`);
    expect(audit.status).toBe(200);
    const actions = (audit.body.auditLog as Array<{ action: string }>).map((r) => r.action);
    expect(actions[0]).toBe('case_created');
    expect(actions.filter((a) => a === 'finding_confirm').length).toBe(2);
    expect(actions.filter((a) => a === 'section_confirm').length).toBeGreaterThanOrEqual(5);
    expect(actions.at(-1)).toBe('signed_off');

    // After sign-off, mutating endpoints reject with 409.
    const postSignFinding = await request
      .patch(`/api/cases/${caseId}/findings/${findings[0]!.id}`)
      .send({ decision: 'reject' });
    expect(postSignFinding.status).toBe(409);

    const postSignSection = await request
      .patch(`/api/cases/${caseId}/sections/summary`)
      .send({ decision: 'reject' });
    expect(postSignSection.status).toBe(409);

    const dupSignoff = await request
      .post(`/api/cases/${caseId}/sign-off`)
      .send({ reviewerName: 'Dr Synthetic' });
    expect(dupSignoff.status).toBe(409);

    // Signed-off cases can't be deleted via the API (admin CLI only).
    const del = await request.delete(`/api/cases/${caseId}`);
    expect(del.status).toBe(409);

    const still = await request.get(`/api/cases/${caseId}`);
    expect(still.status).toBe(200);
  });

  it('upload of PDF only flows through sign-off; signed-off delete is blocked', async () => {
    restore = stubPreprocessor({ ...PACKAGE, edf_available: false });

    const upload = await request
      .post('/api/upload')
      .attach('pdf', Buffer.from('%PDF-1.4 fake'), 'report.pdf');
    expect(upload.status).toBe(201);
    const { caseId } = upload.body as { caseId: string };

    const { findings } = fakeAnalysisOutput();
    updateCaseFindings(caseId, findings, null, 'gpt-5.4-mini', new Date().toISOString());

    for (const f of findings) {
      await request.patch(`/api/cases/${caseId}/findings/${f.id}`).send({ decision: 'confirm' });
    }

    // No structured report — sign-off gates on findings only.
    const signoff = await request
      .post(`/api/cases/${caseId}/sign-off`)
      .send({ reviewerName: 'Dr Synthetic' });
    expect(signoff.status).toBe(200);

    const del = await request.delete(`/api/cases/${caseId}`);
    expect(del.status).toBe(409);
  });
});
