// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../app.js';
import { createDemoUser, getCaseById, insertCase } from '../db.js';
import { signJwt } from '../middleware/auth.js';
import type { Case, Finding, StructuredReport } from '../shared/types.js';
import { authedSupertest, mintAuthCookie } from './authHelper.js';

const { mockCreate, mockGetOpenAIClient, mockLlmMode, mockPublicDemoMode } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockGetOpenAIClient: vi.fn(),
  mockLlmMode: vi.fn(() => 'openai'),
  mockPublicDemoMode: vi.fn(() => false),
}));

vi.mock('../llm.js', () => ({
  getOpenAIClient: mockGetOpenAIClient,
  llmMode: mockLlmMode,
  publicDemoModeEnabled: mockPublicDemoMode,
  LlmNotConfiguredError: class LlmNotConfiguredError extends Error {},
  writeSSE: (res: { write: (value: string) => void }, data: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  },
  extractUsage: () => ({ inputTokens: 10, outputTokens: 5, cacheReadTokens: 0 }),
}));

function finding(
  id: string,
  confidence: Finding['confidence'],
  reviewerDecision: NonNullable<Finding['reviewerDecision']>,
): Finding {
  return {
    id,
    claim: `Synthetic ${id} claim.`,
    confidence,
    reviewerDecision,
    evidence: [{ type: 'report_page', source: 'synthetic', value: id }],
  };
}

function parseEvents(body: string): Array<Record<string, unknown>> {
  return body
    .split('\n\n')
    .map((block) => block.replace(/^data: /, '').trim())
    .filter(Boolean)
    .map((block) => JSON.parse(block) as Record<string, unknown>);
}

describe('action-plan review gates', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockGetOpenAIClient.mockReset();
    mockGetOpenAIClient.mockReturnValue({ chat: { completions: { create: mockCreate } } });
    mockLlmMode.mockReset();
    mockLlmMode.mockReturnValue('openai');
    mockPublicDemoMode.mockReset();
    mockPublicDemoMode.mockReturnValue(false);
  });

  it('drops unsupported, rejected, uncertain-priority, and private-evidence output', async () => {
    const auth = mintAuthCookie();
    const report: StructuredReport = {
      summary: 'Synthetic reviewed summary.',
      studyQuality: { channelIssues: [] },
      respiratoryIndices: {},
      oxygenation: {},
      positional: {},
      impression: '',
      citations: { summary: ['F-CONFIRMED'] },
    };
    const now = new Date().toISOString();
    const c: Case = {
      id: randomUUID(),
      studyHash: 'a'.repeat(64),
      name: `action-plan-${randomUUID().slice(0, 8)}`,
      status: 'pending_review',
      cohort: 'adult',
      findings: [
        finding('F-CONFIRMED', 'high', 'confirm'),
        finding('F-UNCERTAIN', 'medium', 'uncertain'),
        finding('F-REJECTED', 'high', 'reject'),
      ],
      structuredReport: report,
      sectionReviews: { summary: { decision: 'confirm', reviewedAt: now } },
      createdBy: auth.userId,
      preprocessorVersion: 'synthetic',
      promptVersion: 'synthetic',
      modelVersion: 'synthetic',
      createdAt: now,
      updatedAt: now,
    };
    insertCase(c);

    mockCreate.mockResolvedValueOnce({
      choices: [
        {
          finish_reason: 'stop',
          message: {
            content: JSON.stringify({
              priorityActions: [
                { action: 'Keep', rationale: 'Supported.', findingIds: ['F-CONFIRMED', 'UNKNOWN'] },
                {
                  action: 'Drop uncertain priority',
                  rationale: 'Not anchored.',
                  findingIds: ['F-UNCERTAIN'],
                },
                { action: 'Drop rejected', rationale: 'Rejected.', findingIds: ['F-REJECTED'] },
              ],
              verifyNext: [
                {
                  action: 'Verify',
                  rationale: 'Uncertain.',
                  findingIds: ['F-UNCERTAIN', 'F-REJECTED'],
                },
                { action: 'Drop unknown', rationale: 'Unsupported.', findingIds: ['UNKNOWN'] },
              ],
              artifactCaveats: [
                { findingId: 'F-CONFIRMED', concern: 'Synthetic caveat.' },
                { findingId: 'F-REJECTED', concern: 'Must be dropped.' },
              ],
              clinicalContext: {
                commonPresentation: 'Synthetic context.',
                rareButRelevant: ['Unsupported condition'],
                treatmentEvidence: 'Private evidence must not cross the public contract.',
              },
              evidenceReferences: [
                { name: 'Private', year: '2026', source: 'Private', relevance: 'None' },
              ],
            }),
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    const response = await authedSupertest(createApp({ rateLimitMax: 1000 }), auth)
      .post(`/api/cases/${c.id}/action-plan`)
      .send({});

    expect(response.status).toBe(200);
    const done = parseEvents(response.text).find((event) => event['type'] === 'done');
    const plan = done?.['actionPlan'] as Record<string, unknown>;
    expect(plan).toMatchObject({
      priorityActions: [{ action: 'Keep', findingIds: ['F-CONFIRMED'] }],
      verifyNext: [{ action: 'Verify', findingIds: ['F-UNCERTAIN'] }],
      artifactCaveats: [{ findingId: 'F-CONFIRMED' }],
      clinicalContext: { commonPresentation: 'Synthetic context.', rareButRelevant: [] },
      analysisMode: 'openai',
    });
    expect(plan['evidenceReferences']).toBeUndefined();
    expect(
      (plan['clinicalContext'] as Record<string, unknown>)['treatmentEvidence'],
    ).toBeUndefined();
  });

  it('does not persist stale output when a review changes during generation', async () => {
    const auth = mintAuthCookie();
    const now = new Date().toISOString();
    const c: Case = {
      id: randomUUID(),
      studyHash: 'b'.repeat(64),
      name: `stale-plan-${randomUUID().slice(0, 8)}`,
      status: 'pending_review',
      cohort: 'adult',
      findings: [finding('F-001', 'high', 'confirm')],
      structuredReport: {
        summary: 'Synthetic reviewed summary.',
        studyQuality: { channelIssues: [] },
        respiratoryIndices: {},
        oxygenation: {},
        positional: {},
        impression: '',
        citations: { summary: ['F-001'] },
      },
      sectionReviews: { summary: { decision: 'confirm', reviewedAt: now } },
      createdBy: auth.userId,
      preprocessorVersion: 'synthetic',
      promptVersion: 'synthetic',
      modelVersion: 'synthetic',
      createdAt: now,
      updatedAt: now,
    };
    insertCase(c);

    let release: ((value: unknown) => void) | undefined;
    const completion = new Promise((resolve) => {
      release = resolve;
    });
    mockCreate.mockImplementationOnce(() => completion);
    const request = authedSupertest(createApp({ rateLimitMax: 1000 }), auth);
    const actionResponse = request
      .post(`/api/cases/${c.id}/action-plan`)
      .send({})
      .then((response) => response);

    await vi.waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    const changed = await request
      .patch(`/api/cases/${c.id}/findings/F-001`)
      .send({ decision: 'uncertain' });
    expect(changed.status).toBe(200);

    release?.({
      choices: [
        {
          finish_reason: 'stop',
          message: {
            content: JSON.stringify({
              priorityActions: [{ action: 'Stale', rationale: 'Stale.', findingIds: ['F-001'] }],
              verifyNext: [],
              artifactCaveats: [],
              clinicalContext: { commonPresentation: 'Stale.', rareButRelevant: [] },
              evidenceReferences: [],
            }),
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    const response = await actionResponse;
    const error = parseEvents(response.text).find((event) => event['type'] === 'error');
    expect(error?.['message']).toMatch(/stale draft was not saved/i);
    expect(getCaseById(c.id)?.actionPlan).toBeUndefined();
    expect(getCaseById(c.id)?.findings[0]?.reviewerDecision).toBe('uncertain');
  });

  it('forces a demo principal action plan onto the offline client before mode capture', async () => {
    mockPublicDemoMode.mockReturnValue(true);
    mockLlmMode.mockReturnValue('openai');
    const user = createDemoUser(new Date(Date.now() + 60_000).toISOString(), 100);
    const now = new Date().toISOString();
    const c: Case = {
      id: randomUUID(),
      studyHash: 'c'.repeat(64),
      name: `demo-plan-${randomUUID().slice(0, 8)}`,
      status: 'pending_review',
      cohort: 'adult',
      findings: [finding('F-001', 'high', 'confirm')],
      structuredReport: {
        summary: 'Synthetic reviewed summary.',
        studyQuality: { channelIssues: [] },
        respiratoryIndices: {},
        oxygenation: {},
        positional: {},
        impression: '',
        citations: { summary: ['F-001'] },
      },
      sectionReviews: { summary: { decision: 'confirm', reviewedAt: now } },
      createdBy: user.id,
      sourceKind: 'demo_synthetic',
      preprocessorVersion: 'synthetic',
      promptVersion: 'synthetic',
      modelVersion: 'somnoscribe-offline-demo',
      createdAt: now,
      updatedAt: now,
    };
    insertCase(c);
    mockCreate.mockResolvedValueOnce({
      model: 'somnoscribe-offline-demo',
      choices: [
        {
          finish_reason: 'stop',
          message: {
            content: JSON.stringify({
              priorityActions: [
                { action: 'Review', rationale: 'Synthetic.', findingIds: ['F-001'] },
              ],
              verifyNext: [],
              artifactCaveats: [],
              clinicalContext: { commonPresentation: 'Synthetic.', rareButRelevant: [] },
            }),
          },
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });

    const response = await supertest(createApp({ rateLimitMax: 1000 }))
      .post(`/api/cases/${c.id}/action-plan`)
      .set('Cookie', `somno_session=${signJwt(user.id, '4h')}`)
      .send({});

    expect(response.status).toBe(200);
    expect(mockGetOpenAIClient).toHaveBeenCalledWith('demo');
    const done = parseEvents(response.text).find((event) => event['type'] === 'done');
    expect((done?.['actionPlan'] as Record<string, unknown>)['analysisMode']).toBe('demo');
  });
});
