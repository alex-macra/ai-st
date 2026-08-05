// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import { it, expect } from 'vitest';
import { pass1SystemPrompt, pass2SystemPrompt } from '../prompts.js';
import { PROMPT_VERSION } from '../constants.js';

it('pass1SystemPrompt() contains confidenceFactors in schema', () => {
  expect(pass1SystemPrompt()).toContain('"confidenceFactors"');
});

it('pass1SystemPrompt() contains confidenceRationale in schema', () => {
  expect(pass1SystemPrompt()).toContain('"confidenceRationale"');
});

it('PROMPT_VERSION is 2.0.0', () => {
  expect(PROMPT_VERSION).toBe('2.0.0');
});

it('pass1SystemPrompt() instructs model to emit 1–4 factors', () => {
  expect(pass1SystemPrompt()).toContain('1–4');
});

// The Pass 2 prompt schema and the zod parser must share these top-level keys;
// pinning them makes a prompt/parser drift fail in CI instead of at runtime.
const PASS2_REQUIRED_KEYS = [
  'summary',
  'studyQuality',
  'respiratoryIndices',
  'oxygenation',
  'positional',
  'snoring',
  'cardiac',
  'impression',
  'citations',
];

it('pass2SystemPrompt() declares each top-level key the parser expects', () => {
  const prompt = pass2SystemPrompt('adult');
  for (const key of PASS2_REQUIRED_KEYS) {
    expect(prompt, `Pass 2 prompt missing key "${key}"`).toContain(`"${key}"`);
  }
});

it('pass2SystemPrompt() pediatric variant adds pediatric framing rules', () => {
  const prompt = pass2SystemPrompt('pediatric');
  expect(prompt).toContain('pAHI');
  expect(prompt).toContain('Do not compare');
  expect(prompt).toContain('validated finding');
});

it('pass2SystemPrompt() does not bundle external clinical source material', () => {
  const prompt = pass2SystemPrompt('adult');
  expect(prompt).toContain('clinician interpretation is required');
  expect(prompt).toContain('Do not introduce a threshold');
});
