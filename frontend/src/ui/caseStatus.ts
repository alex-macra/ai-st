import type { CaseStatus } from '../shared/types';
import type { BadgeVariant } from './primitives';

export const CASE_STATUS_VARIANT: Record<CaseStatus, BadgeVariant> = {
  draft: 'default',
  pending_review: 'info',
  signed_off: 'success',
};
