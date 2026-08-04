// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react';
import { getAuditLog } from '../api';
import type {
  ActionPlan,
  Case,
  PdfMetrics,
  StructuredReport,
  AuditRecord,
  EventSlice,
} from '@contracts/types';
import { EventWaveformSnapshot } from './EventWaveformSnapshot';
import { stripInlineCitations } from '../utils';

interface Props {
  c: Case;
  signalSlices: EventSlice[];
}

// ── utilities ─────────────────────────────────────────────────────────────────
function fmt(n: number | undefined | null, suffix = '', digits = 1): string {
  if (n === undefined || n === null) return '-';
  return `${Number.isInteger(n) ? n : n.toFixed(digits)}${suffix}`;
}

function fmtSec(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

type SeverityLabel = 'Normal' | 'Mild' | 'Moderate' | 'Severe';

function ahiClassification(ahi: number, cohort?: string): { label: SeverityLabel; detail: string } {
  if (cohort === 'pediatric') {
    if (ahi < 1) return { label: 'Normal', detail: 'No significant obstructive SDB' };
    if (ahi < 5) return { label: 'Mild', detail: 'Mild pediatric obstructive SDB' };
    if (ahi < 10) return { label: 'Moderate', detail: 'Moderate pediatric obstructive SDB' };
    return { label: 'Severe', detail: 'Severe pediatric obstructive SDB' };
  }
  if (ahi < 5) return { label: 'Normal', detail: 'No significant sleep-disordered breathing' };
  if (ahi < 15) return { label: 'Mild', detail: 'Mild sleep-disordered breathing' };
  if (ahi < 30) return { label: 'Moderate', detail: 'Moderate sleep-disordered breathing' };
  return { label: 'Severe', detail: 'Severe sleep-disordered breathing' };
}

// ── design tokens ─────────────────────────────────────────────────────────────
const ACCENT = '#1B3A6B';

const SEVERITY: Record<SeverityLabel, { bg: string; text: string; border: string; badge: string }> =
  {
    Normal: { bg: '#E8F5E9', text: '#1B5E20', border: '#43A047', badge: '#2E7D32' },
    Mild: { bg: '#FFFDE7', text: '#5D4037', border: '#FBC02D', badge: '#F9A825' },
    Moderate: { bg: '#FFF3E0', text: '#BF360C', border: '#EF6C00', badge: '#E65100' },
    Severe: { bg: '#FFEBEE', text: '#7F0000', border: '#E53935', badge: '#B71C1C' },
  };

// ── SVG charts ────────────────────────────────────────────────────────────────

function AhiScaleBar({ ahi, cohort }: { ahi: number; cohort?: string | undefined }) {
  const isPeds = cohort === 'pediatric';
  const maxVal = isPeds ? 15 : 40;

  const bands = isPeds
    ? [
        { label: 'Normal', start: 0, end: 1, color: '#C8E6C9' },
        { label: 'Mild', start: 1, end: 5, color: '#FFF9C4' },
        { label: 'Mod', start: 5, end: 10, color: '#FFE0B2' },
        { label: 'Severe', start: 10, end: 15, color: '#FFCDD2' },
      ]
    : [
        { label: 'Normal', start: 0, end: 5, color: '#C8E6C9' },
        { label: 'Mild', start: 5, end: 15, color: '#FFF9C4' },
        { label: 'Mod', start: 15, end: 30, color: '#FFE0B2' },
        { label: 'Severe', start: 30, end: 40, color: '#FFCDD2' },
      ];

  const W = 400,
    H = 38,
    barH = 20,
    yBar = 6;
  const markerX = (Math.min(ahi, maxVal) / maxVal) * W;
  const ticks = isPeds ? [0, 1, 5, 10, 15] : [0, 5, 15, 30, 40];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={H}
      style={{ display: 'block', marginTop: '5pt' }}
    >
      {bands.map((b) => {
        const x = (b.start / maxVal) * W;
        const w = ((b.end - b.start) / maxVal) * W;
        return (
          <g key={b.label}>
            <rect
              x={x}
              y={yBar}
              width={w}
              height={barH}
              fill={b.color}
              stroke="#ccc"
              strokeWidth="0.5"
            />
            <text
              x={x + w / 2}
              y={yBar + barH / 2 + 4}
              fontSize="7"
              textAnchor="middle"
              fill="#555"
            >
              {b.label}
            </text>
          </g>
        );
      })}
      <polygon
        points={`${markerX},${yBar - 1} ${markerX - 5},${yBar - 7} ${markerX + 5},${yBar - 7}`}
        fill={ACCENT}
      />
      <line
        x1={markerX}
        y1={yBar}
        x2={markerX}
        y2={yBar + barH}
        stroke={ACCENT}
        strokeWidth="1.5"
      />
      {ticks.map((v) => (
        <text key={v} x={(v / maxVal) * W} y={H} fontSize="6.5" textAnchor="middle" fill="#777">
          {v}
        </text>
      ))}
    </svg>
  );
}

function SpO2Bar({
  mean,
  baseline,
  nadir,
}: {
  mean?: number | undefined;
  baseline?: number | undefined;
  nadir?: number | undefined;
}) {
  const minVal = 78,
    maxVal = 100;
  const W = 400,
    H = 44,
    barH = 16,
    yBar = 10;

  function xOf(v: number) {
    return ((Math.min(Math.max(v, minVal), maxVal) - minVal) / (maxVal - minVal)) * W;
  }

  const zones = [
    { from: 78, to: 90, color: '#FFCDD2', label: '<90%' },
    { from: 90, to: 94, color: '#FFF9C4', label: '90–94%' },
    { from: 94, to: 100, color: '#C8E6C9', label: '≥94%' },
  ];

  const markers = [
    { val: nadir, label: 'nadir', color: '#C62828', dash: true },
    { val: mean, label: 'mean', color: ACCENT, dash: false },
    { val: baseline, label: 'baseline', color: '#2E7D32', dash: false },
  ].filter(
    (mk): mk is { val: number; label: string; color: string; dash: boolean } =>
      mk.val !== undefined && mk.val !== null,
  );

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={H}
      style={{ display: 'block', marginTop: '5pt' }}
    >
      {[78, 82, 86, 90, 94, 98].map((v) => (
        <text key={v} x={xOf(v)} y={8} fontSize="6" textAnchor="middle" fill="#999">
          {v}%
        </text>
      ))}
      {zones.map((z) => {
        const x = xOf(z.from);
        const w = xOf(z.to) - x;
        return (
          <g key={z.label}>
            <rect
              x={x}
              y={yBar}
              width={w}
              height={barH}
              fill={z.color}
              stroke="#ccc"
              strokeWidth="0.5"
            />
            <text
              x={x + w / 2}
              y={yBar + barH / 2 + 4}
              fontSize="7"
              textAnchor="middle"
              fill="#555"
            >
              {z.label}
            </text>
          </g>
        );
      })}
      {markers.map((mk) => (
        <g key={mk.label}>
          <line
            x1={xOf(mk.val)}
            y1={yBar}
            x2={xOf(mk.val)}
            y2={yBar + barH}
            stroke={mk.color}
            strokeWidth="1.5"
            strokeDasharray={mk.dash ? '3,2' : ''}
          />
          <text x={xOf(mk.val)} y={H} fontSize="6.5" textAnchor="middle" fill={mk.color}>
            {mk.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

function PositionBar({
  supine,
  left,
  right,
  prone,
  upright,
}: {
  supine?: number | undefined;
  left?: number | undefined;
  right?: number | undefined;
  prone?: number | undefined;
  upright?: number | undefined;
}) {
  const raw = [
    { label: 'Supine', pct: supine, color: '#90CAF9' },
    { label: 'Left', pct: left, color: '#A5D6A7' },
    { label: 'Right', pct: right, color: '#FFCC80' },
    { label: 'Prone', pct: prone, color: '#CE93D8' },
    { label: 'Upright', pct: upright, color: '#F48FB1' },
  ].filter(
    (s): s is { label: string; pct: number; color: string } => s.pct !== undefined && s.pct > 0,
  );
  if (raw.length === 0) return null;

  const W = 400,
    H = 34,
    barH = 18,
    yBar = 2;

  let offset = 0;
  const segs = raw.map((s) => {
    const x = offset;
    const w = (s.pct / 100) * W;
    offset += w;
    return { ...s, x, w };
  });

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={H}
      style={{ display: 'block', marginTop: '5pt' }}
    >
      {segs.map((s) => (
        <g key={s.label}>
          <rect
            x={s.x}
            y={yBar}
            width={s.w}
            height={barH}
            fill={s.color}
            stroke="#fff"
            strokeWidth="0.5"
          />
          {s.w > 32 && (
            <text
              x={s.x + s.w / 2}
              y={yBar + barH / 2 + 4}
              fontSize="7"
              textAnchor="middle"
              fill="#333"
            >
              {s.label} {s.pct.toFixed(0)}%
            </text>
          )}
        </g>
      ))}
      {segs
        .filter((s) => s.w <= 32)
        .map((s, i) => (
          <text
            key={s.label}
            x={W - 5}
            y={H - i * 8}
            fontSize="6.5"
            textAnchor="end"
            fill={s.color}
          >
            {s.label} {s.pct.toFixed(0)}%
          </text>
        ))}
    </svg>
  );
}

function HrRangeChart({
  sleepMin,
  sleepMean,
  sleepMax,
  wakeMin,
  wakeMean,
  wakeMax,
}: {
  sleepMin?: number | undefined;
  sleepMean?: number | undefined;
  sleepMax?: number | undefined;
  wakeMin?: number | undefined;
  wakeMean?: number | undefined;
  wakeMax?: number | undefined;
}) {
  if (!sleepMean) return null;

  const hasWake = wakeMean !== undefined;
  const allVals = [sleepMin, sleepMean, sleepMax, wakeMin, wakeMean, wakeMax].filter(
    (v): v is number => v !== undefined,
  );

  const minV = Math.floor(Math.min(...allVals) - 5);
  const maxV = Math.ceil(Math.max(...allVals) + 5);
  const range = maxV - minV;
  const W = 400,
    BAR_LEFT = 36;
  const barW = W - BAR_LEFT;
  const H = hasWake ? 58 : 34;

  function xOf(v: number) {
    return BAR_LEFT + ((v - minV) / range) * barW;
  }

  const rows = [
    { label: 'Sleep', min: sleepMin, mean: sleepMean, max: sleepMax, y: 2, color: ACCENT },
    ...(hasWake
      ? [{ label: 'Wake', min: wakeMin, mean: wakeMean, max: wakeMax, y: 30, color: '#5C85B5' }]
      : []),
  ];

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(minV + f * range));

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={H}
      style={{ display: 'block', marginTop: '5pt' }}
    >
      {ticks.map((t) => (
        <g key={t}>
          <line x1={xOf(t)} y1={0} x2={xOf(t)} y2={H - 10} stroke="#eee" strokeWidth="0.5" />
          <text x={xOf(t)} y={H - 1} fontSize="6" textAnchor="middle" fill="#aaa">
            {t}
          </text>
        </g>
      ))}
      {rows.map((row) => {
        if (!row.mean) return null;
        const minX = row.min !== undefined ? xOf(row.min) : xOf(row.mean);
        const maxX = row.max !== undefined ? xOf(row.max) : xOf(row.mean);
        const meanX = xOf(row.mean);
        return (
          <g key={row.label}>
            <text x={0} y={row.y + 11} fontSize="7" fill="#666" fontWeight="bold">
              {row.label}
            </text>
            <line
              x1={minX}
              y1={row.y + 10}
              x2={maxX}
              y2={row.y + 10}
              stroke={row.color}
              strokeWidth="5"
              strokeLinecap="round"
              opacity="0.3"
            />
            <circle cx={meanX} cy={row.y + 10} r="5" fill={row.color} />
            <text
              x={meanX}
              y={row.y + 13}
              fontSize="6"
              textAnchor="middle"
              fill="#fff"
              fontWeight="bold"
            >
              {Math.round(row.mean)}
            </text>
            {row.min !== undefined && (
              <text x={minX} y={row.y + 22} fontSize="6" textAnchor="middle" fill="#999">
                {Math.round(row.min)}
              </text>
            )}
            {row.max !== undefined && (
              <text x={maxX} y={row.y + 22} fontSize="6" textAnchor="middle" fill="#999">
                {Math.round(row.max)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ── shared styles ─────────────────────────────────────────────────────────────
const sectionStyle: React.CSSProperties = { marginTop: '10pt' };

function ReviewerNote({ text }: { text: string }) {
  return (
    <p
      style={{
        margin: '3pt 0 0 0',
        fontSize: '8pt',
        color: '#666',
        fontStyle: 'italic',
        borderLeft: '2pt solid #ccc',
        paddingLeft: '5pt',
      }}
    >
      Reviewer note: {text}
    </p>
  );
}

const sectionTitleStyle: React.CSSProperties = {
  fontSize: '7.5pt',
  fontWeight: 'bold',
  textTransform: 'uppercase',
  letterSpacing: '0.7pt',
  color: ACCENT,
  borderBottom: `1pt solid ${ACCENT}`,
  paddingBottom: '2pt',
  marginBottom: '5pt',
};

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '9.5pt',
};

const labelCell: React.CSSProperties = {
  padding: '2.5pt 6pt 2.5pt 0',
  color: '#444',
  width: '22%',
  verticalAlign: 'top',
};

const valueCell: React.CSSProperties = {
  padding: '2.5pt 10pt 2.5pt 0',
  fontFamily: 'monospace',
  fontWeight: 'bold',
  width: '13%',
  verticalAlign: 'top',
};

// ── MetricPair ────────────────────────────────────────────────────────────────
function MetricPair({
  l1,
  v1,
  l2,
  v2,
  shade,
}: {
  l1: string;
  v1: string;
  l2?: string;
  v2?: string;
  shade?: boolean;
}) {
  return (
    <tr style={shade ? { background: '#f5f7fa' } : {}}>
      <td style={labelCell}>{l1}</td>
      <td style={valueCell}>{v1}</td>
      {l2 !== undefined && (
        <>
          <td style={{ ...labelCell, paddingLeft: '10pt' }}>{l2}</td>
          <td style={valueCell}>{v2 ?? '-'}</td>
        </>
      )}
    </tr>
  );
}

// ── ActionPlanSection ─────────────────────────────────────────────────────────
function ActionPlanSection({ plan }: { plan: ActionPlan }) {
  const subhead: React.CSSProperties = {
    fontWeight: 'bold',
    fontSize: '8pt',
    textTransform: 'uppercase',
    letterSpacing: '0.4pt',
    color: '#333',
    marginBottom: '3pt',
  };
  const item: React.CSSProperties = { marginBottom: '5pt' };
  const num: React.CSSProperties = {
    fontFamily: 'monospace',
    fontWeight: 'bold',
    minWidth: '14pt',
    display: 'inline-block',
    color: '#555',
  };
  const rationale: React.CSSProperties = {
    fontSize: '8pt',
    color: '#555',
    margin: '0 0 2pt 14pt',
    fontStyle: 'italic',
  };

  return (
    <section style={{ marginTop: '14pt', paddingTop: '6pt', borderTop: `1.5pt solid ${ACCENT}` }}>
      <div style={{ ...sectionTitleStyle, marginTop: '0' }}>AI-Assisted Action Plan</div>
      <p style={{ fontSize: '7.5pt', color: '#888', margin: '0 0 8pt 0', fontStyle: 'italic' }}>
        AI-generated draft for clinician review · {plan.modelVersion} · prompt {plan.promptVersion}{' '}
        · {new Date(plan.generatedAt).toLocaleString()}
      </p>

      {plan.priorityActions.length > 0 && (
        <div style={{ marginBottom: '8pt' }}>
          <div style={subhead}>Priority Actions</div>
          {plan.priorityActions.map((a, i) => (
            <div key={i} style={item}>
              <span style={num}>{i + 1}.</span>
              <span style={{ fontSize: '9pt', fontWeight: 'bold' }}>
                {stripInlineCitations(a.action)}
              </span>
              <div style={rationale}>{stripInlineCitations(a.rationale)}</div>
            </div>
          ))}
        </div>
      )}

      {plan.verifyNext.length > 0 && (
        <div style={{ marginBottom: '8pt' }}>
          <div style={subhead}>Verify Next</div>
          {plan.verifyNext.map((a, i) => (
            <div key={i} style={item}>
              <span style={num}>{i + 1}.</span>
              <span style={{ fontSize: '9pt' }}>{stripInlineCitations(a.action)}</span>
              <div style={rationale}>{stripInlineCitations(a.rationale)}</div>
            </div>
          ))}
        </div>
      )}

      {plan.artifactCaveats.length > 0 && (
        <div style={{ marginBottom: '8pt' }}>
          <div style={subhead}>Artefact Caveats</div>
          {plan.artifactCaveats.map((a, i) => (
            <div key={i} style={{ fontSize: '8.5pt', color: '#555', marginBottom: '3pt' }}>
              <span style={num}>·</span>
              {stripInlineCitations(a.concern)}
            </div>
          ))}
        </div>
      )}

      <div style={{ marginBottom: '8pt' }}>
        <div style={subhead}>Clinical Context</div>
        <p style={{ fontSize: '9pt', margin: '0 0 3pt 0' }}>
          {stripInlineCitations(plan.clinicalContext.commonPresentation)}
        </p>
        {plan.clinicalContext.treatmentEvidence && (
          <p style={{ fontSize: '9pt', margin: '3pt 0 0 0' }}>
            {stripInlineCitations(plan.clinicalContext.treatmentEvidence)}
          </p>
        )}
        {plan.clinicalContext.rareButRelevant.length > 0 && (
          <div style={{ marginTop: '4pt' }}>
            <span style={{ fontSize: '8pt', color: '#666', fontStyle: 'italic' }}>
              Rare but relevant:{' '}
            </span>
            <ul style={{ margin: '2pt 0 0 14pt', padding: '0', fontSize: '8.5pt', color: '#444' }}>
              {plan.clinicalContext.rareButRelevant.map((r, i) => (
                <li key={i} style={{ marginBottom: '1.5pt' }}>
                  {stripInlineCitations(r)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {plan.evidenceReferences && plan.evidenceReferences.length > 0 && (
        <div>
          <div style={{ ...subhead, marginBottom: '3pt' }}>Evidence References</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '8pt' }}>
            <thead>
              <tr style={{ background: '#f0f4fa', borderBottom: `0.5pt solid ${ACCENT}` }}>
                {['#', 'Study / Guideline', 'Year', 'Source', 'Relevance'].map((h, i) => (
                  <td
                    key={h}
                    style={{
                      padding: '2pt 4pt 2pt 0',
                      fontWeight: 'bold',
                      color: '#444',
                      width:
                        i === 0
                          ? '3%'
                          : i === 1
                            ? '32%'
                            : i === 2
                              ? '8%'
                              : i === 3
                                ? '12%'
                                : 'auto',
                    }}
                  >
                    {h}
                  </td>
                ))}
              </tr>
            </thead>
            <tbody>
              {plan.evidenceReferences.map((ref, i) => (
                <tr
                  key={i}
                  style={{
                    borderBottom: '0.25pt solid #e0e0e0',
                    background: i % 2 === 0 ? '#fff' : '#f5f7fa',
                  }}
                >
                  <td
                    style={{ padding: '1.5pt 4pt 1.5pt 0', color: '#aaa', fontFamily: 'monospace' }}
                  >
                    {i + 1}
                  </td>
                  <td style={{ padding: '1.5pt 4pt 1.5pt 0', fontWeight: 'bold' }}>{ref.name}</td>
                  <td style={{ padding: '1.5pt 4pt 1.5pt 0', fontFamily: 'monospace' }}>
                    {ref.year}
                  </td>
                  <td style={{ padding: '1.5pt 4pt 1.5pt 0', color: '#555' }}>{ref.source}</td>
                  <td style={{ padding: '1.5pt 0 1.5pt 0', color: '#555' }}>{ref.relevance}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ── main component ────────────────────────────────────────────────────────────
export function PrintableReport({ c, signalSlices }: Props) {
  const [audit, setAudit] = useState<AuditRecord[]>([]);

  useEffect(() => {
    getAuditLog(c.id)
      .then(({ auditLog }) => setAudit(auditLog))
      .catch(() => {});
  }, [c.id]);

  const signOffEntry = audit.find((r) => r.action === 'signed_off');
  const signedAt = signOffEntry?.createdAt ?? c.updatedAt;
  const reviewer =
    ((signOffEntry?.metadata as Record<string, unknown> | undefined)?.reviewerName as
      string | undefined) ??
    signOffEntry?.actorId ??
    '-';

  const rpt: StructuredReport | undefined = c.structuredReport;
  const m: PdfMetrics | null = c.pdfMetrics ?? null;

  const summaryEdited =
    c.sectionReviews?.summary?.decision === 'edit'
      ? c.sectionReviews.summary.editedValue
      : undefined;
  const impressionEdited =
    c.sectionReviews?.impression?.decision === 'edit'
      ? c.sectionReviews.impression.editedValue
      : undefined;

  const primaryAhi = m?.ahi ?? rpt?.respiratoryIndices?.ahi;
  const isPeds = c.cohort === 'pediatric';
  const ahiClass = primaryAhi !== undefined ? ahiClassification(primaryAhi, c.cohort) : null;
  const sev = ahiClass ? SEVERITY[ahiClass.label] : null;

  const confirmedFindings = c.findings.filter(
    (f) => f.reviewerDecision !== 'reject' && f.reviewerDecision !== 'artefact',
  );
  const warningFlags = (() => {
    const all = c.referenceFlags?.filter((f) => f.severity === 'warning') ?? [];
    const seen = new Set<string>();
    return all.filter((f) => {
      const key = `${f.ruleId}::${f.issue}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  })();

  return (
    <div
      className="print-only"
      style={{
        fontFamily: 'Arial, Helvetica, sans-serif',
        fontSize: '10pt',
        lineHeight: 1.45,
        color: '#111',
      }}
    >
      {/* ── HEADER ────────────────────────────────────────────────────────────── */}
      <header
        style={{
          borderTop: `4pt solid ${ACCENT}`,
          borderBottom: '0.5pt solid #c8d4e8',
          paddingTop: '5pt',
          paddingBottom: '6pt',
          marginBottom: '10pt',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            <tr>
              <td style={{ verticalAlign: 'bottom' }}>
                <div
                  style={{
                    fontSize: '16pt',
                    fontWeight: 'bold',
                    color: ACCENT,
                    letterSpacing: '-0.2pt',
                  }}
                >
                  Sleep Study Analysis Report
                </div>
                <div style={{ fontSize: '8pt', color: '#777', marginTop: '2pt' }}>
                  Somnoscribe Sleep Study Review Assistant · Type III HSAT review
                </div>
              </td>
              <td
                style={{
                  verticalAlign: 'top',
                  textAlign: 'right',
                  fontSize: '8.5pt',
                  color: '#444',
                }}
              >
                <div>
                  <strong>Study:</strong> {c.name}
                </div>
                {(c.demographics?.ageYears != null || c.demographics?.sex) && (
                  <div>
                    <strong>Patient:</strong>{' '}
                    {[
                      c.demographics?.ageYears != null ? `${c.demographics.ageYears} y` : null,
                      c.demographics?.sex,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                )}
                <div>
                  <strong>Reviewer:</strong> {reviewer}
                </div>
                <div>
                  <strong>Signed:</strong> {new Date(signedAt).toLocaleDateString()}
                </div>
                <div
                  style={{
                    marginTop: '3pt',
                    fontFamily: 'monospace',
                    fontSize: '7pt',
                    color: '#aaa',
                  }}
                >
                  {c.studyHash.slice(0, 16)}
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </header>

      {/* ── AHI SEVERITY BANNER ───────────────────────────────────────────────── */}
      {ahiClass && sev && primaryAhi !== undefined && (
        <section style={{ marginBottom: '10pt' }}>
          <div
            style={{
              border: `1.5pt solid ${sev.border}`,
              borderRadius: '3pt',
              background: sev.bg,
              padding: '8pt 12pt 6pt',
            }}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                <tr>
                  <td style={{ verticalAlign: 'middle' }}>
                    <span style={{ fontSize: '22pt', fontWeight: 'bold', color: sev.text }}>
                      {isPeds ? 'pAHI' : 'AHI'} = {fmt(primaryAhi)}/h
                    </span>
                    {m?.rdi !== undefined && m.rdi !== m?.ahi && (
                      <span style={{ fontSize: '10pt', marginLeft: '14pt', color: '#666' }}>
                        RDI = {fmt(m.rdi)}/h
                      </span>
                    )}
                  </td>
                  <td style={{ verticalAlign: 'middle', textAlign: 'right' }}>
                    <div
                      style={{
                        display: 'inline-block',
                        background: sev.badge,
                        color: '#fff',
                        padding: '3pt 12pt',
                        borderRadius: '2pt',
                        fontSize: '13pt',
                        fontWeight: 'bold',
                        letterSpacing: '0.2pt',
                      }}
                    >
                      {ahiClass.label}
                    </div>
                    <div style={{ fontSize: '8pt', color: sev.text, marginTop: '4pt' }}>
                      {ahiClass.detail}
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
            <AhiScaleBar ahi={primaryAhi} cohort={c.cohort} />
          </div>
        </section>
      )}

      {/* ── CLINICAL SUMMARY ──────────────────────────────────────────────────── */}
      {rpt && (rpt.summary || rpt.impression) && (
        <section style={sectionStyle}>
          <div style={sectionTitleStyle}>Clinical Summary</div>
          {rpt.summary && (
            <>
              <p style={{ margin: '0 0 5pt 0', fontSize: '10pt' }}>
                {stripInlineCitations(summaryEdited ?? rpt.summary)}
              </p>
              {summaryEdited && (
                <p
                  style={{
                    margin: '0 0 5pt 0',
                    fontSize: '8pt',
                    color: '#999',
                    textDecoration: 'line-through',
                  }}
                >
                  {stripInlineCitations(rpt.summary)}
                </p>
              )}
            </>
          )}
          {rpt.impression && (
            <>
              <p style={{ margin: '0', fontSize: '10pt' }}>
                {stripInlineCitations(impressionEdited ?? rpt.impression)}
              </p>
              {impressionEdited && (
                <p
                  style={{
                    margin: '2pt 0 0 0',
                    fontSize: '8pt',
                    color: '#999',
                    textDecoration: 'line-through',
                  }}
                >
                  {stripInlineCitations(rpt.impression)}
                </p>
              )}
            </>
          )}
        </section>
      )}

      {/* ── RECORDING STATISTICS ──────────────────────────────────────────────── */}
      {(m || rpt?.studyQuality?.totalRecordingTime) && (
        <section style={sectionStyle}>
          <div style={sectionTitleStyle}>Recording Statistics</div>
          <table style={tableStyle}>
            <tbody>
              <MetricPair
                l1="Recording time"
                v1={
                  m?.total_recording_seconds != null
                    ? fmtSec(m.total_recording_seconds)
                    : (rpt?.studyQuality?.totalRecordingTime ?? '-')
                }
                l2="Total sleep time"
                v2={m?.total_sleep_time_seconds != null ? fmtSec(m.total_sleep_time_seconds) : '-'}
              />
              <MetricPair
                shade
                l1="Sleep efficiency"
                v1={m?.sleep_efficiency_pct != null ? `${m.sleep_efficiency_pct}%` : '-'}
                l2="Sleep latency"
                v2={m?.sleep_latency_min != null ? `${m.sleep_latency_min} min` : '-'}
              />
              {(m?.artefact_minutes != null || rpt?.studyQuality?.analysableTime) && (
                <MetricPair
                  l1="Artefact"
                  v1={
                    m?.artefact_minutes != null
                      ? `${m.artefact_minutes} min${m.artefact_pct != null ? ` (${m.artefact_pct}%)` : ''}`
                      : '-'
                  }
                  l2="Analysable time"
                  v2={rpt?.studyQuality?.analysableTime ?? '-'}
                />
              )}
            </tbody>
          </table>
        </section>
      )}

      {/* ── RESPIRATORY ANALYSIS ──────────────────────────────────────────────── */}
      {rpt?.respiratoryIndices && (
        <section style={sectionStyle}>
          <div style={sectionTitleStyle}>Respiratory Analysis</div>
          <table style={tableStyle}>
            <tbody>
              <MetricPair
                l1={(() => {
                  const ahiRaw = m?.ahi ?? rpt.respiratoryIndices.ahi;
                  const rdiRaw = m?.rdi ?? rpt.respiratoryIndices.rei;
                  const showRdi = rdiRaw !== undefined && rdiRaw !== null && rdiRaw !== ahiRaw;
                  if (showRdi) return isPeds ? 'pAHI / RDI [/h]' : 'AHI / RDI [/h]';
                  return isPeds ? 'pAHI [/h]' : 'AHI [/h]';
                })()}
                v1={(() => {
                  const ahiRaw = m?.ahi ?? rpt.respiratoryIndices.ahi;
                  const rdiRaw = m?.rdi ?? rpt.respiratoryIndices.rei;
                  const ahi = fmt(ahiRaw);
                  const showRdi = rdiRaw !== undefined && rdiRaw !== null && rdiRaw !== ahiRaw;
                  return showRdi ? `${ahi} / ${fmt(rdiRaw)}` : ahi;
                })()}
                l2="ODI 3% [/h]"
                v2={fmt(m?.desaturation_index ?? rpt.respiratoryIndices.odi3)}
              />
              {(m?.obstructive_apnea_count != null || m?.central_apnea_count != null) && (
                <MetricPair
                  shade
                  l1="Obstructive apneas"
                  v1={
                    m?.obstructive_apnea_count != null
                      ? `${m.obstructive_apnea_count} (${fmt(m.obstructive_apnea_index)}/h)`
                      : '-'
                  }
                  l2="Central apneas"
                  v2={
                    m?.central_apnea_count != null
                      ? `${m.central_apnea_count} (${fmt(m.central_apnea_index)}/h)`
                      : '-'
                  }
                />
              )}
              {(m?.hypopnea_index != null || rpt.respiratoryIndices.odi4 != null) && (
                <MetricPair
                  l1="Hypopnea index [/h]"
                  v1={fmt(m?.hypopnea_index)}
                  l2="ODI 4% [/h]"
                  v2={fmt(rpt.respiratoryIndices.odi4)}
                />
              )}
              {rpt.respiratoryIndices.centralIndex != null && (
                <MetricPair
                  shade
                  l1="Central index [/h]"
                  v1={fmt(rpt.respiratoryIndices.centralIndex)}
                />
              )}
            </tbody>
          </table>
          {c.sectionReviews?.respiratoryIndices?.editedValue && (
            <ReviewerNote text={c.sectionReviews.respiratoryIndices.editedValue} />
          )}
        </section>
      )}

      {/* ── O₂ SATURATION ────────────────────────────────────────────────────── */}
      {(rpt?.oxygenation || m) && (
        <section style={sectionStyle}>
          <div style={sectionTitleStyle}>O₂ Saturation</div>
          <table style={tableStyle}>
            <tbody>
              <MetricPair
                l1="Mean SpO₂"
                v1={fmt(m?.average_spo2_pct ?? rpt?.oxygenation?.meanSpO2, '%')}
                l2="Baseline SpO₂"
                v2={fmt(m?.baseline_spo2_pct ?? rpt?.oxygenation?.baselineSpO2, '%')}
              />
              <MetricPair
                shade
                l1="Nadir SpO₂"
                v1={fmt(m?.minimum_spo2_pct ?? rpt?.oxygenation?.nadirSpO2, '%')}
                l2="Biggest desaturation"
                v2={fmt(m?.biggest_desaturation_pct ?? rpt?.oxygenation?.deepestDesat, '%')}
              />
              <MetricPair
                l1="T90 (time < 90%)"
                v1={fmt(m?.time_below_90_pct ?? rpt?.oxygenation?.t90Pct, '%')}
                l2="Desaturation index"
                v2={fmt(m?.desaturation_index ?? rpt?.respiratoryIndices?.odi3, '/h')}
              />
              {(m?.count_below_90 != null || m?.count_below_80 != null) && (
                <MetricPair
                  shade
                  l1="Events below 90%"
                  v1={m?.count_below_90 != null ? String(m.count_below_90) : '-'}
                  l2="Events below 80%"
                  v2={m?.count_below_80 != null ? String(m.count_below_80) : '-'}
                />
              )}
            </tbody>
          </table>
          <SpO2Bar
            mean={m?.average_spo2_pct ?? rpt?.oxygenation?.meanSpO2}
            baseline={m?.baseline_spo2_pct ?? rpt?.oxygenation?.baselineSpO2}
            nadir={m?.minimum_spo2_pct ?? rpt?.oxygenation?.nadirSpO2}
          />
          {c.sectionReviews?.oxygenation?.editedValue && (
            <ReviewerNote text={c.sectionReviews.oxygenation.editedValue} />
          )}
        </section>
      )}

      {/* ── POSITIONAL ANALYSIS ───────────────────────────────────────────────── */}
      {(rpt?.positional || m?.supine_fraction_pct != null) && (
        <section style={sectionStyle}>
          <div style={sectionTitleStyle}>Positional Analysis</div>
          <table style={tableStyle}>
            <tbody>
              {(rpt?.positional?.supineAhi != null || rpt?.positional?.nonSupineAhi != null) && (
                <MetricPair
                  l1="Supine AHI [/h]"
                  v1={fmt(rpt?.positional?.supineAhi)}
                  l2="Non-supine AHI [/h]"
                  v2={fmt(rpt?.positional?.nonSupineAhi)}
                />
              )}
              <MetricPair
                shade={rpt?.positional?.supineAhi != null || rpt?.positional?.nonSupineAhi != null}
                l1="Supine fraction"
                v1={fmt(m?.supine_fraction_pct ?? rpt?.positional?.supineTimePct, '%')}
                l2="Non-supine fraction"
                v2={fmt(
                  m?.not_supine_fraction_pct ??
                    (rpt?.positional?.supineTimePct != null
                      ? 100 - rpt.positional.supineTimePct
                      : undefined),
                  '%',
                )}
              />
              {(m?.left_fraction_pct != null || m?.right_fraction_pct != null) && (
                <MetricPair
                  l1="Left fraction"
                  v1={fmt(m?.left_fraction_pct ?? rpt?.positional?.leftTimePct, '%')}
                  l2="Right fraction"
                  v2={fmt(m?.right_fraction_pct ?? rpt?.positional?.rightTimePct, '%')}
                />
              )}
              {m?.prone_fraction_pct != null && (
                <MetricPair shade l1="Prone fraction" v1={fmt(m.prone_fraction_pct, '%')} />
              )}
            </tbody>
          </table>
          <PositionBar
            supine={m?.supine_fraction_pct ?? rpt?.positional?.supineTimePct}
            left={m?.left_fraction_pct ?? rpt?.positional?.leftTimePct}
            right={m?.right_fraction_pct ?? rpt?.positional?.rightTimePct}
            prone={m?.prone_fraction_pct ?? rpt?.positional?.proneTimePct}
            upright={m?.upright_fraction_pct ?? rpt?.positional?.uprightTimePct}
          />
          {c.sectionReviews?.positional?.editedValue && (
            <ReviewerNote text={c.sectionReviews.positional.editedValue} />
          )}
        </section>
      )}

      {/* ── SNORE ANALYSIS ────────────────────────────────────────────────────── */}
      {(m?.snore_index != null || rpt?.snoring) && (
        <section style={sectionStyle}>
          <div style={sectionTitleStyle}>Snore Analysis</div>
          <table style={tableStyle}>
            <tbody>
              <MetricPair
                l1="Snore index [/h]"
                v1={m?.snore_index != null ? fmt(m.snore_index) : fmt(rpt?.snoring?.snoreIndex)}
                l2="Snore events"
                v2={m?.snore_count != null ? String(m.snore_count) : '-'}
              />
              {rpt?.snoring?.snoreTimePct != null && (
                <MetricPair
                  shade
                  l1="Snore time"
                  v1={fmt(rpt.snoring.snoreTimePct, '% of sleep')}
                />
              )}
            </tbody>
          </table>
          {c.sectionReviews?.snoring?.editedValue && (
            <ReviewerNote text={c.sectionReviews.snoring.editedValue} />
          )}
        </section>
      )}

      {/* ── HEART RATE ────────────────────────────────────────────────────────── */}
      {(rpt?.cardiac || m?.hr_average != null) && (
        <section style={sectionStyle}>
          <div style={sectionTitleStyle}>Heart Rate</div>
          <table style={{ ...tableStyle, fontSize: '9pt' }}>
            <thead>
              <tr style={{ background: '#f0f4fa' }}>
                <td style={{ ...labelCell, fontWeight: 'bold', fontSize: '8pt' }} />
                <td style={{ ...valueCell, fontWeight: 'bold', fontSize: '8pt', color: '#555' }}>
                  {m?.hr_wake_mean != null ? 'Sleep' : ''}
                </td>
                {m?.hr_wake_mean != null && (
                  <>
                    <td
                      style={{
                        ...labelCell,
                        paddingLeft: '10pt',
                        fontWeight: 'bold',
                        fontSize: '8pt',
                        color: '#555',
                      }}
                    />
                    <td
                      style={{ ...valueCell, fontWeight: 'bold', fontSize: '8pt', color: '#555' }}
                    >
                      Wake
                    </td>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              <MetricPair
                l1="Mean HR [bpm]"
                v1={fmt(m?.hr_average ?? rpt?.cardiac?.meanHr, '', 0)}
                {...(m?.hr_wake_mean != null
                  ? { l2: 'Mean HR [bpm]', v2: fmt(m.hr_wake_mean, '', 0) }
                  : {})}
              />
              <MetricPair
                shade
                l1="Min HR [bpm]"
                v1={fmt(m?.hr_minimum ?? rpt?.cardiac?.minHr, '', 0)}
                {...(m?.hr_wake_min != null
                  ? { l2: 'Min HR [bpm]', v2: fmt(m.hr_wake_min, '', 0) }
                  : {})}
              />
              <MetricPair
                l1="Max HR [bpm]"
                v1={fmt(m?.hr_maximum ?? rpt?.cardiac?.maxHr, '', 0)}
                {...(m?.hr_wake_max != null
                  ? { l2: 'Max HR [bpm]', v2: fmt(m.hr_wake_max, '', 0) }
                  : {})}
              />
            </tbody>
          </table>
          <HrRangeChart
            sleepMin={m?.hr_minimum ?? rpt?.cardiac?.minHr}
            sleepMean={m?.hr_average ?? rpt?.cardiac?.meanHr}
            sleepMax={m?.hr_maximum ?? rpt?.cardiac?.maxHr}
            wakeMin={m?.hr_wake_min ?? rpt?.cardiac?.wakeMinHr}
            wakeMean={m?.hr_wake_mean ?? rpt?.cardiac?.wakeMeanHr}
            wakeMax={m?.hr_wake_max ?? rpt?.cardiac?.wakeMaxHr}
          />
          {c.sectionReviews?.cardiac?.editedValue && (
            <ReviewerNote text={c.sectionReviews.cardiac.editedValue} />
          )}
        </section>
      )}

      {/* ── STUDY QUALITY ─────────────────────────────────────────────────────── */}
      {(rpt?.studyQuality?.channelIssues?.length ?? 0) > 0 && (
        <section style={sectionStyle}>
          <div style={sectionTitleStyle}>Study Quality</div>
          <ul style={{ margin: '0', paddingLeft: '14pt', fontSize: '9pt' }}>
            {rpt!.studyQuality.channelIssues.map((issue, i) => (
              <li key={i} style={{ margin: '1.5pt 0' }}>
                {issue}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── VALIDATION NOTES ──────────────────────────────────────────────────── */}
      {(warningFlags.length > 0 || (c.validationWarnings?.length ?? 0) > 0) && (
        <section style={sectionStyle}>
          <div style={sectionTitleStyle}>Validation Notes</div>
          {warningFlags.map((f, i) => (
            <div
              key={i}
              style={{
                fontSize: '8.5pt',
                marginBottom: '3pt',
                paddingLeft: '6pt',
                borderLeft: `2pt solid ${ACCENT}`,
              }}
            >
              <strong>{f.ruleId}</strong>: {f.issue}
            </div>
          ))}
          {c.validationWarnings?.map((w, i) => (
            <div
              key={i}
              style={{
                fontSize: '8.5pt',
                marginBottom: '3pt',
                paddingLeft: '6pt',
                borderLeft: '1pt solid #ccc',
              }}
            >
              {w.reason}
            </div>
          ))}
        </section>
      )}

      {/* ── EVIDENCE APPENDIX ─────────────────────────────────────────────────── */}
      {confirmedFindings.length > 0 && (
        <section style={{ ...sectionStyle, marginTop: '12pt' }}>
          <div style={{ ...sectionTitleStyle, fontSize: '7.5pt' }}>
            Evidence Appendix - {confirmedFindings.length} confirmed finding
            {confirmedFindings.length !== 1 ? 's' : ''}
          </div>
          {confirmedFindings.map((f, i) => (
            <div
              key={f.id}
              style={{
                fontSize: '8pt',
                marginTop: '2pt',
                paddingLeft: '6pt',
                paddingBottom: '2.5pt',
                borderBottom: '0.25pt solid #ebebeb',
              }}
            >
              <span style={{ fontFamily: 'monospace', color: '#aaa' }}>
                F-{String(i + 1).padStart(3, '0')}
              </span>
              {' · '}
              <span
                style={{
                  fontWeight: 'bold',
                  fontSize: '7.5pt',
                  color:
                    f.confidence === 'high'
                      ? '#2E7D32'
                      : f.confidence === 'low'
                        ? '#BF360C'
                        : '#777',
                }}
              >
                {f.confidence}
              </span>
              {' - '}
              {f.editedClaim ?? f.claim}
              {f.uncertainty && <span style={{ color: '#888' }}> [{f.uncertainty}]</span>}
            </div>
          ))}
        </section>
      )}

      {/* ── ACTION PLAN ───────────────────────────────────────────────────────── */}
      {c.actionPlan && <ActionPlanSection plan={c.actionPlan} />}

      {/* ── WAVEFORM APPENDIX ─────────────────────────────────────────────────── */}
      {signalSlices.length > 0 &&
        (() => {
          const PDF_WAVEFORM_CAP = 20;
          const sorted = [...signalSlices].sort((a, b) => b.magnitude - a.magnitude);
          const shown = sorted.slice(0, PDF_WAVEFORM_CAP);
          const truncated = sorted.length > PDF_WAVEFORM_CAP;
          return (
            <section style={{ marginTop: '14pt', pageBreakBefore: 'always' }}>
              <div style={sectionTitleStyle}>
                Waveform Appendix — {shown.length} of {signalSlices.length} event
                {signalSlices.length !== 1 ? 's' : ''} (highest magnitude)
              </div>
              <p style={{ fontSize: '8pt', color: '#64748b', marginBottom: 8 }}>
                30-second context window centred on each detected event. Bands mark event
                boundaries. Provisional — clinician sign-off required before clinical use.
                {truncated &&
                  ` ${sorted.length - PDF_WAVEFORM_CAP} lower-magnitude event${sorted.length - PDF_WAVEFORM_CAP !== 1 ? 's' : ''} omitted — visible in the interactive review tool.`}
              </p>
              {shown.map((ev, i) => (
                <EventWaveformSnapshot key={ev.eventId} event={ev} index={i} />
              ))}
            </section>
          );
        })()}

      {/* ── FOOTER ────────────────────────────────────────────────────────────── */}
      <footer
        style={{
          marginTop: '16pt',
          paddingTop: '5pt',
          borderTop: `0.5pt solid ${ACCENT}`,
          fontSize: '7.5pt',
          color: '#888',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            <tr>
              <td>
                AI-assisted draft · Reviewed and signed off by <strong>{reviewer}</strong> ·{' '}
                {new Date(signedAt).toLocaleString()} · Not for autonomous diagnosis.
              </td>
              <td style={{ textAlign: 'right', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                {c.studyHash.slice(0, 12)} · {c.modelVersion} · prompt {c.promptVersion}
              </td>
            </tr>
          </tbody>
        </table>
      </footer>
    </div>
  );
}
