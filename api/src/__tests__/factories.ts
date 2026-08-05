// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { createApp } from '../app.js';
import type { Case, Finding, StructuredReport } from '../shared/types.js';

/**
 * Shared fixtures. Every suite used to hand-write its own `makeCase` — seven
 * near-identical copies that drifted whenever the `Case` shape changed. Vary a
 * fixture through `overrides` rather than adding another local copy.
 */

/** A 64-character hex string, the shape the API requires of `studyHash`. */
export function hex64(): string {
  return Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

export function makeCase(overrides: Partial<Case> = {}): Case {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    studyHash: hex64(),
    name: `test-${randomUUID().slice(0, 8)}`,
    status: 'draft',
    cohort: 'adult',
    findings: [],
    preprocessorVersion: '0.1.0',
    promptVersion: 'none',
    modelVersion: 'none',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'F-001',
    claim: 'Synthetic finding for tests.',
    confidence: 'high',
    evidence: [{ type: 'edf_metric', source: 'study_metrics.test', value: 1 }],
    ...overrides,
  };
}

export function emptyStructuredReport(overrides: Partial<StructuredReport> = {}): StructuredReport {
  return {
    summary: '',
    impression: '',
    respiratoryIndices: {},
    oxygenation: {},
    positional: {},
    studyQuality: { channelIssues: [] },
    citations: {},
    ...overrides,
  };
}

/**
 * An app with the rate limiters effectively disabled, plus a supertest client
 * bound to it. Suites that exercise the limiters build their own app instead.
 */
export function testApp(): ReturnType<typeof supertest> {
  return supertest(createApp({ rateLimitMax: 1000, uploadRateLimitMax: 1000 }));
}
