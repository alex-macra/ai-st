import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PrintableReport } from '../components/PrintableReport';
import type { Case, EventSlice, Finding, StructuredReport } from '../shared/types';

vi.mock('../api', () => ({
  getAuditLog: vi.fn(async () => ({ auditLog: [], tokenStats: null })),
  fetchSignalSlices: vi.fn(async () => []),
}));

function fullReport(): StructuredReport {
  return {
    summary: 'Synthetic adult example with a moderate index on HSAT.',
    studyQuality: {
      totalRecordingTime: '7h 12m',
      analysableTime: '6h 50m',
      channelIssues: ['SpO₂ dropouts in last hour']
    },
    respiratoryIndices: { ahi: 22.4, rei: 19.1, odi3: 18.5 },
    oxygenation: { meanSpO2: 93, nadirSpO2: 81, t90Pct: 6.2 },
    positional: { supineAhi: 35.0, nonSupineAhi: 12.4, supineTimePct: 38.0 },
    snoring: { snoreTimePct: 22.1, snoreIndex: 140 },
    cardiac: { meanHr: 68, minHr: 51, maxHr: 92 },
    impression: 'Moderate OSA, position-dependent. Consider PAP titration.',
    citations: { summary: ['F-001'], impression: ['F-001'] }
  };
}

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'F-abc',
    claim: 'AHI elevated at 22.4/h consistent with moderate OSA',
    evidence: [
      { type: 'edf_metric', source: 'ahi', value: 22.4 },
      { type: 'event_table', source: 'apnea_events', value: 87 }
    ],
    confidence: 'high',
    reviewerDecision: 'confirm',
    ...overrides
  };
}

function makeCase(overrides: Partial<Case> = {}): Case {
  return {
    id: 'case-print-1',
    studyHash: 'a'.repeat(64),
    name: '2026-04-30-093000-study-01',
    status: 'signed_off',
    findings: [makeFinding()],
    structuredReport: fullReport(),
    sectionReviews: {
      summary: { decision: 'confirm', reviewedAt: '2026-04-30T10:00:00Z' }
    },
    preprocessorVersion: '0.3.1',
    promptVersion: '1.2.0',
    modelVersion: 'gpt-5.4-mini',
    createdAt: '2026-04-30T09:00:00Z',
    updatedAt: '2026-04-30T10:00:00Z',
    ...overrides
  };
}

describe('<PrintableReport />', () => {
  it('renders the header with case name and model version', () => {
    render(<PrintableReport signalSlices={[]} c={makeCase()} />);
    expect(screen.getByText('Sleep Study Analysis Report')).toBeInTheDocument();
    expect(screen.getByText('2026-04-30-093000-study-01')).toBeInTheDocument();
    expect(screen.getByText(/gpt-5\.4-mini.*prompt 1\.2\.0/)).toBeInTheDocument();
  });

  it('renders all populated structured-report sections', () => {
    render(<PrintableReport signalSlices={[]} c={makeCase()} />);
    for (const heading of [
      'Clinical Summary',
      'Respiratory Analysis',
      'O₂ Saturation',
      'Positional Analysis',
      'Snore Analysis',
      'Heart Rate',
    ]) {
      expect(screen.getByText(heading)).toBeInTheDocument();
    }
    expect(screen.getByText(/AHI = 22\.4\/h/)).toBeInTheDocument();
    expect(screen.getByText('81%')).toBeInTheDocument();
  });

  it('omits optional sections when those fields are absent', () => {
    const c = makeCase({
      structuredReport: (() => {
        const { snoring: _s, cardiac: _c, ...rest } = fullReport();
        return { ...rest, studyQuality: { channelIssues: [] } };
      })()
    });
    render(<PrintableReport signalSlices={[]} c={c} />);
    expect(screen.queryByText('Snore Analysis')).not.toBeInTheDocument();
    expect(screen.queryByText('Heart Rate')).not.toBeInTheDocument();
    expect(screen.queryByText('Study Quality')).not.toBeInTheDocument();
  });

  it('renders confirmed findings in the evidence appendix', () => {
    render(<PrintableReport signalSlices={[]} c={makeCase()} />);
    expect(screen.getByText(/Evidence Appendix/)).toBeInTheDocument();
    expect(screen.getByText(/AHI elevated at 22\.4\/h/)).toBeInTheDocument();
  });

  it('uses editedClaim over claim when reviewer edited the finding', () => {
    const f = makeFinding({
      reviewerDecision: 'edit',
      editedClaim: 'Reviewer-edited: AHI 18.0/h - mild OSA'
    });
    render(<PrintableReport signalSlices={[]} c={makeCase({ findings: [f] })} />);
    expect(screen.getByText(/Reviewer-edited: AHI 18\.0\/h/)).toBeInTheDocument();
    expect(screen.queryByText(/AHI elevated at 22\.4\/h/)).not.toBeInTheDocument();
  });

  it('renders without a structured report when none is present', () => {
    const c = makeCase();
    delete (c as Partial<Case>).structuredReport;
    render(<PrintableReport signalSlices={[]} c={c} />);
    expect(screen.getByText('Sleep Study Analysis Report')).toBeInTheDocument();
    expect(screen.queryByText('Clinical Summary')).not.toBeInTheDocument();
    expect(screen.getByText(/Evidence Appendix/)).toBeInTheDocument();
  });

  it('omits the findings section when there are no findings', () => {
    render(<PrintableReport signalSlices={[]} c={makeCase({ findings: [] })} />);
    expect(screen.queryByText(/Evidence Appendix/)).not.toBeInTheDocument();
  });

  it('shows the study quality section when channel issues are present', () => {
    render(<PrintableReport signalSlices={[]} c={makeCase()} />);
    expect(screen.getByText('Study Quality')).toBeInTheDocument();
    expect(screen.getByText('SpO₂ dropouts in last hour')).toBeInTheDocument();
  });

  it('renders the editedValue annotation when a section was edited', () => {
    const c = makeCase({
      sectionReviews: {
        impression: {
          decision: 'edit',
          editedValue: 'Reviewer rewrote impression: severe OSA, urgent.',
          reviewedAt: '2026-04-30T10:00:00Z'
        }
      }
    });
    render(<PrintableReport signalSlices={[]} c={c} />);
    expect(screen.getByText(/Reviewer rewrote impression/)).toBeInTheDocument();
  });
});

// ── Waveform Appendix ──────────────────────────────────────────────────────────

function makeEventSlice(overrides: Partial<EventSlice> = {}): EventSlice {
  return {
    eventId: 'ev_000',
    type: 'provisional_flow_reduction',
    startSec: 40.0,
    endSec: 55.0,
    magnitude: 0.65,
    tags: [],
    signalSlices: [
      { channel: 'Airflow', windowStartSec: 10, windowEndSec: 85, samples: [0.1, 0.2, 0.3] },
      { channel: 'SpO2',    windowStartSec: 10, windowEndSec: 85, samples: [96, 95, 94] },
    ],
    ...overrides,
  };
}

describe('<PrintableReport /> — Waveform Appendix', () => {
  it('renders the appendix heading and event count when slices are provided', () => {
    const slices = [makeEventSlice(), makeEventSlice({ eventId: 'ev_001' })];
    render(<PrintableReport signalSlices={slices} c={makeCase()} />);
    expect(screen.getByText(/Waveform Appendix.*2 events/)).toBeInTheDocument();
  });

  it('uses singular "event" when there is exactly one slice', () => {
    render(<PrintableReport signalSlices={[makeEventSlice()]} c={makeCase()} />);
    expect(screen.getByText(/Waveform Appendix.*1 event(?!s)/)).toBeInTheDocument();
  });

  it('omits the appendix when signalSlices is empty', () => {
    render(<PrintableReport signalSlices={[]} c={makeCase()} />);
    expect(screen.queryByText(/Waveform Appendix/)).not.toBeInTheDocument();
  });
});
