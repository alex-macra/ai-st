// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import supertest from 'supertest';
import { randomUUID } from 'node:crypto';
import { OPERATOR } from '../constants.js';
import { activeAnalyses } from '../routes/cases.js';
import { testApp } from './factories.js';

const { mockCreate, mockGetOpenAIClient, mockLlmMode } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockGetOpenAIClient: vi.fn(),
  mockLlmMode: vi.fn(() => 'openai'),
}));

vi.mock('../llm.js', () => ({
  getOpenAIClient: mockGetOpenAIClient,
  llmMode: mockLlmMode,
  LlmNotConfiguredError: class LlmNotConfiguredError extends Error {},
  writeSSE: (
    res: { write: (s: string) => void },
    data: Record<string, unknown>,
    requestId?: string,
  ) => {
    const payload = requestId !== undefined ? { requestId, ...data } : data;
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  },
  extractUsage: (
    u:
      | {
          prompt_tokens?: number;
          completion_tokens?: number;
          prompt_tokens_details?: { cached_tokens?: number };
        }
      | null
      | undefined,
  ) => ({
    inputTokens: u?.prompt_tokens ?? 0,
    outputTokens: u?.completion_tokens ?? 0,
    cacheReadTokens: u?.prompt_tokens_details?.cached_tokens ?? 0,
    cacheWriteTokens: 0,
  }),
}));

function syntheticEdf(): Buffer {
  const buffer = Buffer.alloc(256, 0x20);
  buffer.write('0       ', 0, 'ascii');
  buffer.write('analysis-gate', 8, 'ascii');
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

function parseSseEvents(body: string): Array<Record<string, unknown>> {
  return body
    .split('\n\n')
    .map((chunk) => chunk.replace(/^data: /, '').trim())
    .filter(Boolean)
    .map((s) => JSON.parse(s) as Record<string, unknown>);
}

const DOCS_ONLY_PACKAGE = {
  schema_version: '0.4',
  preprocessor_version: '0.2.0',
  edf_available: false,
  channels: [],
  candidate_windows: [],
  screenshot_count: 0,
  pdf_metrics: { parsed: true, ahi: { value: 18.5, confidence: 'extracted' } },
};

function makePass1Response(): { text: string; findingId: string } {
  const findingId = `F-${randomUUID()}`;
  const text = JSON.stringify({
    findings: [
      {
        id: findingId,
        claim: 'AHI 18.5/h from DOMINO PDF',
        confidence: 'medium',
        confidenceRationale: 'Derived from PDF metric; no raw signal available.',
        confidenceFactors: [
          { label: 'evidence source', value: 'pdf_metric', impact: 'negative' },
          { label: 'AHI borderline', value: 18.5, impact: 'neutral' },
        ],
        evidence: [{ type: 'pdf_metric', source: 'pdf_metrics.ahi', value: 18.5 }],
      },
    ],
  });
  return { text, findingId };
}

function makePass2Response(findingId: string): string {
  return JSON.stringify({
    summary: 'Moderate OSA reported on DOMINO PDF; EDF not available.',
    studyQuality: { channelIssues: [] },
    respiratoryIndices: { ahi: 18.5 },
    oxygenation: {},
    positional: {},
    impression: 'Moderate OSA (pdf-only case). Clinician review required.',
    citations: {
      summary: [findingId],
      respiratoryIndices: [findingId],
      impression: [findingId],
    },
  });
}

const PASS3_OK = JSON.stringify({ valid: true, rejections: [] });

describe('analyze gates', () => {
  let request: ReturnType<typeof supertest>;
  let restore: () => void = () => {};

  beforeEach(() => {
    request = testApp();
    activeAnalyses.clear();
    mockCreate.mockReset();
    mockGetOpenAIClient.mockReset();
    mockGetOpenAIClient.mockReturnValue({ chat: { completions: { create: mockCreate } } });
    mockLlmMode.mockReset();
    mockLlmMode.mockReturnValue('openai');
  });

  afterEach(() => {
    restore();
    activeAnalyses.clear();
  });

  it('allows documents-only analysis and emits a documents_only_mode warning event', async () => {
    restore = stubPreprocessor(DOCS_ONLY_PACKAGE);

    const upload = await request
      .post('/api/upload')
      .attach('pdf', Buffer.from('%PDF-1.4 fake'), 'report.pdf');
    expect(upload.status).toBe(201);
    const { caseId } = upload.body as { caseId: string };

    const { text: pass1Text, findingId } = makePass1Response();
    mockCreate
      .mockImplementationOnce(async () => ({
        model: 'provider-extractor-model',
        choices: [{ message: { content: pass1Text } }],
        usage: { prompt_tokens: 50, completion_tokens: 20 },
      }))
      .mockImplementationOnce(async () => ({
        model: 'provider-report-model',
        choices: [{ message: { content: makePass2Response(findingId) } }],
        usage: { prompt_tokens: 80, completion_tokens: 40 },
      }))
      .mockImplementationOnce(async () => ({
        choices: [{ message: { content: PASS3_OK } }],
        usage: { prompt_tokens: 60, completion_tokens: 10 },
      }));

    const analyze = await request
      .post(`/api/cases/${caseId}/analyze`)
      .set('Accept', 'text/event-stream')
      .send({});

    expect(analyze.status).toBe(200);
    const events = parseSseEvents(analyze.text);

    expect(events.find((e) => e['type'] === 'documents_only_mode')).toBeDefined();
    expect(
      events.find((e) => e['type'] === 'warning' && e['code'] === 'reference_pack_unavailable'),
    ).toBeDefined();
    expect(
      events.find((e) => e['type'] === 'error' && e['code'] === 'documents_only_unsupported'),
    ).toBeUndefined();
    const done = events.find((e) => e['type'] === 'done');
    expect(done).toBeDefined();
    expect(done?.['modelVersion']).toBe('provider-report-model');
    expect(done?.['analysisMode']).toBe('openai');
    const persisted = await request.get(`/api/cases/${caseId}`);
    expect(persisted.body.case).toMatchObject({
      modelVersion: 'provider-report-model',
      analysisMode: 'openai',
    });
    const findings = done?.['findings'] as Array<Record<string, unknown>>;
    expect(findings).toHaveLength(1);
    expect(findings[0]?.['reviewerDecision']).toBeUndefined();

    // The confidence explanation the prompt asks for has to survive schema
    // parsing and persistence, or the popover silently falls back to generic
    // wording. It used to be stripped here.
    expect(findings[0]?.['confidenceRationale']).toBe(
      'Derived from PDF metric; no raw signal available.',
    );
    expect(findings[0]?.['confidenceFactors']).toEqual([
      { label: 'evidence source', value: 'pdf_metric', impact: 'negative' },
      { label: 'AHI borderline', value: 18.5, impact: 'neutral' },
    ]);
    expect(
      (persisted.body.case.findings as Array<Record<string, unknown>>)[0]?.['confidenceFactors'],
    ).toHaveLength(2);
  });

  it('keeps a demo analysis on its captured offline client if the flag changes between passes', async () => {
    restore = stubPreprocessor(DOCS_ONLY_PACKAGE);
    const upload = await request
      .post('/api/upload')
      .attach('pdf', Buffer.from('%PDF-1.4 fake'), 'report.pdf');
    expect(upload.status).toBe(201);
    const { caseId } = upload.body as { caseId: string };

    const { text: pass1Text, findingId } = makePass1Response();
    mockLlmMode.mockReturnValue('demo');
    mockCreate
      .mockImplementationOnce(async () => {
        // This models an operator disabling demo mode after the request has
        // passed auth. A second client lookup here would otherwise use OpenAI.
        mockLlmMode.mockReturnValue('openai');
        return {
          model: 'somnoscribe-offline-demo',
          choices: [{ message: { content: pass1Text } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        };
      })
      .mockImplementationOnce(async () => ({
        model: 'somnoscribe-offline-demo',
        choices: [{ message: { content: makePass2Response(findingId) } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }))
      .mockImplementationOnce(async () => ({
        model: 'somnoscribe-offline-demo',
        choices: [{ message: { content: PASS3_OK } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }));

    const response = await request.post(`/api/cases/${caseId}/analyze`).send({});

    expect(response.status).toBe(200);
    expect(mockGetOpenAIClient).toHaveBeenCalledTimes(1);
    expect(mockGetOpenAIClient).toHaveBeenCalledWith('demo');
    const done = parseSseEvents(response.text).find((event) => event['type'] === 'done');
    expect(done?.['modelVersion']).toBe('somnoscribe-offline-demo');
    expect(done?.['analysisMode']).toBe('demo');
  });

  it('rejects a second concurrent model job with 429', async () => {
    restore = stubPreprocessor({
      schema_version: '0.4',
      edf_available: true,
      channels: [],
      candidate_windows: [],
    });

    const upload = await request.post('/api/upload').attach('edf', syntheticEdf(), 'study.edf');
    expect(upload.status).toBe(201);
    const { caseId } = upload.body as { caseId: string };

    activeAnalyses.add(OPERATOR);

    const res = await request.post(`/api/cases/${caseId}/analyze`).send({});

    expect(res.status).toBe(429);
    expect((res.body as { code?: string }).code).toBe('analysis_in_flight');
    expect(typeof (res.body as { retryAfterSeconds?: number }).retryAfterSeconds).toBe('number');
  });

  // ── Pass 1 response parsing ──────────────────────────────────────────────
  // These tests guard against a recurring failure where Pass 1 returns a
  // response that cannot be parsed, causing a cryptic error or silent hang.

  async function uploadDocCase() {
    restore = stubPreprocessor(DOCS_ONLY_PACKAGE);
    const upload = await request
      .post('/api/upload')
      .attach('pdf', Buffer.from('%PDF-1.4 fake'), 'report.pdf');
    expect(upload.status).toBe(201);
    return (upload.body as { caseId: string }).caseId;
  }

  it('emits a truncation error when Pass 1 finish_reason is length', async () => {
    const caseId = await uploadDocCase();

    mockCreate.mockResolvedValueOnce({
      choices: [
        { finish_reason: 'length', message: { content: '{"findings":[{"id":"F1","claim":"AHI' } },
      ],
      usage: { prompt_tokens: 5000, completion_tokens: 16384 },
    });

    const analyze = await request
      .post(`/api/cases/${caseId}/analyze`)
      .set('Accept', 'text/event-stream')
      .send({});

    const events = parseSseEvents(analyze.text);
    const err = events.find((e) => e['type'] === 'error');
    expect(err).toBeDefined();
    expect((err!['message'] as string).toLowerCase()).toContain('truncated');
    expect(events.find((e) => e['type'] === 'done')).toBeUndefined();
  });

  it('emits a parse error when Pass 1 returns plain text instead of JSON', async () => {
    const caseId = await uploadDocCase();

    mockCreate.mockResolvedValueOnce({
      choices: [{ finish_reason: 'stop', message: { content: 'I cannot process this study.' } }],
      usage: { prompt_tokens: 100, completion_tokens: 10 },
    });

    const analyze = await request
      .post(`/api/cases/${caseId}/analyze`)
      .set('Accept', 'text/event-stream')
      .send({});

    const events = parseSseEvents(analyze.text);
    const err = events.find((e) => e['type'] === 'error');
    expect(err).toBeDefined();
    expect((err!['message'] as string).toLowerCase()).toContain('invalid json');
    expect(events.find((e) => e['type'] === 'done')).toBeUndefined();
  });

  it('emits a parse error when Pass 1 JSON is missing the findings field', async () => {
    const caseId = await uploadDocCase();

    mockCreate.mockResolvedValueOnce({
      choices: [{ finish_reason: 'stop', message: { content: '{"results":[]}' } }],
      usage: { prompt_tokens: 100, completion_tokens: 10 },
    });

    const analyze = await request
      .post(`/api/cases/${caseId}/analyze`)
      .set('Accept', 'text/event-stream')
      .send({});

    const events = parseSseEvents(analyze.text);
    const err = events.find((e) => e['type'] === 'error');
    expect(err).toBeDefined();
    expect((err!['message'] as string).toLowerCase()).toContain('invalid json');
    expect(events.find((e) => e['type'] === 'done')).toBeUndefined();
  });

  it('emits a parse error when Pass 1 message content is null', async () => {
    const caseId = await uploadDocCase();

    mockCreate.mockResolvedValueOnce({
      choices: [{ finish_reason: 'content_filter', message: { content: null } }],
      usage: { prompt_tokens: 100, completion_tokens: 0 },
    });

    const analyze = await request
      .post(`/api/cases/${caseId}/analyze`)
      .set('Accept', 'text/event-stream')
      .send({});

    const events = parseSseEvents(analyze.text);
    const err = events.find((e) => e['type'] === 'error');
    expect(err).toBeDefined();
    expect(events.find((e) => e['type'] === 'done')).toBeUndefined();
  });
});
