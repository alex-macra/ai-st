import { forwardRef, useEffect, useState } from 'react';
import { Check, ChevronDown, ChevronUp, X, HelpCircle, Pencil, Activity } from 'lucide-react';
import { Textarea, Chip } from '../ui';
import { EvidencePanel } from './EvidencePanel';
import { ConfidencePopover } from './ConfidencePopover';
import type { Finding, FindingConfidence, ReviewerDecision, EventSlice } from '../shared/types';

interface Props {
  finding: Finding;
  index: number;
  caseId: string;
  locked: boolean;
  isFocused: boolean;
  editCounter?: number | undefined;
  signalSlices?: EventSlice[] | undefined;
  onDecision: (findingId: string, decision: ReviewerDecision, editedClaim?: string) => Promise<void>;
}

const DECISION_CHIP: Record<ReviewerDecision, string> = {
  confirm:  'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  reject:   'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  uncertain:'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  edit:     'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  artefact: 'bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300',
};

const DECISION_LABELS: Record<ReviewerDecision, string> = {
  confirm:  'Confirmed',
  reject:   'Rejected',
  uncertain:'Uncertain',
  edit:     'Edited',
  artefact: 'Artefact',
};

const CONFIDENCE_ACCENT: Record<FindingConfidence, string> = {
  high:   'border-l-4 border-l-emerald-500 dark:border-l-emerald-400',
  medium: 'border-l-4 border-l-amber-500 dark:border-l-amber-400',
  low:    'border-l-4 border-l-rose-500 dark:border-l-rose-400',
};

export const FindingCard = forwardRef<HTMLDivElement, Props>(function FindingCard(
  { finding, index, caseId, locked, isFocused, editCounter, signalSlices, onDecision },
  ref,
) {
  const [expanded, setExpanded] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [editText, setEditText] = useState(finding.editedClaim ?? finding.claim);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editCounter && editCounter > 0) {
      setEditText(finding.editedClaim ?? finding.claim);
      setEditMode(true);
    }
  // editCounter increment is the trigger; other deps are intentionally excluded
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editCounter]);

  const displayClaim = finding.reviewerDecision === 'edit' && finding.editedClaim
    ? finding.editedClaim
    : finding.claim;

  const chipStyle = finding.reviewerDecision
    ? DECISION_CHIP[finding.reviewerDecision]
    : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200';
  const chipLabel = finding.reviewerDecision ? DECISION_LABELS[finding.reviewerDecision] : 'Pending review';

  async function handleDecision(decision: ReviewerDecision) {
    if (saving) return;
    setSaving(true);
    try { await onDecision(finding.id, decision); }
    finally { setSaving(false); }
  }

  async function handleEditSubmit() {
    if (!editText.trim() || saving) return;
    setSaving(true);
    try {
      await onDecision(finding.id, 'edit', editText.trim());
      setEditMode(false);
    } finally { setSaving(false); }
  }

  return (
    <div
      ref={ref}
      className={`card p-3 ${CONFIDENCE_ACCENT[finding.confidence]}${isFocused ? ' ring-2 ring-teal-500 dark:ring-teal-400 ring-offset-2' : ''}`}
    >
      {/* Claim row */}
      <div className="flex items-start gap-2">
        <Chip className="chip-muted shrink-0 text-[10px] mt-0.5">F-{String(index + 1).padStart(3, '0')}</Chip>
        <div className="flex-1 min-w-0">
          {editMode ? (
            <Textarea
              rows={3}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              disabled={saving}
            />
          ) : (
            <p className="text-sm leading-snug">{displayClaim}</p>
          )}
          {finding.reviewerDecision === 'edit' && finding.editedClaim && !editMode && (
            <p className="text-xs text-slate-400 mt-0.5 italic">Original: {finding.claim}</p>
          )}
          {finding.uncertainty && (
            <p className="text-xs text-amber-700 dark:text-amber-400 italic mt-1">{finding.uncertainty}</p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <ConfidencePopover finding={finding} />
          <Chip className={`text-[10px] ${chipStyle}`}>{chipLabel}</Chip>
          <button
            className="rounded p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? 'Hide evidence' : 'Show evidence'}
            aria-label={expanded ? 'Hide evidence' : 'Show evidence'}
            aria-expanded={expanded}
          >
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        </div>
      </div>

      {/* Reviewer actions */}
      {!locked && (
        <div className="flex items-center gap-0.5 mt-1.5">
          {editMode ? (
            <>
              <button
                className="btn-teal text-xs py-0.5 px-2"
                onClick={() => void handleEditSubmit()}
                disabled={saving || !editText.trim()}
              >
                Save
              </button>
              <button
                className="btn-ghost text-xs py-0.5 px-2"
                onClick={() => { setEditMode(false); setEditText(finding.editedClaim ?? finding.claim); }}
                disabled={saving}
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                title="Confirm"
                aria-label="Confirm"
                aria-pressed={finding.reviewerDecision === 'confirm'}
                className={`inline-flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-medium transition-colors ${finding.reviewerDecision === 'confirm' ? 'text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-900/20' : 'text-slate-500 hover:text-green-700 hover:bg-green-50 dark:text-slate-300 dark:hover:text-green-300 dark:hover:bg-green-900/20'}`}
                onClick={() => void handleDecision('confirm')}
                disabled={saving}
              >
                <Check aria-hidden="true" size={12} /> Confirm
              </button>
              <button
                title="Reject"
                aria-label="Reject"
                aria-pressed={finding.reviewerDecision === 'reject'}
                className={`rounded p-1 transition-colors ${finding.reviewerDecision === 'reject' ? 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20' : 'text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20'}`}
                onClick={() => void handleDecision('reject')}
                disabled={saving}
              >
                <X size={12} />
              </button>
              <button
                title="Uncertain"
                aria-label="Uncertain"
                aria-pressed={finding.reviewerDecision === 'uncertain'}
                className={`rounded p-1 transition-colors ${finding.reviewerDecision === 'uncertain' ? 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20' : 'text-slate-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20'}`}
                onClick={() => void handleDecision('uncertain')}
                disabled={saving}
              >
                <HelpCircle size={12} />
              </button>
              <button
                title="Edit claim"
                aria-label="Edit claim"
                aria-pressed={finding.reviewerDecision === 'edit'}
                className={`rounded p-1 transition-colors ${finding.reviewerDecision === 'edit' ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20' : 'text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20'}`}
                onClick={() => { setEditText(finding.editedClaim ?? finding.claim); setEditMode(true); }}
                disabled={saving}
              >
                <Pencil size={12} />
              </button>
              <button
                title="Signal artefact — false positive"
                aria-label="Signal artefact — false positive"
                aria-pressed={finding.reviewerDecision === 'artefact'}
                className={`rounded p-1 transition-colors ${finding.reviewerDecision === 'artefact' ? 'text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-900/20' : 'text-slate-400 hover:text-violet-500 hover:bg-violet-50 dark:hover:bg-violet-900/20'}`}
                onClick={() => void handleDecision('artefact')}
                disabled={saving}
              >
                <Activity size={12} />
              </button>
            </>
          )}
        </div>
      )}

      {expanded && (
        <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          <EvidencePanel caseId={caseId} evidence={finding.evidence} signalSlices={signalSlices} />
        </div>
      )}
    </div>
  );
});
