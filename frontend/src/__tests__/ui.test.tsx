// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDarkMode } from '../ui/theme';
import { Tabs } from '../ui/navigation';
import { Popover } from '../ui/overlays';
import { SignOffPanel } from '../components/SignOffPanel';
import { ActionPlanView } from '../components/ActionPlanView';
import type { Case } from '@contracts/types';

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.className = '';
  document.documentElement.style.colorScheme = '';
  vi.restoreAllMocks();
});

function ThemeProbe() {
  const { dark, toggle } = useDarkMode();
  return (
    <button type="button" onClick={toggle}>
      {dark ? 'dark' : 'light'}
    </button>
  );
}

function reviewCase(complete: boolean): Case {
  return {
    id: 'synthetic-case',
    studyHash: 'a'.repeat(64),
    name: 'Synthetic case',
    status: 'pending_review',
    cohort: 'adult',
    findings: [
      {
        id: 'F-001',
        claim: 'Synthetic finding.',
        confidence: 'high',
        evidence: [{ type: 'report_page', source: 'synthetic', value: 'present' }],
        ...(complete ? { reviewerDecision: 'confirm' as const } : {}),
      },
    ],
    structuredReport: {
      summary: 'Synthetic summary.',
      studyQuality: { channelIssues: [] },
      respiratoryIndices: {},
      oxygenation: {},
      positional: {},
      impression: '',
      citations: { summary: ['F-001'] },
    },
    ...(complete
      ? {
          sectionReviews: {
            summary: { decision: 'confirm' as const, reviewedAt: '2026-08-03T00:00:00Z' },
          },
        }
      : {}),
    preprocessorVersion: 'synthetic',
    promptVersion: 'synthetic',
    modelVersion: 'synthetic',
    createdAt: '2026-08-03T00:00:00Z',
    updatedAt: '2026-08-03T00:00:00Z',
  };
}

describe('local UI contracts', () => {
  it('persists a manual theme choice and applies it atomically to the document', async () => {
    window.localStorage.setItem('dark-mode', 'true');
    const root = document.documentElement;
    const originalToggle = root.classList.toggle;
    const switchingStates: string[] = [];
    vi.spyOn(root.classList, 'toggle').mockImplementation((token, force) => {
      switchingStates.push(root.dataset.themeSwitching ?? '');
      return originalToggle.call(root.classList, token, force);
    });
    const user = userEvent.setup();
    render(<ThemeProbe />);

    expect(screen.getByRole('button', { name: 'dark' })).toBeVisible();
    await waitFor(() => expect(root).toHaveClass('dark'));
    expect(switchingStates).toContain('true');
    expect(root).not.toHaveAttribute('data-theme-switching');

    await user.click(screen.getByRole('button', { name: 'dark' }));
    expect(window.localStorage.getItem('dark-mode')).toBe('false');
    await waitFor(() => expect(root).not.toHaveClass('dark'));
    expect(root).not.toHaveAttribute('data-theme-switching');
  });

  it('supports tab arrow, Home, and End navigation while skipping disabled tabs', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [active, setActive] = useState('report');
      return (
        <Tabs
          active={active}
          onChange={setActive}
          tabs={[
            { id: 'report', label: 'Report' },
            { id: 'disabled', label: 'Disabled', disabled: true },
            { id: 'findings', label: 'Findings' },
          ]}
        />
      );
    }
    render(<Harness />);

    const report = screen.getByRole('tab', { name: 'Report' });
    report.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Findings' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Findings' })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Home}');
    expect(report).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Findings' })).toHaveFocus();
  });

  it('closes a popover on Escape and returns focus to its trigger', async () => {
    render(
      <Popover label="Details" trigger={<span>Open details</span>}>
        Body
      </Popover>,
    );
    const trigger = screen.getByRole('button', { name: 'Open details' });
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Details' })).toBeVisible();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Details' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('keeps sign-off disabled until every finding and populated section is reviewed', async () => {
    const user = userEvent.setup();
    render(<SignOffPanel c={reviewCase(false)} onSignOff={vi.fn()} />);

    await user.type(screen.getByRole('textbox', { name: 'Reviewer name' }), 'Synthetic Reviewer');

    expect(screen.getByRole('button', { name: 'Sign off' })).toBeDisabled();
    expect(screen.getByText(/complete all finding and report-section reviews/i)).toBeVisible();
  });

  it('enables sign-off after review gates are complete', async () => {
    const user = userEvent.setup();
    const onSignOff = vi.fn(async () => undefined);
    render(<SignOffPanel c={reviewCase(true)} onSignOff={onSignOff} />);

    await user.type(screen.getByRole('textbox', { name: 'Reviewer name' }), 'Synthetic Reviewer');
    await user.click(screen.getByRole('button', { name: 'Sign off' }));

    expect(onSignOff).toHaveBeenCalledWith('Synthetic Reviewer');
  });

  it('exposes action-plan accordion state and its controlled region', async () => {
    const user = userEvent.setup();
    render(
      <ActionPlanView
        findings={[]}
        plan={{
          priorityActions: [],
          verifyNext: [],
          artifactCaveats: [],
          clinicalContext: { commonPresentation: 'Synthetic context.', rareButRelevant: [] },
          generatedAt: '2026-08-03T00:00:00Z',
          modelVersion: 'synthetic',
          promptVersion: 'synthetic',
          tokensIn: 0,
          tokensOut: 0,
        }}
      />,
    );

    const trigger = screen.getByRole('button', { name: /priority actions/i });
    const regionId = trigger.getAttribute('aria-controls');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(regionId).toBeTruthy();
    expect(document.getElementById(regionId!)).toHaveAttribute('role', 'region');

    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById(regionId!)).toHaveAttribute('hidden');
  });
});
