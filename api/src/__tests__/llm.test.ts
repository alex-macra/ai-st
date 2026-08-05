// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  configuredApiKey,
  demoModeEnabled,
  extractUsage,
  llmMode,
  syntheticLlmEnabled,
  syntheticResponseFor,
  writeSSE,
} from '../llm.js';
import {
  pass1SystemPrompt,
  pass2SystemPrompt,
  pass3SystemPrompt,
  pass3bReferenceCheckPrompt,
  pass4ActionPlanPrompt,
} from '../prompts.js';

describe('synthetic LLM mode', () => {
  it('is disabled unless explicitly requested', () => {
    expect(syntheticLlmEnabled({ NODE_ENV: 'test' })).toBe(false);
  });

  it('cannot be enabled outside the test environment', () => {
    expect(() =>
      syntheticLlmEnabled({
        NODE_ENV: 'production',
        SOMNOSCRIBE_SYNTHETIC_LLM: 'true',
      }),
    ).toThrow(/only be enabled/);
  });

  it('returns schema-compatible deterministic responses for every pass', () => {
    const pass1 = JSON.parse(syntheticResponseFor(pass1SystemPrompt())) as { findings: unknown[] };
    const pass2 = JSON.parse(syntheticResponseFor(pass2SystemPrompt())) as { citations: object };
    const pass3 = JSON.parse(syntheticResponseFor(pass3SystemPrompt())) as { valid: boolean };
    const pass3b = JSON.parse(syntheticResponseFor(pass3bReferenceCheckPrompt())) as {
      flags: unknown[];
    };
    const pass4 = JSON.parse(syntheticResponseFor(pass4ActionPlanPrompt())) as {
      verifyNext: unknown[];
    };

    expect(pass1.findings).toHaveLength(1);
    expect(pass2.citations).toEqual(expect.objectContaining({ summary: ['F-001'] }));
    expect(pass3.valid).toBe(true);
    expect(pass3b.flags).toEqual([]);
    expect(pass4.verifyNext).toHaveLength(1);
  });

  it('rejects unknown prompts rather than fabricating a response', () => {
    expect(() => syntheticResponseFor('unrecognised')).toThrow(/unknown prompt/);
  });

  it('preserves SSE framing and request correlation', () => {
    const writes: string[] = [];
    writeSSE(
      {
        write: (value: string) => {
          writes.push(value);
        },
      } as never,
      { type: 'done' },
      'request-1',
    );
    expect(writes).toEqual(['data: {"requestId":"request-1","type":"done"}\n\n']);
  });

  it('normalizes both chat and response token usage shapes', () => {
    expect(
      extractUsage({
        prompt_tokens: 10,
        completion_tokens: 4,
        prompt_tokens_details: { cached_tokens: 3 },
      }),
    ).toEqual({ inputTokens: 10, outputTokens: 4, cacheReadTokens: 3 });
    expect(extractUsage({ input_tokens: 8, output_tokens: 2 })).toEqual({
      inputTokens: 8,
      outputTokens: 2,
      cacheReadTokens: 0,
    });
  });
});

describe('model provider configuration', () => {
  // A copied sample config has an empty key; it must not reach the provider.
  it.each([
    ['absent', undefined],
    ['empty', ''],
    ['blank', '   '],
  ])('treats an %s OPENAI_API_KEY as no key at all', (_label, value) => {
    const environment = value === undefined ? {} : { OPENAI_API_KEY: value };
    expect(configuredApiKey(environment)).toBeUndefined();
    expect(llmMode(environment)).toBe('unconfigured');
  });

  it('trims a real key rather than rejecting it', () => {
    expect(configuredApiKey({ OPENAI_API_KEY: ' sk-test \n' })).toBe('sk-test');
    expect(llmMode({ OPENAI_API_KEY: 'sk-test' })).toBe('openai');
  });

  it('prefers the offline demo model over a configured key', () => {
    const environment = { SOMNOSCRIBE_DEMO_MODE: 'true', OPENAI_API_KEY: 'sk-test' };
    expect(demoModeEnabled(environment)).toBe(true);
    expect(llmMode(environment)).toBe('demo');
  });

  it('runs the demo model outside the test environment, unlike the browser-suite switch', () => {
    expect(demoModeEnabled({ NODE_ENV: 'production', SOMNOSCRIBE_DEMO_MODE: 'true' })).toBe(true);
    expect(() =>
      demoModeEnabled({ NODE_ENV: 'production', SOMNOSCRIBE_SYNTHETIC_LLM: 'true' }),
    ).toThrow(/only be enabled/);
  });

  it('is off unless one of the two switches is set', () => {
    expect(demoModeEnabled({ NODE_ENV: 'development' })).toBe(false);
    expect(demoModeEnabled({ SOMNOSCRIBE_DEMO_MODE: 'false' })).toBe(false);
  });
});
