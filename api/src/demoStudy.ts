// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto';
import { MAX_UPLOAD_BYTES, PREPROCESSOR_URL } from './constants.js';

export const DEMO_STUDY_FILENAME = 'somnoscribe-demo-study.edf';

export class DemoStudyUnavailableError extends Error {
  constructor() {
    super('The demo study could not be generated.');
    this.name = 'DemoStudyUnavailableError';
  }
}

async function readBoundedBuffer(response: Response): Promise<Buffer> {
  const declaredLength = response.headers.get('content-length');
  if (
    declaredLength !== null &&
    /^\d+$/.test(declaredLength) &&
    Number(declaredLength) > MAX_UPLOAD_BYTES
  ) {
    await response.body?.cancel();
    throw new DemoStudyUnavailableError();
  }
  if (!response.body) throw new DemoStudyUnavailableError();

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_UPLOAD_BYTES) {
        await reader.cancel();
        throw new DemoStudyUnavailableError();
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, totalBytes);
}

export async function fetchDemoStudy(): Promise<Buffer> {
  const upstream = await fetch(`${PREPROCESSOR_URL}/demo/study.edf`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!upstream.ok) {
    await upstream.body?.cancel();
    throw new DemoStudyUnavailableError();
  }
  return readBoundedBuffer(upstream);
}

export async function fetchDemoStudyHash(): Promise<string> {
  return createHash('sha256')
    .update(await fetchDemoStudy())
    .digest('hex');
}
