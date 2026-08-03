import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfidencePopover } from '../components/ConfidencePopover';
import type { Finding } from '../shared/types';

const baseFinding: Finding = {
  id: 'F-test-001',
  claim: 'Test finding',
  confidence: 'medium',
  evidence: [
    { type: 'edf_metric', source: 'channels.spo2.coverage_pct', value: 62 },
    { type: 'pdf_metric', source: 'pdf_metrics.ahi', value: 4.1 },
  ],
};

describe('ConfidencePopover', () => {
  it('renders confidence badge with level text', () => {
    render(<ConfidencePopover finding={baseFinding} />);
    expect(screen.getByRole('button')).toHaveTextContent('medium');
  });

  it('popover hidden initially', () => {
    render(<ConfidencePopover finding={baseFinding} />);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('opens popover on click showing rationale fallback', async () => {
    const user = userEvent.setup();
    render(<ConfidencePopover finding={baseFinding} />);
    await user.click(screen.getByRole('button'));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    expect(screen.getByRole('tooltip')).toHaveTextContent('Supported with some uncertainty');
  });

  it('opens popover showing evidence rows', async () => {
    const user = userEvent.setup();
    render(<ConfidencePopover finding={baseFinding} />);
    await user.click(screen.getByRole('button'));
    expect(screen.getByText('channels.spo2.coverage_pct')).toBeVisible();
  });

  it('closes popover on Escape', async () => {
    const user = userEvent.setup();
    render(<ConfidencePopover finding={baseFinding} />);
    await user.click(screen.getByRole('button'));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('shows confidenceRationale when present', async () => {
    const user = userEvent.setup();
    const finding: Finding = { ...baseFinding, confidenceRationale: 'Airflow coverage 62%' };
    render(<ConfidencePopover finding={finding} />);
    await user.click(screen.getByRole('button'));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Airflow coverage 62%');
  });

  it('shows confidenceFactors chips when present', async () => {
    const user = userEvent.setup();
    const finding: Finding = {
      ...baseFinding,
      confidenceFactors: [{ label: 'airflow coverage', value: '62%', impact: 'negative' }],
    };
    render(<ConfidencePopover finding={finding} />);
    await user.click(screen.getByRole('button'));
    expect(screen.getByRole('tooltip')).toHaveTextContent('airflow coverage: 62%');
  });

  it('degrades gracefully when confidenceFactors absent', async () => {
    const user = userEvent.setup();
    const finding: Finding = { ...baseFinding };
    render(<ConfidencePopover finding={finding} />);
    await user.click(screen.getByRole('button'));
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toBeInTheDocument();
    expect(tooltip.querySelectorAll('.bg-rose-100, .bg-emerald-100')).toHaveLength(0);
  });
});
