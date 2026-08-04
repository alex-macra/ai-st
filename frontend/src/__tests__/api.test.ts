// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { streamAnalysis } from '../api';
import type { AnalysisEvent } from '../shared/types';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('analysis streaming', () => {
  it('treats an aborted request as an intentional stop', async () => {
    const abortError = new DOMException('aborted', 'AbortError');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError));
    const events: AnalysisEvent[] = [];

    await expect(
      streamAnalysis('case-1', (event) => events.push(event), new AbortController().signal),
    ).resolves.toBeUndefined();
    expect(events).toEqual([]);
  });

  it('turns HTTP failures into the existing SSE error contract', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'Analysis unavailable' }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const events: AnalysisEvent[] = [];

    await streamAnalysis('case-1', (event) => events.push(event));

    expect(events).toEqual([{ type: 'error', message: 'Analysis unavailable' }]);
  });

  it('reports an interrupted stream with a safe retry message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    const events: AnalysisEvent[] = [];

    await streamAnalysis('case-1', (event) => events.push(event));

    expect(events).toEqual([
      { type: 'error', message: 'Connection interrupted - please try again.' },
    ]);
  });
});
