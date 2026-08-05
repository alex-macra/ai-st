// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import { OFFLINE_DEMO_MODEL_VERSION } from '@contracts/types';
import type { ActionPlan, Case } from '@contracts/types';

/** Input provenance is independent from the model that later drafts text. */
export function isSyntheticInput(c: Case): boolean {
  return c.sourceKind === 'demo_synthetic';
}

/** A report may be offline even when its uploaded study was real. */
export function isOfflineReport(c: Case): boolean {
  return (
    c.analysisMode === 'demo' ||
    (c.modelVersion === OFFLINE_DEMO_MODEL_VERSION &&
      (c.structuredReport !== undefined || c.narrative !== undefined))
  );
}

/** Plans are generated separately and therefore retain their own provenance. */
export function isOfflineActionPlan(plan: ActionPlan | undefined): boolean {
  return plan?.analysisMode === 'demo' || plan?.modelVersion === OFFLINE_DEMO_MODEL_VERSION;
}
