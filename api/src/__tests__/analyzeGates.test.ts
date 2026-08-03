import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import supertest from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../app.js';
import { activeAnalyses } from '../routes/cases.js';
import { mintAuthCookie, authedSupertest, type TestAuth } from './authHelper.js';

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock('../llm.js', () => ({
  getOpenAIClient: () => ({ chat: { completions: { create: mockCreate } } }),
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

let auth: TestAuth = undefined as unknown as TestAuth;

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
    const app = createApp({ rateLimitMax: 1000, uploadRateLimitMax: 1000 });
    auth = mintAuthCookie();
    request = authedSupertest(app, auth);
    activeAnalyses.clear();
    mockCreate.mockReset();
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
        choices: [{ message: { content: pass1Text } }],
        usage: { prompt_tokens: 50, completion_tokens: 20 },
      }))
      .mockImplementationOnce(async () => ({
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
    const findings = done?.['findings'] as Array<Record<string, unknown>>;
    expect(findings).toHaveLength(1);
    expect(findings[0]?.['reviewerDecision']).toBeUndefined();
  });

  it('rejects a concurrent model job from the same authenticated user with 429', async () => {
    restore = stubPreprocessor({
      schema_version: '0.4',
      edf_available: true,
      channels: [],
      candidate_windows: [],
    });

    const upload = await request.post('/api/upload').attach('edf', syntheticEdf(), 'study.edf');
    expect(upload.status).toBe(201);
    const { caseId } = upload.body as { caseId: string };

    activeAnalyses.add(auth.userId);

    const res = await request.post(`/api/cases/${caseId}/analyze`).send({});

    expect(res.status).toBe(429);
    expect((res.body as { code?: string }).code).toBe('analysis_in_flight');
    expect(typeof (res.body as { retryAfterSeconds?: number }).retryAfterSeconds).toBe('number');
  });

  it('does not let one account block another account on the same client IP', async () => {
    restore = stubPreprocessor(DOCS_ONLY_PACKAGE);
    const otherAuth = mintAuthCookie();
    const otherRequest = authedSupertest(
      createApp({ rateLimitMax: 1000, uploadRateLimitMax: 1000 }),
      otherAuth,
    );
    const upload = await otherRequest
      .post('/api/upload')
      .attach('pdf', Buffer.from('%PDF-1.4 fake'), 'report.pdf');
    expect(upload.status).toBe(201);

    activeAnalyses.add(auth.userId);
    mockCreate.mockResolvedValueOnce({
      choices: [{ finish_reason: 'stop', message: { content: null } }],
      usage: { prompt_tokens: 1, completion_tokens: 0 },
    });

    const response = await otherRequest
      .post(`/api/cases/${upload.body.caseId as string}/analyze`)
      .send({});

    expect(response.status).toBe(200);
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
