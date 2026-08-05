// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react';
import { FlaskConical, Download } from 'lucide-react';
import { Alert, Button } from '../ui';
import { getDemoStudyFile, getDemoStudySummary, type DemoStudySummary } from '../api';

interface Props {
  /** Hands the generated recording to the upload form. */
  onLoadStudy: (file: File) => void;
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours === 0) return `${minutes} min`;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

/**
 * The starting point for anyone evaluating this without a study of their own.
 *
 * The recording it produces is generated from a fixed seed, so what it says
 * below about the file is a description of the generator rather than a guess,
 * and it goes through the same upload, preprocessing, and review path as a real
 * one. Nothing here bypasses a step.
 */
export function DemoPanel({ onLoadStudy }: Props) {
  const [summary, setSummary] = useState<DemoStudySummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getDemoStudySummary()
      .then((value) => {
        if (!cancelled) setSummary(value);
      })
      .catch(() => {
        // The panel still works without it; only the description is lost.
        if (!cancelled) setSummary(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLoad() {
    setLoading(true);
    setError(null);
    try {
      onLoadStudy(await getDemoStudyFile());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate the demo study');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section
      aria-labelledby="demo-panel-heading"
      className="card space-y-4 border-dashed p-6"
      data-testid="demo-panel"
    >
      <div className="flex items-start gap-3">
        <FlaskConical size={18} className="mt-0.5 shrink-0 text-teal-600 dark:text-teal-400" />
        <div className="min-w-0">
          <h2 id="demo-panel-heading" className="text-base font-semibold">
            Try it with a demo study
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            A synthetic overnight recording, generated on request. It is not a recording of a
            person, and it goes through the same upload, preprocessing, and review path as a real
            study.
          </p>
        </div>
      </div>

      {summary && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-slate-500 dark:text-slate-400">Duration</dt>
            <dd className="font-medium">{formatDuration(summary.durationSec)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500 dark:text-slate-400">Channels</dt>
            <dd className="font-medium">{summary.channels.join(', ')}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500 dark:text-slate-400">Events written in</dt>
            <dd className="font-medium">
              {summary.apneas} apneas, {summary.hypopneas} hypopneas
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500 dark:text-slate-400">Expected event index</dt>
            <dd className="font-medium">≈{summary.expectedEventIndexPerHour}/h</dd>
          </div>
          <div className="col-span-2 sm:col-span-1">
            <dt className="text-xs text-slate-500 dark:text-slate-400">Positional split</dt>
            <dd className="font-medium">
              {summary.supineEvents} supine, {summary.nonSupineEvents} non-supine
            </dd>
          </div>
        </dl>
      )}

      <p className="text-xs text-slate-500 dark:text-slate-400">
        The counts above are what the generator wrote into the signal. The detector works them out
        again from the waveform on its own, so the numbers it reports will be close but not
        identical — comparing the two is a reasonable way to see what the preprocessing stage
        actually does.
      </p>

      {error && <Alert variant="danger">{error}</Alert>}

      <Button
        onClick={() => void handleLoad()}
        loading={loading}
        variant="secondary"
        icon={<Download size={14} />}
      >
        {loading ? 'Generating…' : 'Load demo study'}
      </Button>
    </section>
  );
}
