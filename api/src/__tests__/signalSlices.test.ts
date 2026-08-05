// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import supertest from 'supertest';
import { randomUUID } from 'node:crypto';

// Filesystem calls are stubbed so tests don't need a real SLICES_DIR on disk.
// The Python integration tests cover actual file writing end-to-end.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
    realpath: vi.fn(async (filePath: string) => filePath),
    lstat: vi.fn().mockResolvedValue({
      isSymbolicLink: () => false,
      isFile: () => true,
      size: 1024,
    }),
  };
});

import { lstat, readFile, realpath } from 'node:fs/promises';
import { createApp } from '../app.js';
import { insertCase } from '../db.js';
import type { Case } from '../shared/types.js';
import { mintAuthCookie, authedSupertest, type TestAuth } from './authHelper.js';

let auth: TestAuth = undefined as unknown as TestAuth;

function createHash64(): string {
  return Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

function makeCase(overrides: Partial<Case> = {}): Case {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    studyHash: createHash64(),
    name: `test-${randomUUID().slice(0, 8)}`,
    status: 'draft',
    cohort: 'adult',
    findings: [],
    createdBy: auth.userId,
    preprocessorVersion: '0.3.1',
    promptVersion: 'none',
    modelVersion: 'none',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

const SNAKE_SLICES = [
  {
    event_id: 'ev_000',
    type: 'provisional_flow_reduction',
    start_sec: 40.0,
    end_sec: 55.0,
    magnitude: 0.65,
    tags: [],
    signal_slices: [
      {
        channel: 'Airflow',
        window_start_sec: 10.0,
        window_end_sec: 85.0,
        samples: [0.12, 0.09, null, 0.05],
      },
      {
        channel: 'SpO2',
        window_start_sec: 10.0,
        window_end_sec: 85.0,
        samples: [96.0, 95.5, 94.0],
      },
    ],
  },
];

describe('GET /api/cases/:id/signal-slices', () => {
  let request: ReturnType<typeof supertest>;

  beforeEach(() => {
    const app = createApp({ rateLimitMax: 1000, uploadRateLimitMax: 1000 });
    auth = mintAuthCookie();
    request = authedSupertest(app, auth);
    vi.mocked(realpath).mockImplementation(async (filePath) => String(filePath));
    vi.mocked(lstat).mockResolvedValue({
      isSymbolicLink: () => false,
      isFile: () => true,
      size: 1024,
    } as never);
    // Default: readFile rejects — simulates no sidecar file on disk.
    vi.mocked(readFile).mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 for an unknown case id', async () => {
    const res = await request.get('/api/cases/does-not-exist/signal-slices');
    expect(res.status).toBe(404);
  });

  it('returns empty slices array when no sidecar file exists', async () => {
    const c = makeCase();
    insertCase(c);

    const res = await request.get(`/api/cases/${c.id}/signal-slices`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ slices: [] });
  });

  it('converts snake_case sidecar JSON to camelCase EventSlice objects', async () => {
    const c = makeCase();
    insertCase(c);
    vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(SNAKE_SLICES));

    const res = await request.get(`/api/cases/${c.id}/signal-slices`);
    expect(res.status).toBe(200);

    const { slices } = res.body as { slices: unknown[] };
    expect(slices).toHaveLength(1);

    const ev = slices[0] as Record<string, unknown>;
    expect(ev['eventId']).toBe('ev_000');
    expect(ev['type']).toBe('provisional_flow_reduction');
    expect(ev['startSec']).toBe(40.0);
    expect(ev['endSec']).toBe(55.0);
    expect(ev['magnitude']).toBe(0.65);
    expect(ev['tags']).toEqual([]);

    const signals = ev['signalSlices'] as Array<Record<string, unknown>>;
    expect(signals).toHaveLength(2);
    expect(signals[0]!['channel']).toBe('Airflow');
    expect(signals[0]!['windowStartSec']).toBe(10.0);
    expect(signals[0]!['windowEndSec']).toBe(85.0);
    expect(signals[0]!['samples']).toEqual([0.12, 0.09, null, 0.05]);
    expect(signals[1]!['channel']).toBe('SpO2');
    expect(signals[1]!['samples']).toEqual([96.0, 95.5, 94.0]);
  });

  it('is scoped to the authenticated user — returns 404 for another users case', async () => {
    const c = makeCase();
    insertCase(c);
    vi.mocked(readFile).mockResolvedValue(JSON.stringify(SNAKE_SLICES));

    const otherAuth = mintAuthCookie();
    const otherRequest = authedSupertest(
      createApp({ rateLimitMax: 1000, uploadRateLimitMax: 1000 }),
      otherAuth,
    );
    const res = await otherRequest.get(`/api/cases/${c.id}/signal-slices`);
    expect(res.status).toBe(404);
  });

  it('rejects oversized and symbolic-link sidecars', async () => {
    const c = makeCase();
    insertCase(c);

    vi.mocked(lstat).mockResolvedValueOnce({
      isSymbolicLink: () => false,
      isFile: () => true,
      size: 26 * 1024 * 1024,
    } as never);
    expect((await request.get(`/api/cases/${c.id}/signal-slices`)).body).toEqual({ slices: [] });

    vi.mocked(lstat).mockResolvedValueOnce({
      isSymbolicLink: () => true,
      isFile: () => true,
      size: 1024,
    } as never);
    expect((await request.get(`/api/cases/${c.id}/signal-slices`)).body).toEqual({ slices: [] });
    expect(readFile).not.toHaveBeenCalled();
  });
});
