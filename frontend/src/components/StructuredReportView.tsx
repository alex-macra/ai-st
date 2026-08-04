// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  Check,
  X,
  HelpCircle,
  Pencil,
  Info,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Textarea, Chip, Popover } from '../ui';
import type {
  StructuredReport,
  ReportSectionKey,
  SectionReview,
  SectionReviews,
  ReviewerDecision,
  Finding,
  PdfMetrics,
  EdfMetrics,
  EventSlice,
} from '../shared/types';
import { REPORT_SECTION_KEYS } from '../shared/types';
import { stripInlineCitations } from '../utils';
import { EventWaveformSnapshot } from './EventWaveformSnapshot';

interface Props {
  report: StructuredReport;
  findings: Finding[];
  reviews: SectionReviews;
  locked: boolean;
  pdfMetrics?: PdfMetrics | null;
  edfMetrics?: EdfMetrics | null;
  signalSlices?: EventSlice[];
  onSectionDecision: (
    section: ReportSectionKey,
    decision: ReviewerDecision,
    editedValue?: string,
  ) => Promise<void>;
}

const RESPIRATORY_TYPES = new Set([
  'apnea',
  'hypopnea',
  'obstructive_apnea',
  'central_apnea',
  'mixed_apnea',
]);
const OXYGENATION_TYPES = new Set(['desaturation', 'desat', 'oxygen_desaturation']);

const ALWAYS_SHOW = new Set<ReportSectionKey>(['respiratoryIndices', 'oxygenation', 'positional']);

const SECTION_LABELS: Record<ReportSectionKey, string> = {
  summary: 'Summary',
  studyQuality: 'Study quality',
  respiratoryIndices: 'Respiratory indices',
  oxygenation: 'Oxygenation',
  positional: 'Positional',
  snoring: 'Snoring',
  cardiac: 'Cardiac',
  impression: 'Impression',
};

function isPopulated(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some(isPopulated);
  }
  return true;
}

function fmt(n: number | undefined | null, suffix = '', decimals = 1): string | null {
  if (n === undefined || n === null) return null;
  return `${Number.isInteger(n) ? n : n.toFixed(decimals)}${suffix}`;
}

function isEdfBacked(
  report: StructuredReport,
  findings: Finding[],
  sectionKey: ReportSectionKey,
  fieldSource: string,
): boolean {
  const cited = report.citations[sectionKey] ?? [];
  return cited.some((id) => {
    const f = findings.find((fi) => fi.id === id);
    return f?.evidence.some((e) => e.source === fieldSource && e.type === 'edf_metric');
  });
}

// ── AHI calculation popover ─────────────────────────────────────────────────

function ReiPopover({ edfMetrics }: { edfMetrics: EdfMetrics }) {
  const d = edfMetrics.reiCalculationDetail;
  const fs = edfMetrics.flowStats;
  const flatPct = d?.flowChannelFlatPct != null ? (d.flowChannelFlatPct * 100).toFixed(1) : null;
  const hasArtifact = (d?.artifactExcludedCount ?? 0) > 0;

  const rawRei = edfMetrics.provisionalReiPerHour;
  const adjRei = edfMetrics.provisionalReiAdjustedPerHour;
  const odi = edfMetrics.provisionalOdiPerHour;
  const hours = d?.recordingHours;

  return (
    <Popover
      side="bottom"
      label="REI / AHI calculation detail"
      className="!p-0 w-80 text-xs"
      trigger={
        <span className="ml-1 inline-flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
          <Info size={13} aria-hidden="true" />
          {/* Popover wraps the trigger in a <button>; aria-label on a child <span>
              does NOT propagate to the button. sr-only text gives the button an
              accessible name picked up by screen readers. */}
          <span className="sr-only">Show REI calculation detail</span>
        </span>
      }
    >
      <div className="px-3 py-2 border-b border-ui-border/60 font-semibold text-ui-text">
        REI / AHI calculation detail
      </div>

      {hasArtifact && (
        <div className="px-3 py-2 border-b border-ui-border/60 flex items-start gap-1.5 text-amber-700 dark:text-amber-400">
          <AlertTriangle size={12} className="shrink-0 mt-0.5" />
          <span>
            Airflow channel {flatPct}% flat-segment artifact - may contain false-positive events
          </span>
        </div>
      )}

      <div className="px-3 py-2 border-b border-ui-border/60 space-y-1">
        <p className="text-ui-text-subtle uppercase tracking-wide text-[10px] font-medium mb-1.5">
          Indices (recording-time, not sleep-time)
        </p>
        <CalcRow
          label="Raw REI"
          value={rawRei != null ? `${rawRei}/h` : '-'}
          detail={d ? `${d.flowEventCount} events ÷ ${hours?.toFixed(2)}h` : undefined}
        />
        {adjRei !== rawRei && (
          <CalcRow
            label="Artifact-adjusted REI"
            value={adjRei != null ? `${adjRei}/h` : '-'}
            detail={
              d
                ? `${d.artifactAdjustedCount} events (excl. ${d.artifactExcludedCount} in flat periods) ÷ ${hours?.toFixed(2)}h`
                : undefined
            }
          />
        )}
        <CalcRow
          label="ODI 3%"
          value={odi != null ? `${odi}/h` : '-'}
          detail={
            edfMetrics.spo2?.desatCount != null
              ? `${edfMetrics.spo2.desatCount} desat events ÷ ${hours?.toFixed(2)}h`
              : undefined
          }
        />
      </div>

      {fs && (
        <div className="px-3 py-2 border-b border-ui-border/60 space-y-1">
          <p className="text-ui-text-subtle uppercase tracking-wide text-[10px] font-medium mb-1.5">
            Flow event breakdown
          </p>
          <CalcRow label="Total flow events" value={String(fs.count)} />
          <CalcRow label="≥90% reduction (apnea)" value={String(fs.apneaCount)} />
          <CalcRow label="30–90% reduction (hypopnea)" value={String(fs.hypopneaCount)} />
          {fs.avgDurationSec != null && (
            <CalcRow label="Avg duration" value={`${fs.avgDurationSec}s`} />
          )}
          {fs.maxDurationSec != null && (
            <CalcRow label="Max duration" value={`${fs.maxDurationSec}s`} />
          )}
          {fs.severityBreakdown && Object.keys(fs.severityBreakdown).length > 0 && (
            <div className="mt-1">
              {Object.entries(fs.severityBreakdown).map(([key, n]) => (
                <CalcRow
                  key={key}
                  label={key.replace('provisional_flow_reduction_', '')}
                  value={String(n)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <div className="px-3 py-1.5 text-[10px] text-ui-text-subtle italic">
        HSAT recording-time index - not sleep-time normalized. All values provisional.
      </div>
    </Popover>
  );
}

function CalcRow({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string | undefined;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-slate-500 dark:text-slate-400 shrink-0">{label}</span>
      <span className="font-medium tabular-nums text-slate-800 dark:text-slate-200 text-right">
        {value}
        {detail && (
          <span className="ml-1 font-normal text-[10px] text-slate-400 dark:text-slate-500">
            ({detail})
          </span>
        )}
      </span>
    </div>
  );
}

// ── Section body renderers ───────────────────────────────────────────────────

function renderSectionBody(
  report: StructuredReport,
  key: ReportSectionKey,
  pdfMetrics: PdfMetrics | null | undefined,
  edfMetrics: EdfMetrics | null | undefined,
  findings: Finding[],
): ReactNode {
  switch (key) {
    case 'summary':
    case 'impression':
      return (
        <p className="text-sm leading-relaxed whitespace-pre-wrap">
          {stripInlineCitations(report[key] as string)}
        </p>
      );

    case 'studyQuality': {
      const q = report.studyQuality;
      return (
        <div className="text-sm space-y-1">
          {q.totalRecordingTime && <Row label="Total recording" value={q.totalRecordingTime} />}
          {q.analysableTime && <Row label="Analysable" value={q.analysableTime} />}
          {q.channelIssues.length > 0 && (
            <Row label="Channel issues" value={q.channelIssues.join('; ')} />
          )}
        </div>
      );
    }

    case 'respiratoryIndices': {
      const r = report.respiratoryIndices;
      const noPdf = pdfMetrics == null;
      const ahiProvisional =
        r.ahi !== undefined &&
        isEdfBacked(
          report,
          findings,
          'respiratoryIndices',
          'study_metrics.provisional_rei_per_hour',
        );
      const odi3Provisional =
        r.odi3 !== undefined &&
        isEdfBacked(
          report,
          findings,
          'respiratoryIndices',
          'study_metrics.provisional_odi_per_hour',
        );

      const tstH =
        pdfMetrics?.total_sleep_time_seconds != null
          ? pdfMetrics.total_sleep_time_seconds / 3600
          : null;
      const trtH =
        pdfMetrics?.total_recording_seconds != null
          ? pdfMetrics.total_recording_seconds / 3600
          : (edfMetrics?.totalRecordingHours ?? null);
      const denomH = tstH ?? trtH;
      const denomLabel = tstH != null ? 'TST' : 'TRT';

      function calc(rate: number | undefined): string | undefined {
        if (rate === undefined || denomH == null) return undefined;
        return `${Math.round(rate * denomH)} ÷ ${denomH.toFixed(1)}h ${denomLabel}`;
      }

      return (
        <div className="text-sm grid grid-cols-2 gap-x-4 gap-y-1">
          <Row
            label={
              <span className="flex items-center gap-0.5">
                AHI / REI
                {edfMetrics && <ReiPopover edfMetrics={edfMetrics} />}
              </span>
            }
            value={r.ahi !== undefined ? fmt(r.ahi, '/h') : null}
            provisional={ahiProvisional}
            missingTitle={
              noPdf ? 'No DOMINO PDF - provisional REI from EDF' : 'AHI not found in DOMINO PDF'
            }
            calc={calc(r.ahi)}
          />
          <Row
            label="REI (artifact-adj)"
            value={r.reiArtifactAdjusted !== undefined ? fmt(r.reiArtifactAdjusted, '/h') : null}
            calc={calc(r.reiArtifactAdjusted)}
            provisional={r.reiArtifactAdjusted !== undefined}
          />
          <Row
            label="ODI 3%"
            value={r.odi3 !== undefined ? fmt(r.odi3, '/h') : null}
            provisional={odi3Provisional}
            calc={calc(r.odi3)}
          />
          <Row
            label="ODI 4%"
            value={r.odi4 !== undefined ? fmt(r.odi4, '/h') : null}
            calc={calc(r.odi4)}
          />
          <Row
            label="REI (DOMINO)"
            value={r.rei !== undefined ? fmt(r.rei, '/h') : null}
            calc={calc(r.rei)}
          />
          <Row
            label="Central index"
            value={r.centralIndex !== undefined ? fmt(r.centralIndex, '/h') : null}
            calc={calc(r.centralIndex)}
          />
          <Row label="Apnea count (prov.)" value={fmt(r.apneaCount)} />
          <Row label="Hypopnea count (prov.)" value={fmt(r.hypopneaCount)} />
          <Row
            label="Avg event duration"
            value={r.avgEventDurationSec !== undefined ? fmt(r.avgEventDurationSec, 's') : null}
          />
          <Row
            label="Max event duration"
            value={r.maxEventDurationSec !== undefined ? fmt(r.maxEventDurationSec, 's') : null}
          />
        </div>
      );
    }

    case 'oxygenation': {
      const o = report.oxygenation;
      return (
        <div className="text-sm grid grid-cols-2 gap-x-4 gap-y-1">
          <Row label="Baseline SpO₂" value={fmt(o.baselineSpO2, '%')} />
          <Row label="Mean SpO₂" value={fmt(o.meanSpO2, '%')} />
          <Row label="Nadir SpO₂" value={fmt(o.nadirSpO2, '%')} />
          <Row label="T90 (time <90%)" value={fmt(o.t90Pct, '%')} />
          <Row label="T80 (time <80%)" value={fmt(o.t80Pct, '%')} />
          <Row label="Desat events" value={fmt(o.desatCount)} />
          <Row label="Avg desat depth" value={fmt(o.avgDesatDepth, '%')} />
          <Row label="Deepest desat" value={fmt(o.deepestDesat, '%')} />
          <Row
            label="Avg desat duration"
            value={o.avgDesatDuration !== undefined ? fmt(o.avgDesatDuration, 's') : null}
          />
          <Row
            label="Longest desat"
            value={o.longestDesatSec !== undefined ? fmt(o.longestDesatSec, 's') : null}
          />
          <Row
            label="Total desat time"
            value={o.sumDesatSec !== undefined ? fmt(Math.round(o.sumDesatSec / 60), ' min') : null}
          />
        </div>
      );
    }

    case 'positional': {
      const p = report.positional;
      const nonSupineTimePct =
        p.supineTimePct != null
          ? [p.leftTimePct, p.rightTimePct, p.proneTimePct, p.uprightTimePct].reduce<number>(
              (acc, v) => acc + (v ?? 0),
              0,
            ) || 100 - p.supineTimePct
          : undefined;
      return (
        <div className="text-sm grid grid-cols-2 gap-x-4 gap-y-1">
          <Row label="Supine REI" value={fmt(p.supineAhi, '/h')} />
          <Row label="Non-supine REI" value={fmt(p.nonSupineAhi, '/h')} />
          <Row label="Supine time" value={fmt(p.supineTimePct, '%')} />
          <Row label="Non-supine time" value={fmt(nonSupineTimePct, '%')} />
          <Row label="Left time" value={fmt(p.leftTimePct, '%')} />
          <Row label="Right time" value={fmt(p.rightTimePct, '%')} />
          <Row label="Prone time" value={fmt(p.proneTimePct, '%')} />
          <Row label="Upright time" value={fmt(p.uprightTimePct, '%')} />
        </div>
      );
    }

    case 'snoring': {
      const s = report.snoring;
      if (!s) return null;
      return (
        <div className="text-sm grid grid-cols-2 gap-x-4 gap-y-1">
          {s.snoreIndex !== undefined && (
            <Row label="Snore index" value={fmt(s.snoreIndex, '/h')} />
          )}
          {s.snoreMinutes !== undefined && (
            <Row label="Snore time" value={fmt(s.snoreMinutes, ' min')} />
          )}
          {s.snoreTimePct !== undefined && (
            <Row label="Snore time %" value={fmt(s.snoreTimePct, '%')} />
          )}
        </div>
      );
    }

    case 'cardiac': {
      const c = report.cardiac;
      if (!c) return null;
      return (
        <div className="text-sm grid grid-cols-2 gap-x-4 gap-y-1">
          {c.meanHr !== undefined && <Row label="Mean HR (sleep)" value={fmt(c.meanHr, ' bpm')} />}
          {c.minHr !== undefined && <Row label="Min HR (sleep)" value={fmt(c.minHr, ' bpm')} />}
          {c.maxHr !== undefined && <Row label="Max HR (sleep)" value={fmt(c.maxHr, ' bpm')} />}
          {c.wakeMeanHr !== undefined && (
            <Row label="Mean HR (wake)" value={fmt(c.wakeMeanHr, ' bpm')} />
          )}
          {c.wakeMinHr !== undefined && (
            <Row label="Min HR (wake)" value={fmt(c.wakeMinHr, ' bpm')} />
          )}
          {c.wakeMaxHr !== undefined && (
            <Row label="Max HR (wake)" value={fmt(c.wakeMaxHr, ' bpm')} />
          )}
        </div>
      );
    }
  }
}

function Row({
  label,
  value,
  provisional,
  missingTitle,
  calc,
}: {
  label: ReactNode;
  value: string | null;
  provisional?: boolean;
  missingTitle?: string;
  calc?: string | undefined;
}) {
  return (
    <div className="flex justify-between gap-2 items-baseline">
      <span className="text-slate-500 dark:text-slate-400 flex items-center gap-0.5 shrink-0">
        {label}
      </span>
      {value !== null ? (
        <span
          className={`font-medium tabular-nums${provisional ? ' text-amber-700 dark:text-amber-400' : ''}`}
          title={provisional ? 'Provisional - EDF-derived estimate, not DOMINO-scored' : undefined}
        >
          {value}
          {provisional && <sup className="ml-0.5 text-[9px]">~</sup>}
          {calc && (
            <span className="ml-1 text-[11px] font-normal text-slate-400 dark:text-slate-500">
              ({calc})
            </span>
          )}
        </span>
      ) : (
        <span
          className="text-slate-300 dark:text-slate-600 tabular-nums cursor-help select-none"
          title={missingTitle ?? 'Not recorded in this study'}
        >
          -
        </span>
      )}
    </div>
  );
}

export function StructuredReportView({
  report,
  findings,
  reviews,
  locked,
  pdfMetrics,
  edfMetrics,
  signalSlices,
  onSectionDecision,
}: Props) {
  const findingIndexById = new Map(findings.map((f, i) => [f.id, i]));
  const findingById = new Map(findings.map((f) => [f.id, f]));

  function sectionHasPdfCitation(cited: string[]): boolean {
    return cited.some((id) => findingById.get(id)?.evidence.some((e) => e.type === 'pdf_metric'));
  }

  function slicesFor(key: ReportSectionKey): EventSlice[] {
    if (!signalSlices?.length) return [];
    if (key === 'respiratoryIndices') {
      return signalSlices.filter((s) => RESPIRATORY_TYPES.has(s.type.toLowerCase()));
    }
    if (key === 'oxygenation') {
      return signalSlices.filter((s) => OXYGENATION_TYPES.has(s.type.toLowerCase()));
    }
    return [];
  }

  return (
    <div className="space-y-3">
      {REPORT_SECTION_KEYS.map((key) => {
        if (!ALWAYS_SHOW.has(key) && !isPopulated(report[key])) return null;
        const review = reviews[key];
        const cited = report.citations[key] ?? [];
        return (
          <SectionCard
            key={key}
            sectionKey={key}
            label={SECTION_LABELS[key]}
            review={review}
            citedIds={cited}
            findingIndexById={findingIndexById}
            dominoMatched={sectionHasPdfCitation(cited)}
            locked={locked}
            waveformSlices={slicesFor(key)}
            onDecision={onSectionDecision}
          >
            {renderSectionBody(report, key, pdfMetrics, edfMetrics, findings)}
          </SectionCard>
        );
      })}
    </div>
  );
}

interface SectionCardProps {
  sectionKey: ReportSectionKey;
  label: string;
  review: SectionReview | undefined;
  citedIds: string[];
  findingIndexById: Map<string, number>;
  dominoMatched: boolean;
  locked: boolean;
  waveformSlices?: EventSlice[];
  onDecision: (
    section: ReportSectionKey,
    decision: ReviewerDecision,
    editedValue?: string,
  ) => Promise<void>;
  children: ReactNode;
}

function SectionCard({
  sectionKey,
  label,
  review,
  citedIds,
  findingIndexById,
  dominoMatched,
  locked,
  waveformSlices,
  onDecision,
  children,
}: SectionCardProps) {
  const [editMode, setEditMode] = useState(false);
  const [showWaveforms, setShowWaveforms] = useState(true);
  const [editText, setEditText] = useState(review?.editedValue ?? '');
  const [saving, setSaving] = useState(false);

  async function handleDecision(decision: ReviewerDecision) {
    if (saving) return;
    setSaving(true);
    try {
      await onDecision(sectionKey, decision);
    } finally {
      setSaving(false);
    }
  }

  async function handleEditSubmit() {
    if (!editText.trim() || saving) return;
    setSaving(true);
    try {
      await onDecision(sectionKey, 'edit', editText.trim());
      setEditMode(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card p-4 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h4 className="section-label">{label}</h4>
          {dominoMatched && (
            <span
              className="text-xs px-1.5 py-0.5 rounded bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400 border border-teal-200 dark:border-teal-700"
              title="This section's numbers match the DOMINO PDF export"
            >
              DOMINO ✓
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          {review && (
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 capitalize">
              {review.decision}
            </span>
          )}
        </div>
      </div>

      {editMode ? (
        <Textarea
          rows={3}
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          disabled={saving}
        />
      ) : (
        <>
          {children}
          {review?.editedValue && (
            <p className="text-xs italic text-blue-700 dark:text-blue-400 border-l-2 border-blue-300 dark:border-blue-700 pl-2">
              Reviewer edit: {review.editedValue}
            </p>
          )}
        </>
      )}

      {citedIds.some((id) => findingIndexById.has(id)) && (
        <div className="flex items-center gap-1.5 pt-2 border-t border-slate-100 dark:border-slate-800/60 flex-wrap">
          <span className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wide">
            Sources
          </span>
          {citedIds.map((id) => {
            const idx = findingIndexById.get(id);
            if (idx === undefined) return null;
            return (
              <Chip key={id} className="chip-muted text-[10px]">
                F-{String(idx + 1).padStart(3, '0')}
              </Chip>
            );
          })}
        </div>
      )}

      {waveformSlices && waveformSlices.length > 0 && (
        <div className="pt-2 border-t border-slate-100 dark:border-slate-800/60">
          <button
            type="button"
            onClick={() => setShowWaveforms((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
            aria-expanded={showWaveforms}
          >
            {showWaveforms ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            {showWaveforms ? 'Hide' : 'View'} waveforms ({waveformSlices.length})
          </button>
          {showWaveforms && (
            <div className="mt-3 space-y-4 overflow-x-auto">
              {waveformSlices.map((ev, i) => (
                <EventWaveformSnapshot key={ev.eventId} event={ev} index={i} />
              ))}
            </div>
          )}
        </div>
      )}

      {!locked && (
        <div className="flex items-center gap-1.5 pt-1">
          {editMode ? (
            <>
              <button
                className="btn-teal text-xs py-1 px-2"
                onClick={() => void handleEditSubmit()}
                disabled={saving || !editText.trim()}
              >
                Save edit
              </button>
              <button
                className="btn-ghost text-xs py-1 px-2"
                onClick={() => {
                  setEditMode(false);
                  setEditText(review?.editedValue ?? '');
                }}
                disabled={saving}
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                className={`btn-ghost text-xs py-1 px-2 flex items-center gap-1 ${review?.decision === 'confirm' ? 'text-green-600 dark:text-green-400 font-semibold' : ''}`}
                onClick={() => void handleDecision('confirm')}
                disabled={saving}
              >
                <Check size={12} /> Confirm
              </button>
              <button
                className={`btn-ghost text-xs py-1 px-2 flex items-center gap-1 ${review?.decision === 'reject' ? 'text-red-600 dark:text-red-400 font-semibold' : ''}`}
                onClick={() => void handleDecision('reject')}
                disabled={saving}
              >
                <X size={12} /> Reject
              </button>
              <button
                className={`btn-ghost text-xs py-1 px-2 flex items-center gap-1 ${review?.decision === 'uncertain' ? 'text-amber-600 dark:text-amber-400 font-semibold' : ''}`}
                onClick={() => void handleDecision('uncertain')}
                disabled={saving}
              >
                <HelpCircle size={12} /> Uncertain
              </button>
              <button
                className={`btn-ghost text-xs py-1 px-2 flex items-center gap-1 ${review?.decision === 'edit' ? 'text-blue-600 dark:text-blue-400 font-semibold' : ''}`}
                onClick={() => {
                  setEditText(review?.editedValue ?? '');
                  setEditMode(true);
                }}
                disabled={saving}
              >
                <Pencil size={12} /> Edit
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
