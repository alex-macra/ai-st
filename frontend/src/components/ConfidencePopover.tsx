import { Popover, Badge, Chip, type BadgeVariant } from '../ui';
import { ShieldCheck, AlertTriangle, AlertOctagon } from 'lucide-react';
import type { Finding, FindingConfidence } from '../shared/types';

const CONFIDENCE_VARIANT: Record<FindingConfidence, BadgeVariant> = {
  high:   'success',
  medium: 'warning',
  low:    'danger',
};

interface Props {
  finding: Finding;
}

const LEVEL_LABEL: Record<FindingConfidence, string> = {
  high:   'High confidence',
  medium: 'Medium confidence',
  low:    'Low confidence',
};

const LEVEL_ICON: Record<FindingConfidence, typeof ShieldCheck> = {
  high:   ShieldCheck,
  medium: AlertTriangle,
  low:    AlertOctagon,
};

const LEVEL_COLOR: Record<FindingConfidence, string> = {
  high:   'text-emerald-600 dark:text-emerald-400',
  medium: 'text-amber-600 dark:text-amber-400',
  low:    'text-rose-600 dark:text-rose-400',
};

const FALLBACK: Record<FindingConfidence, string> = {
  high:   'Directly supported by quantitative evidence from the study data.',
  medium: 'Supported with some uncertainty; verify signal quality or clinical context.',
  low:    'Channel quality or coverage below threshold, or borderline signal.',
};

const EVIDENCE_TYPE_LABEL: Record<string, string> = {
  edf_metric:        'EDF',
  event_table:       'Event',
  report_page:       'Report',
  screenshot_window: 'Screenshot',
  pdf_metric:        'PDF',
};

const IMPACT_COLOR: Record<string, string> = {
  positive: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  negative: 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300',
  neutral:  'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
};

const MAX_EVIDENCE_ROWS = 5;

export function ConfidencePopover({ finding }: Props) {
  const Icon = LEVEL_ICON[finding.confidence];
  const visibleEvidence = finding.evidence.slice(0, MAX_EVIDENCE_ROWS);
  const overflowCount = finding.evidence.length - MAX_EVIDENCE_ROWS;

  return (
    <Popover
      openOnHover
      role="tooltip"
      side="bottom"
      label={LEVEL_LABEL[finding.confidence]}
      className="!p-0 w-72 text-xs"
      trigger={
        <Badge
          variant={CONFIDENCE_VARIANT[finding.confidence]}
          className="font-bold uppercase tracking-wide text-[11px] cursor-help"
        >
          <Icon size={12} className="shrink-0" />
          {finding.confidence}
        </Badge>
      }
    >
      <div className={`flex items-center gap-1.5 px-3 py-2 border-b border-ui-border/60 font-semibold ${LEVEL_COLOR[finding.confidence]}`}>
        <Icon size={13} />
        {LEVEL_LABEL[finding.confidence]}
      </div>

      <p className="px-3 py-2 text-ui-text-muted leading-snug border-b border-ui-border/60">
        {finding.confidenceRationale ?? FALLBACK[finding.confidence]}
      </p>

      {finding.confidenceFactors && finding.confidenceFactors.length > 0 && (
        <div className="px-3 py-2 border-b border-ui-border/60 flex flex-wrap gap-1">
          {finding.confidenceFactors.map((f, i) => (
            <span
              key={i}
              className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 ${IMPACT_COLOR[f.impact] ?? IMPACT_COLOR.neutral}`}
            >
              {f.label}{f.value !== undefined ? `: ${f.value}` : ''}
            </span>
          ))}
        </div>
      )}

      {finding.evidence.length > 0 && (
        <div className="px-3 py-2">
          <p className="text-ui-text-subtle mb-1.5 uppercase tracking-wide text-[10px] font-medium">
            Evidence ({finding.evidence.length})
          </p>
          <ul className="space-y-1">
            {visibleEvidence.map((ev, i) => (
              <li key={i} className="flex items-baseline gap-1.5 text-ui-text-muted min-w-0">
                <Chip className="chip-muted shrink-0 text-[9px]">
                  {EVIDENCE_TYPE_LABEL[ev.type] ?? ev.type}
                </Chip>
                <span className="font-mono truncate flex-1 text-[10px]">{ev.source}</span>
                <span className="font-semibold shrink-0 text-ui-text">
                  {typeof ev.value === 'number' ? ev.value.toFixed(2) : ev.value}
                </span>
              </li>
            ))}
            {overflowCount > 0 && (
              <li className="text-ui-text-subtle italic">+ {overflowCount} more</li>
            )}
          </ul>
        </div>
      )}
    </Popover>
  );
}
