// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { ShieldCheck, FileDown } from 'lucide-react';
import { Button, Input } from '../ui';
import type { Case } from '@contracts/types';
import { populatedReportSections, reviewIsComplete } from '@contracts/review';
import { buildPdfFilename, printWithFilename } from '../utils';

interface Props {
  c: Case;
  onSignOff: (actorId: string) => Promise<void>;
}

export function SignOffPanel({ c, onSignOff }: Props) {
  const [reviewerName, setReviewerName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (c.status === 'signed_off') {
    return (
      <div className="flex items-center gap-2 rounded-lg px-3 py-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
        <ShieldCheck size={14} className="text-green-600 dark:text-green-400 shrink-0" />
        <p className="text-xs font-medium text-green-800 dark:text-green-300 flex-1">
          Case signed off
        </p>
        <Button
          size="sm"
          onClick={() => printWithFilename(buildPdfFilename(c))}
          title="Open the browser print dialog — choose 'Save as PDF' to export"
          icon={<FileDown size={12} />}
        >
          Export PDF
        </Button>
      </div>
    );
  }

  const total = c.findings.length;
  const reviewed = c.findings.filter((f) => f.reviewerDecision).length;
  const actioned = c.findings.filter(
    (f) => f.reviewerDecision && f.reviewerDecision !== 'confirm',
  ).length;

  const sections = c.structuredReport ? populatedReportSections(c.structuredReport) : [];
  const reviewedSections = sections.filter((k) => c.sectionReviews?.[k]);
  const reviewComplete = reviewIsComplete(c);

  async function handleSignOff() {
    if (!reviewerName.trim() || saving || !reviewComplete) return;
    setSaving(true);
    setError(null);
    try {
      await onSignOff(reviewerName.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-off failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Input
          type="text"
          aria-label="Reviewer name"
          className="flex-1 min-w-0"
          placeholder="Reviewer name"
          value={reviewerName}
          onChange={(e) => setReviewerName(e.target.value)}
          disabled={saving || total === 0}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleSignOff();
          }}
        />
        <Button
          size="sm"
          onClick={() => void handleSignOff()}
          loading={saving}
          disabled={!reviewerName.trim() || !reviewComplete}
          icon={<ShieldCheck size={13} />}
          className="shrink-0"
        >
          {saving ? 'Signing…' : 'Sign off'}
        </Button>
      </div>
      {total > 0 && (
        <p className="text-[10px] text-slate-400 dark:text-slate-500">
          {reviewed}/{total} findings reviewed
          {actioned > 0 && ` · ${actioned} marked for follow-up`}
          {sections.length > 0 &&
            ` · ${reviewedSections.length}/${sections.length} sections reviewed`}
        </p>
      )}
      {total > 0 && !reviewComplete && (
        <p className="text-[10px] font-medium text-amber-700 dark:text-amber-300">
          Complete all finding and report-section reviews to enable sign-off.
        </p>
      )}
      {total === 0 && (
        <p className="text-[10px] text-slate-400">Run analysis before signing off.</p>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
