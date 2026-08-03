import { useState } from 'react';
import { Check, X, Loader2, Clock, ChevronDown, ChevronRight } from 'lucide-react';

export type StageId = 'pass1' | 'pass2' | 'pass3' | 'pass3b';
export type StageStatus = 'pending' | 'running' | 'passed' | 'failed';

export interface StageState {
  status: StageStatus;
  message?: string;
  elapsedMs?: number;
  tokensIn?: number;
  tokensOut?: number;
  findingCount?: number;
  warningCount?: number;
  flagCount?: number;
}

interface StageDef {
  id: StageId;
  label: string;
  subtitle: string;
}

const STAGE_DEFS: StageDef[] = [
  { id: 'pass1',  label: 'Pass 1',  subtitle: 'Fact Extraction'   },
  { id: 'pass2',  label: 'Pass 2',  subtitle: 'Report Draft'      },
  { id: 'pass3',  label: 'Pass 3',  subtitle: 'Validation'        },
  { id: 'pass3b', label: 'Pass 3b', subtitle: 'Reference Check'   },
];

function formatMs(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function StatusIcon({ status }: { status: StageStatus }) {
  switch (status) {
    case 'running': return <Loader2 size={13} className="animate-spin text-teal-500" />;
    case 'passed':  return <Check   size={13} className="text-teal-600 dark:text-teal-400" />;
    case 'failed':  return <X       size={13} className="text-red-500" />;
    case 'pending': return <div className="w-3 h-3 rounded-full border border-slate-300 dark:border-slate-600" />;
  }
}

interface Props {
  stages: Partial<Record<StageId, StageState>>;
  analyzing: boolean;
}

export function AnalysisPipeline({ stages, analyzing }: Props) {
  const [expanded, setExpanded] = useState<Set<StageId>>(new Set());

  const anyVisible = analyzing || Object.keys(stages).length > 0;
  if (!anyVisible) return null;

  function toggle(id: StageId) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <div className="card card-muted p-3 space-y-0">
      {STAGE_DEFS.map((def, i) => {
        const st = stages[def.id];
        // hide pass3b until it's been initiated
        if (!st && def.id === 'pass3b') return null;

        const status: StageStatus = st?.status ?? 'pending';
        const isExpanded = expanded.has(def.id);
        const hasDetails = status === 'passed' && st != null && (
          st.tokensIn != null || st.findingCount != null ||
          st.warningCount != null || st.flagCount != null
        );

        return (
          <div key={def.id}>
            {i > 0 && <div className="ml-[5px] w-px h-2 bg-slate-200 dark:bg-slate-700" />}
            <div
              className={`flex items-center gap-2.5 rounded px-1.5 py-1 ${hasDetails ? 'cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800/50' : ''}`}
              onClick={() => hasDetails && toggle(def.id)}
            >
              <div className="shrink-0 w-3.5 flex items-center justify-center">
                <StatusIcon status={status} />
              </div>

              <div className="flex-1 min-w-0 flex items-baseline gap-1.5">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">{def.label}</span>
                <span className="text-xs text-slate-400">-</span>
                <span className="text-xs text-slate-500">{def.subtitle}</span>
                {status === 'running' && st?.message && (
                  <span className="text-xs text-slate-400 italic truncate">{st.message}</span>
                )}
              </div>

              {st?.elapsedMs != null && (
                <span className="text-[10px] font-mono text-slate-400 flex items-center gap-0.5 shrink-0">
                  <Clock size={9} />
                  {formatMs(st.elapsedMs)}
                </span>
              )}

              {hasDetails && (
                isExpanded
                  ? <ChevronDown  size={11} className="text-slate-400 shrink-0" />
                  : <ChevronRight size={11} className="text-slate-400 shrink-0" />
              )}
            </div>

            {isExpanded && hasDetails && st && (
              <div className="ml-7 mt-0.5 mb-1 px-1.5 grid grid-cols-2 gap-x-6 gap-y-0.5 text-[10px] font-mono">
                {st.tokensIn  != null && <span className="text-slate-400">in: {formatTokens(st.tokensIn)}</span>}
                {st.tokensOut != null && <span className="text-slate-400">out: {formatTokens(st.tokensOut)}</span>}
                {st.findingCount != null && (
                  <span className="col-span-2 text-slate-400">findings: {st.findingCount}</span>
                )}
                {st.warningCount != null && (
                  <span className={`col-span-2 ${st.warningCount > 0 ? 'text-amber-500' : 'text-slate-400'}`}>
                    warnings: {st.warningCount}
                  </span>
                )}
                {st.flagCount != null && (
                  <span className={`col-span-2 ${st.flagCount > 0 ? 'text-amber-500' : 'text-slate-400'}`}>
                    ref flags: {st.flagCount}
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
