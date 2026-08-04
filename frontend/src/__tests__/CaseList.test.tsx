// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { CaseList } from '../components/CaseList';
import type { Case } from '../shared/types';

// Smoke coverage for the local EmptyState, Badge, and Alert contracts.

vi.mock('../api', () => ({
  getCases: vi.fn(),
  deleteCase: vi.fn(),
  clearCaseAnalysis: vi.fn(),
}));

import { getCases } from '../api';

const getCasesMock = getCases as unknown as ReturnType<typeof vi.fn>;

function makeCase(overrides: Partial<Case> = {}): Case {
  return {
    id: 'abcdef0123456789',
    studyHash: 'hash',
    name: 'Study 001',
    status: 'draft',
    findings: [],
    preprocessorVersion: '1',
    promptVersion: '1',
    modelVersion: '1',
    createdAt: new Date('2026-01-01T10:00:00Z').toISOString(),
    updatedAt: new Date('2026-01-01T10:00:00Z').toISOString(),
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('CaseList UI integration', () => {
  it('renders the EmptyState when there are no cases', async () => {
    getCasesMock.mockResolvedValue([]);
    render(<CaseList onSelect={() => {}} />);
    expect(await screen.findByText('No cases yet')).toBeInTheDocument();
    expect(screen.getByText('Upload a study to get started.')).toBeInTheDocument();
  });

  it('renders a status Badge and case name for each case', async () => {
    getCasesMock.mockResolvedValue([makeCase({ name: 'Study 001', status: 'signed_off' })]);
    render(<CaseList onSelect={() => {}} />);
    expect(await screen.findByText('Study 001')).toBeInTheDocument();
    // status 'signed_off' is rendered with the underscore replaced by a space
    const badge = screen.getByText('signed off');
    expect(badge).toBeInTheDocument();
    // CASE_STATUS_VARIANT maps signed_off to the success treatment.
    expect(badge).toHaveClass('text-green-700');
  });

  it('renders an error Alert when loading fails', async () => {
    getCasesMock.mockRejectedValue(new Error('Network down'));
    render(<CaseList onSelect={() => {}} />);
    expect(await screen.findByText('Network down')).toBeInTheDocument();
  });
});
