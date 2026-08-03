import type { EvidenceRef, EventSlice } from '../shared/types';
import { EventWaveformSnapshot } from './EventWaveformSnapshot';

interface Props {
  caseId: string;
  evidence: EvidenceRef[];
  signalSlices?: EventSlice[] | undefined;
}

const TYPE_LABEL: Record<string, string> = {
  edf_metric:        'EDF metric',
  pdf_metric:        'PDF metric',
  event_table:       'Event table',
  report_page:       'Report page',
  screenshot_window: 'Screenshot',
};

const TYPE_COLOR: Record<string, string> = {
  edf_metric:        'bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300',
  pdf_metric:        'bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300',
  event_table:       'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  report_page:       'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300',
  screenshot_window: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300',
};

function formatSource(source: string): string {
  return source
    .replace(/^study_metrics\./, '')
    .replace(/^pdf_metrics\./, '')
    .replace(/^channels\./, '')
    .replace(/^screenshot:/, '')
    .replace(/_/g, ' ');
}

function formatValue(value: string | number): string {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  return value;
}

export function EvidencePanel({ evidence, signalSlices = [] }: Props) {
  if (evidence.length === 0) {
    return <p className="text-xs text-slate-400 italic">No evidence attached.</p>;
  }

  return (
    <ul className="space-y-1.5">
      {evidence.map((ev, i) => {
        const typeColor = TYPE_COLOR[ev.type] ?? 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300';
        const typeText  = TYPE_LABEL[ev.type] ?? ev.type;
        const matchedSlice = ev.type === 'event_table' && ev.eventId
          ? signalSlices.find((s) => s.eventId === ev.eventId)
          : undefined;
        return (
          <li key={i} className="rounded-md bg-slate-50 dark:bg-slate-800/50 text-xs overflow-hidden">
            <div className="flex items-start gap-2 p-2">
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${typeColor}`}>
                {typeText}
              </span>
              <div className="min-w-0 flex-1">
                <span className="font-mono text-slate-500 dark:text-slate-400 truncate block">
                  {formatSource(ev.source)}
                </span>
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  {formatValue(ev.value)}
                </span>
                {ev.timestamp && (
                  <span className="text-slate-400 ml-2">{ev.timestamp}</span>
                )}
              </div>
            </div>
            {matchedSlice && (
              <details open className="group border-t border-slate-200 dark:border-slate-700">
                <summary className="cursor-pointer select-none px-2 py-1 text-[10px] text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 flex items-center gap-1 list-none">
                  <span className="inline-block transition-transform group-open:rotate-90">▶</span>
                  Waveform
                </summary>
                <div className="overflow-x-auto p-2">
                  <EventWaveformSnapshot event={matchedSlice} index={i} />
                </div>
              </details>
            )}
          </li>
        );
      })}
    </ul>
  );
}
