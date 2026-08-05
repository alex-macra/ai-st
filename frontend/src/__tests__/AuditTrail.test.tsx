// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { AuditTrail } from '../components/AuditTrail';
import type { AuditRecord } from '@contracts/types';

vi.mock('../api', () => ({
  getAuditLog: vi.fn(),
}));

import { getAuditLog } from '../api';

const getAuditLogMock = getAuditLog as unknown as ReturnType<typeof vi.fn>;

function makeRecord(overrides: Partial<AuditRecord> = {}): AuditRecord {
  return {
    id: 'audit-1',
    caseId: 'abcdef0123456789',
    action: 'case_created',
    actorId: 'operator',
    createdAt: new Date('2026-01-01T10:00:00Z').toISOString(),
    ...overrides,
  };
}

function resolveWith(records: AuditRecord[]) {
  getAuditLogMock.mockResolvedValue({ auditLog: records, tokenStats: null });
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('AuditTrail', () => {
  it('attributes sign-off to the reviewer name that was typed, not the fixed actor', async () => {
    resolveWith([
      makeRecord({
        id: 'audit-signoff',
        action: 'signed_off',
        actorId: 'operator',
        metadata: { reviewerName: 'Dr Synthetic Reviewer' },
      }),
    ]);
    render(<AuditTrail caseId="abcdef0123456789" />);
    expect(await screen.findByText('Signed off')).toBeVisible();
    expect(screen.getByText('by Dr Synthetic Reviewer')).toBeVisible();
    expect(screen.queryByText('by operator')).not.toBeInTheDocument();
  });

  it('falls back to the actor when no reviewer name was recorded', async () => {
    resolveWith([makeRecord({ action: 'analysis_completed' })]);
    render(<AuditTrail caseId="abcdef0123456789" />);
    expect(await screen.findByText('by operator')).toBeVisible();
  });

  it('humanises report-section decisions and names the section', async () => {
    resolveWith([
      makeRecord({
        id: 'audit-section',
        action: 'section_confirm',
        metadata: { sectionKey: 'impression' },
      }),
    ]);
    render(<AuditTrail caseId="abcdef0123456789" />);
    expect(await screen.findByText('Report section confirmed')).toBeVisible();
    expect(screen.queryByText('section confirm')).not.toBeInTheDocument();
    expect(screen.getByText('impression')).toBeVisible();
  });

  it('renders an unmapped action rather than dropping the record', async () => {
    resolveWith([makeRecord({ action: 'some_future_action' })]);
    render(<AuditTrail caseId="abcdef0123456789" />);
    expect(await screen.findByText('some future action')).toBeVisible();
  });
});
