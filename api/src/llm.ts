// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import OpenAI from 'openai';
import type { Response } from 'express';
import { OFFLINE_DEMO_MODEL_VERSION } from './shared/types.js';

export { OFFLINE_DEMO_MODEL_VERSION } from './shared/types.js';

let client: { mode: LlmMode; apiKey?: string; value: OpenAI } | undefined;

type Environment = Record<string, string | undefined>;

export function syntheticLlmEnabled(environment: Environment = process.env): boolean {
  if (environment['SOMNOSCRIBE_SYNTHETIC_LLM'] !== 'true') return false;
  if (environment['NODE_ENV'] !== 'test') {
    throw new Error('SOMNOSCRIBE_SYNTHETIC_LLM may only be enabled when NODE_ENV=test');
  }
  return true;
}

/**
 * An empty or blank value is treated as absent. dotenv turns
 * `OPENAI_API_KEY=` in a half-filled `.env` into `''`, which is not a usable
 * credential and must not reach the provider constructor.
 */
export function configuredApiKey(environment: Environment = process.env): string | undefined {
  const key = environment['OPENAI_API_KEY']?.trim();
  return key === undefined || key === '' ? undefined : key;
}

export type LlmMode = 'demo' | 'openai';

/**
 * There is no unconfigured state: an install with no provider credential runs
 * the offline model rather than refusing to analyse. That is what makes the
 * workspace usable straight after `docker compose up`, and every artifact it
 * produces is labelled offline so a reviewer cannot mistake it for a real read.
 * `SOMNOSCRIBE_SYNTHETIC_LLM` is the narrower switch the browser suite uses; it
 * still refuses to run outside `NODE_ENV=test`.
 */
export function llmMode(environment: Environment = process.env): LlmMode {
  if (syntheticLlmEnabled(environment)) return 'demo';
  return configuredApiKey(environment) === undefined ? 'demo' : 'openai';
}

function systemPromptFrom(params: unknown): string {
  const messages =
    (params as { messages?: Array<{ role?: string; content?: unknown }> }).messages ?? [];
  const system = messages.find((message) => message.role === 'system');
  return typeof system?.content === 'string' ? system.content : '';
}

export function syntheticResponseFor(systemPrompt: string): string {
  if (systemPrompt.includes('clinical data extraction engine')) {
    return JSON.stringify({
      findings: [
        {
          id: 'F-001',
          claim:
            'Synthetic artifact is available for workflow verification; no clinical interpretation was performed.',
          confidence: 'high',
          evidence: [
            {
              type: 'report_page',
              source: 'synthetic-e2e-artifact',
              value: 'present',
            },
          ],
        },
      ],
    });
  }

  if (systemPrompt.includes('conservative report builder for home sleep study review')) {
    return JSON.stringify({
      summary:
        'Synthetic workflow verification completed; this output contains no clinical interpretation. (F-001)',
      studyQuality: { channelIssues: ['Synthetic test artifact; not a clinical recording.'] },
      respiratoryIndices: {},
      oxygenation: {},
      positional: {},
      impression: 'Synthetic end-to-end pipeline output for automated testing only. (F-001)',
      citations: {
        summary: ['F-001'],
        studyQuality: ['F-001'],
        impression: ['F-001'],
      },
    });
  }

  if (systemPrompt.includes('reference cross-check validator')) {
    return JSON.stringify({ flags: [] });
  }

  if (systemPrompt.includes('skeptical validator for structured home sleep study report drafts')) {
    return JSON.stringify({ valid: true, rejections: [] });
  }

  if (
    systemPrompt.includes('review-support assistant helping a licensed sleep medicine specialist')
  ) {
    return JSON.stringify({
      priorityActions: [],
      verifyNext: [
        {
          action: 'Confirm that this case is synthetic before reviewing the workflow.',
          rationale: 'The generated artifact is intended only to verify the release smoke path.',
          findingIds: ['F-001'],
        },
      ],
      artifactCaveats: [],
      clinicalContext: {
        commonPresentation: 'Synthetic test mode does not provide clinical context.',
        rareButRelevant: [],
      },
      evidenceReferences: [],
    });
  }

  throw new Error('Synthetic LLM received an unknown prompt');
}

function createSyntheticClient(): OpenAI {
  return {
    chat: {
      completions: {
        create: async (params: unknown) => ({
          id: 'synthetic-completion',
          object: 'chat.completion',
          created: 0,
          model: OFFLINE_DEMO_MODEL_VERSION,
          choices: [
            {
              index: 0,
              finish_reason: 'stop',
              logprobs: null,
              message: {
                role: 'assistant',
                refusal: null,
                content: syntheticResponseFor(systemPromptFrom(params)),
              },
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      },
    },
  } as unknown as OpenAI;
}

/**
 * Resolve a client for one explicitly selected mode. Multi-pass jobs pass the
 * mode captured when they begin, so changing an environment flag cannot turn
 * a demo job into a provider request between passes.
 */
export function getOpenAIClient(mode: LlmMode = llmMode()): OpenAI {
  const apiKey = mode === 'openai' ? configuredApiKey() : undefined;
  if (client?.mode === mode && client.apiKey === apiKey) return client.value;

  // Never reuse an OpenAI client for a demo-mode request (or vice versa).
  const value = mode === 'demo' ? createSyntheticClient() : new OpenAI({ apiKey });
  client = { mode, ...(apiKey ? { apiKey } : {}), value };
  return value;
}

export function writeSSE(res: Response, data: unknown, requestId?: string): void {
  const payload =
    requestId !== undefined && data && typeof data === 'object' && !Array.isArray(data)
      ? { requestId, ...data }
      : data;
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

interface UsageLike {
  prompt_tokens?: number;
  completion_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  input_tokens_details?: { cached_tokens?: number };
}

export function extractUsage(usage: UsageLike | null | undefined): {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
} {
  return {
    inputTokens: usage?.prompt_tokens ?? usage?.input_tokens ?? 0,
    outputTokens: usage?.completion_tokens ?? usage?.output_tokens ?? 0,
    cacheReadTokens:
      usage?.prompt_tokens_details?.cached_tokens ??
      usage?.input_tokens_details?.cached_tokens ??
      0,
  };
}
