import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDarkMode } from '../ui/theme';
import { Tabs } from '../ui/navigation';
import { AccountPanel, Popover } from '../ui/overlays';
import { SignOffPanel } from '../components/SignOffPanel';
import type { Case } from '../shared/types';

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.className = '';
  document.documentElement.style.colorScheme = '';
  vi.restoreAllMocks();
});

function ThemeProbe() {
  const { dark, toggle } = useDarkMode();
  return <button type="button" onClick={toggle}>{dark ? 'dark' : 'light'}</button>;
}

function reviewCase(complete: boolean): Case {
  return {
    id: 'synthetic-case',
    studyHash: 'a'.repeat(64),
    name: 'Synthetic case',
    status: 'pending_review',
    cohort: 'adult',
    findings: [{
      id: 'F-001',
      claim: 'Synthetic finding.',
      confidence: 'high',
      evidence: [{ type: 'report_page', source: 'synthetic', value: 'present' }],
      ...(complete ? { reviewerDecision: 'confirm' as const } : {}),
    }],
    structuredReport: {
      summary: 'Synthetic summary.',
      studyQuality: { channelIssues: [] },
      respiratoryIndices: {},
      oxygenation: {},
      positional: {},
      impression: '',
      citations: { summary: ['F-001'] },
    },
    ...(complete ? { sectionReviews: { summary: { decision: 'confirm' as const, reviewedAt: '2026-08-03T00:00:00Z' } } } : {}),
    preprocessorVersion: 'synthetic',
    promptVersion: 'synthetic',
    modelVersion: 'synthetic',
    createdAt: '2026-08-03T00:00:00Z',
    updatedAt: '2026-08-03T00:00:00Z',
  };
}

describe('local UI contracts', () => {
  it('persists a manual theme choice and applies it to the document', async () => {
    window.localStorage.setItem('dark-mode', 'true');
    const user = userEvent.setup();
    render(<ThemeProbe />);

    expect(screen.getByRole('button', { name: 'dark' })).toBeVisible();
    await waitFor(() => expect(document.documentElement).toHaveClass('dark'));

    await user.click(screen.getByRole('button', { name: 'dark' }));
    expect(window.localStorage.getItem('dark-mode')).toBe('false');
    await waitFor(() => expect(document.documentElement).not.toHaveClass('dark'));
  });

  it('supports tab arrow, Home, and End navigation while skipping disabled tabs', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [active, setActive] = useState('report');
      return <Tabs
        active={active}
        onChange={setActive}
        tabs={[
          { id: 'report', label: 'Report' },
          { id: 'disabled', label: 'Disabled', disabled: true },
          { id: 'findings', label: 'Findings' },
        ]}
      />;
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

  it('moves focus through the account menu and restores it on Escape', async () => {
    const user = userEvent.setup();
    render(<AccountPanel
      label="reviewer@example.test"
      items={[
        { id: 'profile', label: 'Profile', onClick: vi.fn() },
        { id: 'usage', label: 'Usage', onClick: vi.fn() },
      ]}
      onSignOut={vi.fn()}
    />);

    const trigger = screen.getByRole('button', { name: 'Account menu' });
    await user.click(trigger);
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Profile' })).toHaveFocus());
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Usage' })).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes a popover on Escape and returns focus to its trigger', async () => {
    render(<Popover label="Details" trigger={<span>Open details</span>}>Body</Popover>);
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
});
