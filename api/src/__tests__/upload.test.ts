// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import supertest from 'supertest';
import { enforceUploadContentLength } from '../upload.js';
import { MAX_CASE_PACKAGE_BYTES, MAX_TOTAL_UPLOAD_BYTES, SCREENSHOTS_DIR } from '../constants.js';
import type { Request, Response } from 'express';
import { getCaseById, getAuditLog } from '../db.js';
import { testApp } from './factories.js';

function syntheticEdf(seed = 'synthetic'): Buffer {
  const buffer = Buffer.alloc(256, 0x20);
  buffer.write('0       ', 0, 'ascii');
  buffer.write(seed.slice(0, 64), 8, 'ascii');
  return buffer;
}

function syntheticPng(seed: number): Buffer {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, seed]);
}

// What the stubbed de-identification endpoint hands back. Deliberately different
// from every `syntheticPng`, so a test can tell a cropped screenshot from an
// original by its bytes alone.
const DEIDENTIFIED_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xde, 0xad]);

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
  formData: FormData;
}

function stubPreprocessor(
  payload: Record<string, unknown>,
  status = 200,
  deidentifyStatus = 200,
): { calls: FetchCall[]; restore: () => void } {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;
  const stub = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const form = (init?.body instanceof FormData ? init.body : new FormData()) as FormData;
    calls.push({ url: String(url), init, formData: form });
    // Screenshot de-identification answers with image bytes, not a case package.
    if (String(url).endsWith('/deidentify/screenshot')) {
      return deidentifyStatus === 200
        ? new Response(DEIDENTIFIED_PNG, {
            status: 200,
            headers: { 'content-type': 'image/png' },
          })
        : new Response('', { status: deidentifyStatus });
    }
    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });
  globalThis.fetch = stub as unknown as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function stubPreprocessorError(): { restore: () => void } {
  const original = globalThis.fetch;
  globalThis.fetch = vi.fn(async () => {
    throw new Error('connect ECONNREFUSED');
  }) as unknown as typeof fetch;
  return {
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function stubInvalidPreprocessorJson(): { restore: () => void } {
  const original = globalThis.fetch;
  globalThis.fetch = vi.fn(
    async () =>
      new Response('{', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  ) as unknown as typeof fetch;
  return {
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function isCaseId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]+$/.test(id) && id.length > 0;
}

const PACKAGE = {
  schema_version: '0.4',
  preprocessor_version: '0.3.1',
  edf_available: true,
  study_metrics: {
    total_recording_sec: 28800,
    total_recording_hours: 8.0,
    candidate_count_total: 120,
    provisional_odi_per_hour: 15.0,
  },
  candidate_windows: [],
};

const SCREENSHOT_PACKAGE = {
  schema_version: '0.4',
  preprocessor_version: '0.2.0',
  cohort: 'adult',
  recording: null,
  channels: [],
  missing_channels: [],
  low_quality_channels: [],
  candidate_windows: [],
  candidate_count_total: 0,
  candidate_count_trimmed_from_llm_package: 0,
  pdf_available: false,
  pdf_metrics: null,
  screenshot_filenames: ['a.png', 'b.png'],
  screenshot_count: 2,
  edf_available: false,
};

describe('POST /api/upload', () => {
  let request: ReturnType<typeof supertest>;
  let restore: () => void = () => {};

  beforeEach(() => {
    request = testApp();
  });

  afterEach(() => {
    restore();
  });

  it('rejects with 400 when no files are attached', async () => {
    const res = await request.post('/api/upload').field('cohort', 'adult');
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/at least one/i);
    expect(typeof res.body.code).toBe('string');
  });

  it('rejects an oversized declared request before multipart parsing', () => {
    const req = { get: vi.fn(() => String(MAX_TOTAL_UPLOAD_BYTES + 1)) } as unknown as Request;
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const res = { locals: { requestId: 'test-request' }, status } as unknown as Response;
    const next = vi.fn();

    enforceUploadContentLength(req, res, next);

    expect(status).toHaveBeenCalledWith(413);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: 'UPLOAD_TOO_LARGE' }));
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects an oversized preprocessor case package', async () => {
    const stub = stubPreprocessor({
      ...PACKAGE,
      padding: 'x'.repeat(MAX_CASE_PACKAGE_BYTES),
    });
    restore = stub.restore;

    const res = await request.post('/api/upload').attach('edf', syntheticEdf(), 'study.edf');

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('PREPROCESSOR_RESPONSE_TOO_LARGE');
  });

  it('rejects with 400 when cohort metadata is invalid', async () => {
    const res = await request
      .post('/api/upload')
      .field('cohort', 'cat')
      .attach('edf', syntheticEdf(), 'study.edf');
    expect(res.status).toBe(400);
    expect(typeof res.body.code).toBe('string');
    expect(typeof res.body.message).toBe('string');
  });

  it('returns 502 when preprocessor responds non-2xx', async () => {
    const stub = stubPreprocessor({ detail: 'EDF parse failed' }, 500);
    restore = stub.restore;
    const res = await request
      .post('/api/upload')
      .field('cohort', 'adult')
      .attach('edf', syntheticEdf(), 'study.edf');
    expect(res.status).toBe(502);
    expect(res.body.message).toMatch(/preprocessing/i);
  });

  it('returns 502 when preprocessor is unreachable', async () => {
    const stub = stubPreprocessorError();
    restore = stub.restore;
    const res = await request
      .post('/api/upload')
      .field('cohort', 'adult')
      .attach('edf', syntheticEdf(), 'study.edf');
    expect(res.status).toBe(502);
    expect(res.body.message).toMatch(/unreachable/i);
  });

  it('returns a schema error when preprocessor JSON is malformed', async () => {
    const stub = stubInvalidPreprocessorJson();
    restore = stub.restore;
    const res = await request.post('/api/upload').attach('edf', syntheticEdf(), 'study.edf');
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('PREPROCESSOR_SCHEMA_MISMATCH');
  });

  it('creates an EDF-only case with hashedArtifact=edf in audit', async () => {
    const stub = stubPreprocessor(PACKAGE);
    restore = stub.restore;

    const res = await request
      .post('/api/upload')
      .field('cohort', 'adult')
      .attach('edf', syntheticEdf(), 'study.edf');

    expect(res.status).toBe(201);
    const { caseId, studyHash } = res.body as { caseId: string; studyHash: string };
    expect(isCaseId(caseId)).toBe(true);
    expect(studyHash).toMatch(/^[a-f0-9]{64}$/);

    const created = getCaseById(caseId);
    expect(created).toBeDefined();
    expect(created?.status).toBe('draft');
    expect(created?.preprocessorVersion).toBe('0.3.1');

    const log = getAuditLog(caseId);
    const created_entry = log.find((r) => r.action === 'case_created');
    expect(created_entry?.metadata?.['hashedArtifact']).toBe('edf');
    expect(created_entry?.metadata?.['edfAttached']).toBe(true);
    expect(created_entry?.metadata?.['pdfAttached']).toBe(false);
    expect(created_entry?.metadata?.['screenshotCount']).toBe(0);
  });

  it('creates a PDF-only case with hashedArtifact=pdf', async () => {
    const stub = stubPreprocessor(PACKAGE);
    restore = stub.restore;

    const res = await request
      .post('/api/upload')
      .attach('pdf', Buffer.from('%PDF-1.4 fake'), 'report.pdf');

    expect(res.status).toBe(201);
    const { caseId } = res.body as { caseId: string };
    expect(isCaseId(caseId)).toBe(true);

    const stored = getCaseById(caseId);
    expect(stored).toBeDefined();
    expect(stored?.preprocessorVersion).toBe('0.3.1');

    const log = getAuditLog(caseId);
    const created = log.find((r) => r.action === 'case_created');
    expect(created?.metadata?.['hashedArtifact']).toBe('pdf');
    expect(created?.metadata?.['pdfAttached']).toBe(true);
    expect(created?.metadata?.['edfAttached']).toBe(false);
  });

  it('creates a screenshots-only case with hashedArtifact=screenshot', async () => {
    const stub = stubPreprocessor(SCREENSHOT_PACKAGE);
    restore = stub.restore;

    const res = await request
      .post('/api/upload')
      .attach('screenshots', syntheticPng(1), 'a.png')
      .attach('screenshots', syntheticPng(2), 'b.png');

    expect(res.status).toBe(201);
    const { caseId } = res.body as { caseId: string };

    const log = getAuditLog(caseId);
    const created = log.find((r) => r.action === 'case_created');
    expect(created?.metadata?.['hashedArtifact']).toBe('screenshot');
    expect(created?.metadata?.['screenshotCount']).toBe(2);
    expect(created?.metadata?.['edfAttached']).toBe(false);

    const stored = getCaseById(caseId);
    const pkg = JSON.parse(stored?.casePackage ?? '{}') as Record<string, unknown>;
    expect(pkg['edf_available']).toBe(false);
    expect(pkg['screenshot_count']).toBe(2);
  });

  it('stores the de-identified screenshot rather than the uploaded bytes', async () => {
    const stub = stubPreprocessor(SCREENSHOT_PACKAGE);
    restore = stub.restore;

    const res = await request
      .post('/api/upload')
      .attach('screenshots', syntheticPng(1), 'a.png')
      .attach('screenshots', syntheticPng(2), 'b.png');

    expect(res.status).toBe(201);
    const { caseId } = res.body as { caseId: string };

    expect(stub.calls.filter((c) => c.url.endsWith('/deidentify/screenshot'))).toHaveLength(2);

    // On disk: what the reviewer sees and what analyze.ts sends to the model.
    const directory = path.join(SCREENSHOTS_DIR, caseId);
    const stored = readdirSync(directory);
    expect(stored).toHaveLength(2);
    for (const name of stored) {
      const bytes = readFileSync(path.join(directory, name));
      expect(bytes.equals(DEIDENTIFIED_PNG)).toBe(true);
    }

    // And nothing uncropped is forwarded to /ingest either.
    const ingest = stub.calls.find((c) => c.url.endsWith('/ingest'));
    const forwarded = ingest?.formData.getAll('screenshots') ?? [];
    expect(forwarded).toHaveLength(2);
    for (const blob of forwarded) {
      const bytes = Buffer.from(await (blob as Blob).arrayBuffer());
      expect(bytes.equals(DEIDENTIFIED_PNG)).toBe(true);
    }
  });

  it('rejects the upload when a screenshot cannot be de-identified', async () => {
    const stub = stubPreprocessor(SCREENSHOT_PACKAGE, 200, 422);
    restore = stub.restore;

    const res = await request.post('/api/upload').attach('screenshots', syntheticPng(3), 'a.png');

    expect(res.status).toBe(502);
    expect(res.body.code).toBe('SCREENSHOT_DEIDENTIFY_FAILED');
    // Failing closed: the original never reaches ingestion or the case store.
    expect(stub.calls.some((c) => c.url.endsWith('/ingest'))).toBe(false);
  });

  it('produces a deterministic studyHash for the same EDF bytes', async () => {
    const stub = stubPreprocessor(PACKAGE);
    restore = stub.restore;

    const r1 = await request.post('/api/upload').attach('edf', syntheticEdf('identical'), 'a.edf');
    const r2 = await request.post('/api/upload').attach('edf', syntheticEdf('identical'), 'b.edf');

    expect(r1.body.studyHash).toBe(r2.body.studyHash);
    expect(r1.body.caseId).not.toBe(r2.body.caseId);

    const case1 = getCaseById(r1.body.caseId);
    const case2 = getCaseById(r2.body.caseId);
    expect(case1).toBeDefined();
    expect(case2).toBeDefined();
    expect(case1?.studyHash).toBe(case2?.studyHash);
  });

  it('sequences case names with -01, -02 when basenames collide', async () => {
    const stub = stubPreprocessor(PACKAGE);
    restore = stub.restore;

    const r1 = await request
      .post('/api/upload')
      .attach('edf', syntheticEdf('first'), 'example_01.edf');
    const r2 = await request
      .post('/api/upload')
      .attach('edf', syntheticEdf('second'), 'example_01.edf');

    expect(r1.body.name).toMatch(/-study-\d{2}$/);
    expect(r2.body.name).toMatch(/-study-\d{2}$/);
    const firstSequence = Number((r1.body.name as string).slice(-2));
    const secondSequence = Number((r2.body.name as string).slice(-2));
    expect(secondSequence).toBe(firstSequence + 1);

    const case1 = getCaseById(r1.body.caseId);
    const case2 = getCaseById(r2.body.caseId);
    expect(case1).toBeDefined();
    expect(case2).toBeDefined();
    expect(case1?.name).toBe(r1.body.name);
    expect(case2?.name).toBe(r2.body.name);
  });

  it('returns valid case with pediatric cohort when provided', async () => {
    const stub = stubPreprocessor(PACKAGE);
    restore = stub.restore;

    const res = await request
      .post('/api/upload')
      .field('cohort', 'pediatric')
      .attach('edf', syntheticEdf('pediatric'), 'test.edf');

    expect(res.status).toBe(201);
    expect(isCaseId(res.body.caseId)).toBe(true);
    expect(getCaseById(res.body.caseId)).toBeDefined();
  });

  it('rejects an EDF extension with invalid magic bytes', async () => {
    const res = await request
      .post('/api/upload')
      .attach('edf', Buffer.from('not an edf'), 'study.edf');
    expect(res.status).toBe(415);
    expect(res.body.code).toBe('INVALID_FILE_SIGNATURE');
  });

  it('removes its private per-request upload directory after processing', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'somnoscribe-upload-test-'));
    const previous = process.env['UPLOAD_TMP_DIR'];
    process.env['UPLOAD_TMP_DIR'] = root;
    const stub = stubPreprocessor(PACKAGE);
    restore = stub.restore;

    try {
      const response = await request
        .post('/api/upload')
        .attach('edf', syntheticEdf('cleanup'), 'study.edf');
      expect(response.status).toBe(201);
      await vi.waitFor(() => expect(readdirSync(root)).toEqual([]));
    } finally {
      if (previous === undefined) delete process.env['UPLOAD_TMP_DIR'];
      else process.env['UPLOAD_TMP_DIR'] = previous;
      rmSync(root, { recursive: true, force: true });
    }
  });
});
