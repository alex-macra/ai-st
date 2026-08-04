// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import OpenAI from 'openai';
import type { Response } from 'express';

let client: OpenAI | undefined;

type Environment = Record<string, string | undefined>;

export function syntheticLlmEnabled(environment: Environment = process.env): boolean {
  if (environment['SOMNOSCRIBE_SYNTHETIC_LLM'] !== 'true') return false;
  if (environment['NODE_ENV'] !== 'test') {
    throw new Error('SOMNOSCRIBE_SYNTHETIC_LLM may only be enabled when NODE_ENV=test');
  }
  return true;
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
          model: 'synthetic-test-model',
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

export function getOpenAIClient(): OpenAI {
  client ??= syntheticLlmEnabled()
    ? createSyntheticClient()
    : new OpenAI({ apiKey: process.env['OPENAI_API_KEY'] ?? 'not-configured' });
  return client;
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
