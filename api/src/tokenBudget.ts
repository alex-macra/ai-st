// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import {
  MAX_INPUT_TOKENS,
  TOKEN_BASE_PACKAGE,
  TOKEN_PER_CANDIDATE,
  TOKEN_PER_IMAGE,
  MAX_IMAGE_CANDIDATES,
} from './constants.js';
import { logger } from './logger.js';

export interface CandidateWindow {
  label: string;
  channel: string;
  start_sec: number;
  end_sec: number;
  duration_sec: number;
  magnitude: number;
  priority_score: number;
  dedupe_key: string;
  chart_path: string | null;
  notes: string[];
}

export interface BudgetResult {
  textCandidates: CandidateWindow[];
  imageCandidates: CandidateWindow[];
  estimatedTokens: number;
  droppedCount: number;
}

function deduplicateByKey(candidates: CandidateWindow[]): CandidateWindow[] {
  const seen = new Map<string, CandidateWindow>();
  for (const c of candidates) {
    const existing = seen.get(c.dedupe_key);
    if (!existing || c.priority_score > existing.priority_score) {
      seen.set(c.dedupe_key, c);
    }
  }
  // Return in priority order
  return [...seen.values()].sort((a, b) => b.priority_score - a.priority_score);
}

export function selectCandidates(
  candidates: CandidateWindow[],
  caseId: string,
  baseTokens: number = TOKEN_BASE_PACKAGE,
): BudgetResult {
  const budget = MAX_INPUT_TOKENS - baseTokens;

  // 1. Sort by priority descending (should already be sorted, but be defensive)
  const sorted = [...candidates].sort((a, b) => b.priority_score - a.priority_score);

  // 2. Deduplicate by dedupe_key (keep highest-scored per key)
  const deduped = deduplicateByKey(sorted);

  // 3. Assign image slots to top candidates that have a chart_path (max MAX_IMAGE_CANDIDATES)
  const imageCandidates: CandidateWindow[] = [];
  const textOnly: CandidateWindow[] = [];
  for (const c of deduped) {
    if (c.chart_path && imageCandidates.length < MAX_IMAGE_CANDIDATES) {
      imageCandidates.push(c);
    } else {
      textOnly.push(c);
    }
  }

  // 4. Compute token budget: images cost more; all candidates also appear as text summaries
  const allText = [...imageCandidates, ...textOnly];
  let tokenEstimate =
    baseTokens + allText.length * TOKEN_PER_CANDIDATE + imageCandidates.length * TOKEN_PER_IMAGE;

  // 5. Drop lowest-priority text candidates if still over budget
  let dropped = 0;
  while (tokenEstimate > budget && textOnly.length > 0) {
    textOnly.pop();
    dropped++;
    tokenEstimate -= TOKEN_PER_CANDIDATE;
  }

  const textCandidates = [...imageCandidates, ...textOnly];

  if (dropped > 0) {
    logger.warn(
      { caseId, dropped, estimatedTokens: tokenEstimate },
      'token_budget_candidates_dropped',
    );
  }

  logger.info(
    {
      caseId,
      total: candidates.length,
      afterDedup: deduped.length,
      textCandidates: textCandidates.length,
      imageCandidates: imageCandidates.length,
      estimatedTokens: tokenEstimate,
      dropped,
    },
    'token_budget_selected',
  );

  return { textCandidates, imageCandidates, estimatedTokens: tokenEstimate, droppedCount: dropped };
}
