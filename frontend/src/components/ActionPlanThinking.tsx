import { useEffect, useState } from 'react';
import { Loader2, Check, Sparkles } from 'lucide-react';

interface Phase {
  id: string;
  label: string;
}

const PHASES: Phase[] = [
  { id: 'review',    label: 'Reviewing high-confidence findings' },
  { id: 'priority',  label: 'Synthesising priority actions' },
  { id: 'verify',    label: 'Drafting verification steps' },
  { id: 'artefact',  label: 'Checking for artefact caveats' },
  { id: 'context',   label: 'Composing clinical context' },
  { id: 'evidence',  label: 'Compiling evidence references' },
];

const PHASE_INTERVAL_MS = 2200;

export function ActionPlanThinking() {
  const [activeIdx, setActiveIdx] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setActiveIdx((i) => Math.min(i + 1, PHASES.length - 1));
    }, PHASE_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="card card-muted p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles size={15} className="text-teal-500 animate-pulse" />
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
          Generating action plan
        </span>
        <span className="ml-auto text-[10px] font-mono text-slate-400">pass 4</span>
      </div>

      <div className="space-y-1.5">
        {PHASES.map((p, i) => {
          const status: 'done' | 'active' | 'pending' =
            i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'pending';
          return (
            <div key={p.id} className="flex items-center gap-2.5 px-1">
              <div className="shrink-0 w-3.5 flex items-center justify-center">
                {status === 'active' && <Loader2 size={12} className="animate-spin text-teal-500" />}
                {status === 'done'   && <Check    size={12} className="text-teal-600 dark:text-teal-400" />}
                {status === 'pending' && (
                  <div className="w-2.5 h-2.5 rounded-full border border-slate-300 dark:border-slate-600" />
                )}
              </div>
              <span
                className={
                  status === 'pending'
                    ? 'text-xs text-slate-400 dark:text-slate-500'
                    : status === 'active'
                    ? 'text-xs text-slate-700 dark:text-slate-200'
                    : 'text-xs text-slate-500 dark:text-slate-400'
                }
              >
                {p.label}
                {status === 'active' && <span className="ml-1 animate-pulse">…</span>}
              </span>
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-slate-400 dark:text-slate-500 italic pt-1">
        The model is producing the full plan in a single pass; phases are indicative.
      </p>
    </div>
  );
}
