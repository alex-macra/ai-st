import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Timeline,
  type TimelineEvent,
  type TimelineDotTone,
  TokenUsagePanel,
  type TokenUsageRow,
  Badge,
} from '../ui';
import { getAuditLog } from '../api';
import type { AuditRecord, TokenStats } from '../shared/types';
import { MODEL_PRICING, DEFAULT_MODEL_PRICING } from '../constants';

interface Props {
  caseId: string;
}

const ACTION_LABELS: Record<string, string> = {
  case_created: 'Case created',
  analysis_completed: 'Analysis completed',
  signed_off: 'Signed off',
  finding_confirm: 'Finding confirmed',
  finding_reject: 'Finding rejected',
  finding_uncertain: 'Finding marked uncertain',
  finding_edit: 'Finding edited',
  finding_artefact: 'Finding marked as artefact',
};

// Unmapped actions fall back to gray.
const ACTION_TONE: Record<string, TimelineDotTone> = {
  analysis_completed: 'info',
  signed_off:         'success',
  finding_confirm:    'success',
  finding_reject:     'danger',
  finding_artefact:   'danger',
  finding_uncertain:  'warning',
  finding_edit:       'warning',
};

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action.replace(/_/g, ' ');
}

function MetaBadge({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <Badge>
      <span className="text-ui-text-subtle">{label}:</span>{' '}
      <span className={mono ? 'mono' : undefined}>{value}</span>
    </Badge>
  );
}

function metaBadges(meta: Record<string, unknown>): ReactNode {
  const items: ReactNode[] = [];
  if (typeof meta['modelVersion'] === 'string') {
    items.push(<MetaBadge key="model" label="model" value={meta['modelVersion']} />);
  }
  if (typeof meta['promptVersion'] === 'string') {
    items.push(<MetaBadge key="prompt" label="prompt" value={meta['promptVersion']} />);
  }
  if (typeof meta['studyHash'] === 'string') {
    items.push(<MetaBadge key="hash" label="hash" value={meta['studyHash'].slice(0, 12) + '…'} mono />);
  }
  if (typeof meta['findingId'] === 'string') {
    items.push(<MetaBadge key="finding" label="finding" value={meta['findingId']} mono />);
  }
  return items.length > 0 ? <>{items}</> : null;
}

function buildEvents(records: AuditRecord[]): TimelineEvent[] {
  return records.map((r) => {
    const meta = r.metadata ?? {};
    const badges = metaBadges(meta);
    const event: TimelineEvent = {
      id: r.id,
      title: actionLabel(r.action),
      timestamp: r.createdAt,
    };
    if (r.actorId) event.actor = r.actorId;
    if (badges) event.meta = badges;
    const tone = ACTION_TONE[r.action];
    if (tone) event.tone = tone;
    return event;
  });
}

function buildTokenRows(stats: TokenStats): TokenUsageRow[] {
  const rows: TokenUsageRow[] = [
    { label: 'Pass 1', input: stats.pass1In, output: stats.pass1Out },
    { label: 'Pass 2', input: stats.pass2In, output: stats.pass2Out },
    { label: 'Pass 3', input: stats.pass3In, output: stats.pass3Out },
  ];
  if (stats.pass4In != null && stats.pass4Out != null) {
    rows.push({ label: 'Plan', input: stats.pass4In, output: stats.pass4Out });
  }
  return rows;
}

function computeCost(stats: TokenStats, modelVersion?: string): number {
  const pricing = (modelVersion ? MODEL_PRICING[modelVersion] : undefined) ?? DEFAULT_MODEL_PRICING;
  const totalIn = stats.pass1In + stats.pass2In + stats.pass3In + (stats.pass4In ?? 0);
  const totalOut = stats.pass1Out + stats.pass2Out + stats.pass3Out + (stats.pass4Out ?? 0);
  return (totalIn / 1_000_000) * pricing.inputPer1M + (totalOut / 1_000_000) * pricing.outputPer1M;
}

export function AuditTrail({ caseId }: Props) {
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [tokenStats, setTokenStats] = useState<TokenStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getAuditLog(caseId)
      .then(({ auditLog, tokenStats: ts }) => {
        if (!cancelled) {
          setRecords(auditLog);
          setTokenStats(ts);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load audit trail');
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [caseId]);

  if (loading) return <p className="text-xs text-slate-400">Loading audit trail…</p>;
  if (error) return <p className="text-xs text-red-500">{error}</p>;

  const modelVersion = records.find(
    (r) => r.action === 'analysis_completed' && typeof r.metadata?.['modelVersion'] === 'string'
  )?.metadata?.['modelVersion'];
  const modelVersionStr = typeof modelVersion === 'string' ? modelVersion : undefined;

  // Hide the panel when there are no records: tokenStats can arrive mid-analysis
  // (before analysis_completed), which would otherwise show usage next to
  // "No audit records yet."
  const showTokenPanel = records.length > 0 && tokenStats !== null;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-400">Audit trail</h3>
      <Timeline events={buildEvents(records)} emptyLabel="No audit records yet." />
      {showTokenPanel && (
        <TokenUsagePanel
          rows={buildTokenRows(tokenStats!)}
          costUsd={computeCost(tokenStats!, modelVersionStr)}
          {...(modelVersionStr && { model: modelVersionStr })}
        />
      )}
    </div>
  );
}
