// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import type { CaseStatus } from '../shared/types';
import type { BadgeVariant } from './primitives';

export const CASE_STATUS_VARIANT: Record<CaseStatus, BadgeVariant> = {
  draft: 'default',
  pending_review: 'info',
  signed_off: 'success',
};
