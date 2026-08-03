import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Play, Square, Sparkles, RefreshCw, FileDown } from 'lucide-react';
import { Alert, Select, Tabs, Badge, Chip, CASE_STATUS_VARIANT, type Tab as SharedTab } from '../ui';
import { FindingCard } from './FindingCard';
import { SignOffPanel } from './SignOffPanel';
import { AuditTrail } from './AuditTrail';
import { StructuredReportView } from './StructuredReportView';
import { PrintableReport } from './PrintableReport';
import { ScreenshotPanel } from './ScreenshotPanel';
import { AnalysisPipeline } from './AnalysisPipeline';
import { ActionPlanView } from './ActionPlanView';
import { ActionPlanThinking } from './ActionPlanThinking';
import type { StageId, StageState } from './AnalysisPipeline';
import { streamAnalysis, streamActionPlan, getCase, patchFindingDecision, patchSectionReview, signOffCase, getModels, fetchSignalSlices } from '../api';
import type { Case, AnalysisEvent, ActionPlanEvent, ReviewerDecision, ReportSectionKey, FindingConfidence, EventSlice } from '../shared/types';
import { EventWaveformSnapshot } from './EventWaveformSnapshot';
import { buildPdfFilename, printWithFilename, stripInlineCitations } from '../utils';
import { reviewIsComplete } from '../shared/review';

interface Props {
  initialCase: Case;
  onBack: () => void;
}

type TabId = 'report' | 'findings' | 'plan' | 'audit';

const KB_SHORTCUTS: [string, string][] = [
  ['J / ↓', 'Next finding'],
  ['K / ↑', 'Previous finding'],
  ['Enter',  'Confirm'],
  ['X',      'Reject'],
  ['U',      'Uncertain'],
  ['E',      'Edit'],
];

function progressEventToStageId(pass: number, message: string): StageId {
  if (pass === 3 && message.toLowerCase().includes('reference')) return 'pass3b';
  if (pass === 3) return 'pass3';
  if (pass === 2) return 'pass2';
  return 'pass1';
}

function stageCompleteToStageId(pass: number | '3b'): StageId {
  if (pass === '3b') return 'pass3b';
  if (pass === 3) return 'pass3';
  if (pass === 2) return 'pass2';
  return 'pass1';
}

function extractScreenshotMetadata(casePackageJson: string | undefined): Array<{ id: string; originalName: string }> {
  if (!casePackageJson) return [];
  try {
    const pkg = JSON.parse(casePackageJson) as Record<string, unknown>;
    const metadata = pkg['screenshot_metadata'] as Array<{ id: string; originalName: string }> | undefined;
    return Array.isArray(metadata) ? metadata : [];
  } catch {
    return [];
  }
}

export function ReviewWorkspace({ initialCase, onBack }: Props) {
  const [c, setC] = useState<Case>(initialCase);
  const [analyzing, setAnalyzing] = useState(false);
  const [stages, setStages] = useState<Partial<Record<StageId, StageState>>>({});
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisNotices, setAnalysisNotices] = useState<string[]>([]);
  const [validationRejections, setValidationRejections] = useState<Array<{ quote: string; reason: string }>>([]);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [activeTab, setActiveTab] = useState<TabId>('report');
  const [focusedIdx, setFocusedIdx] = useState(-1);
  const [editCounters, setEditCounters] = useState<Record<string, number>>({});
  const [showRerunConfirm, setShowRerunConfirm] = useState(false);
  const [planGenerating, setPlanGenerating] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [signalSlices, setSignalSlices] = useState<EventSlice[]>([]);
  const planAbortRef = useRef<AbortController | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const findingRefs = useRef<(HTMLDivElement | null)[]>([]);
  const stageStartTimesRef = useRef<Partial<Record<StageId, number>>>({});

  useEffect(() => {
    getModels()
      .then(({ models, default: def }) => {
        setAvailableModels(models);
        setSelectedModel(def);
      })
      .catch(() => { /* non-critical */ });
  }, []);

  useEffect(() => {
    fetchSignalSlices(c.id)
      .then((slices) => setSignalSlices(slices))
      .catch(() => {});
  }, [c.id]);

  async function refreshCase() {
    try { setC(await getCase(c.id)); } catch { /* non-critical */ }
  }

  async function startAnalysis() {
    setAnalyzing(true);
    setStages({});
    setAnalysisError(null);
    setAnalysisNotices([]);
    setValidationRejections([]);
    stageStartTimesRef.current = {};
    const ac = new AbortController();
    abortRef.current = ac;

    await streamAnalysis(
      c.id,
      (event: AnalysisEvent) => {
        if (event.type === 'progress') {
          const stageId = progressEventToStageId(event.pass, event.message);
          const now = Date.now();
          setStages((prev) => {
            const current = prev[stageId];
            if (!current || current.status === 'pending') {
              if (!stageStartTimesRef.current[stageId]) {
                stageStartTimesRef.current[stageId] = now;
              }
              return { ...prev, [stageId]: { status: 'running', message: event.message } };
            }
            return { ...prev, [stageId]: { ...current, message: event.message } };
          });
        } else if (event.type === 'stage_complete') {
          const stageId = stageCompleteToStageId(event.pass);
          const startTime = stageStartTimesRef.current[stageId];
          const elapsedMs = startTime != null ? Date.now() - startTime : undefined;
          setStages((prev) => ({
            ...prev,
            [stageId]: {
              status: 'passed',
              elapsedMs,
              tokensIn: event.tokensIn,
              tokensOut: event.tokensOut,
              ...(event.findingCount != null && { findingCount: event.findingCount }),
              ...(event.warningCount != null && { warningCount: event.warningCount }),
              ...(event.flagCount    != null && { flagCount:    event.flagCount    }),
            },
          }));
        } else if (event.type === 'done') {
          void refreshCase();
        } else if (event.type === 'warning' || event.type === 'documents_only_mode') {
          setAnalysisNotices((current) => current.includes(event.message)
            ? current
            : [...current, event.message]);
        } else if (event.type === 'validation_failed') {
          setValidationRejections(event.rejections);
        } else if (event.type === 'error') {
          setAnalysisError(event.message);
          setStages((prev) => {
            const updated = { ...prev };
            for (const key of Object.keys(updated) as StageId[]) {
              if (updated[key]?.status === 'running') {
                updated[key] = { ...updated[key]!, status: 'failed' };
              }
            }
            return updated;
          });
        }
      },
      ac.signal,
      selectedModel || undefined,
    );

    setAnalyzing(false);
    abortRef.current = null;
  }

  function stopAnalysis() { abortRef.current?.abort(); }

  async function startActionPlan() {
    setPlanGenerating(true);
    setPlanError(null);
    const ac = new AbortController();
    planAbortRef.current = ac;

    await streamActionPlan(
      c.id,
      (event: ActionPlanEvent) => {
        if (event.type === 'done') {
          void refreshCase();
        } else if (event.type === 'error') {
          setPlanError(event.message);
        }
      },
      ac.signal,
      selectedModel || undefined,
    );

    setPlanGenerating(false);
    planAbortRef.current = null;
  }

  useEffect(() => () => { planAbortRef.current?.abort(); }, []);

  async function handleFindingDecision(findingId: string, decision: ReviewerDecision, editedClaim?: string) {
    await patchFindingDecision(c.id, findingId, decision, editedClaim);
    await refreshCase();
  }

  async function handleSectionDecision(section: ReportSectionKey, decision: ReviewerDecision, editedValue?: string) {
    await patchSectionReview(c.id, section, decision, editedValue);
    await refreshCase();
  }

  async function handleSignOff(actorId: string) {
    await signOffCase(c.id, actorId);
    await refreshCase();
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      const findings = c.findings;
      if (findings.length === 0) return;

      switch (e.key) {
        case 'j': case 'J': case 'ArrowDown': {
          e.preventDefault();
          setActiveTab('findings');
          setFocusedIdx((prev) => {
            const next = Math.min(prev + 1, findings.length - 1);
            findingRefs.current[next]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            return next;
          });
          break;
        }
        case 'k': case 'K': case 'ArrowUp': {
          e.preventDefault();
          setActiveTab('findings');
          setFocusedIdx((prev) => {
            const next = Math.max(prev - 1, 0);
            findingRefs.current[next]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            return next;
          });
          break;
        }
        case 'Enter': {
          if (focusedIdx < 0 || c.status === 'signed_off') break;
          const f = findings[focusedIdx];
          if (f) void handleFindingDecision(f.id, 'confirm');
          break;
        }
        case 'x': case 'X': {
          if (focusedIdx < 0 || c.status === 'signed_off') break;
          const f = findings[focusedIdx];
          if (f) void handleFindingDecision(f.id, 'reject');
          break;
        }
        case 'u': case 'U': {
          if (focusedIdx < 0 || c.status === 'signed_off') break;
          const f = findings[focusedIdx];
          if (f) void handleFindingDecision(f.id, 'uncertain');
          break;
        }
        case 'e': case 'E': {
          if (focusedIdx < 0 || c.status === 'signed_off') break;
          const f = findings[focusedIdx];
          if (f) setEditCounters((prev) => ({ ...prev, [f.id]: (prev[f.id] ?? 0) + 1 }));
          break;
        }
        case 'a': case 'A': {
          if (focusedIdx < 0 || c.status === 'signed_off') break;
          const f = findings[focusedIdx];
          if (f) void handleFindingDecision(f.id, 'artefact');
          break;
        }
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [c.findings, c.status, c.id, focusedIdx]);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const canAnalyze = !analyzing && c.status !== 'signed_off';
  const locked = c.status === 'signed_off';
  const reviewComplete = reviewIsComplete(c);

  return (
    <div className="space-y-4">
      {/* Case header */}
      <div className="flex items-center gap-3">
        <button
          className="rounded-lg p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:text-slate-300 dark:hover:bg-slate-800 transition-colors"
          onClick={onBack}
          aria-label="Back to cases"
        >
          <ArrowLeft size={15} />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold truncate">{c.name}</h2>
          <p className="text-xs text-slate-500 mono">{c.id.slice(0, 8)}  ·  {new Date(c.createdAt).toLocaleString()}</p>
        </div>
        <Badge variant={CASE_STATUS_VARIANT[c.status] ?? 'default'}>{c.status.replace(/_/g, ' ')}</Badge>

        {canAnalyze && availableModels.length > 0 && (
          <Select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            disabled
            className="text-xs w-auto"
          >
            {availableModels.map((m) => <option key={m} value={m}>{m}</option>)}
          </Select>
        )}

        {canAnalyze && (
          <button
            className="btn-teal"
            onClick={() => {
              if (c.findings.length > 0) { setShowRerunConfirm(true); }
              else { void startAnalysis(); }
            }}
          >
            <Play size={13} /> Analyze
          </button>
        )}
        {analyzing && (
          <button className="btn-danger" onClick={stopAnalysis}>
            <Square size={13} /> Stop
          </button>
        )}
      </div>

      {/* Analysis pipeline - above tabs, visible on any tab */}
      <AnalysisPipeline stages={stages} analyzing={analyzing} />

      {analysisError && <Alert variant="danger">{analysisError}</Alert>}

      {analysisNotices.map((notice) => (
        <Alert key={notice} variant="warning">{notice}</Alert>
      ))}

      {validationRejections.length > 0 && (
        <Alert variant="warning" title="Validation failed — unsupported claims">
          <div className="space-y-2">
            {validationRejections.map((r, i) => (
              <div key={i} className="text-xs space-y-0.5">
                <p className="italic text-slate-600 dark:text-slate-400">"{r.quote}"</p>
                <p>{r.reason}</p>
              </div>
            ))}
          </div>
        </Alert>
      )}

      {/* Re-run confirm */}
      {showRerunConfirm && (
        <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-3 flex items-center justify-between gap-3">
          <p className="text-sm text-amber-800 dark:text-amber-300">
            Re-running will overwrite {c.findings.length} existing finding{c.findings.length !== 1 ? 's' : ''}. Continue?
          </p>
          <div className="flex gap-2 shrink-0">
            <button
              className="btn-danger text-xs py-1 px-2"
              onClick={() => { setShowRerunConfirm(false); void startAnalysis(); }}
            >
              Overwrite
            </button>
            <button
              className="btn-ghost text-xs py-1 px-2"
              onClick={() => setShowRerunConfirm(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Tab bar */}
      <Tabs
        tabs={[
          { id: 'report',   label: 'Report' },
          {
            id: 'findings',
            label: c.findings.length > 0 ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-ui-bg-muted text-[10px] font-semibold">
                  {c.findings.length}
                </span>
                Findings
              </span>
            ) : 'Findings',
          },
          { id: 'plan',  label: 'Plan'  },
          { id: 'audit', label: 'Audit' },
        ] satisfies SharedTab[]}
        active={activeTab}
        onChange={(id) => setActiveTab(id as TabId)}
      />

      {/* Report tab */}
      {activeTab === 'report' && (
        <div className="space-y-3">
          {c.structuredReport ? (
            <StructuredReportView
              report={c.structuredReport}
              findings={c.findings}
              reviews={c.sectionReviews ?? {}}
              locked={locked}
              pdfMetrics={c.pdfMetrics ?? null}
              edfMetrics={c.edfMetrics ?? null}
              signalSlices={signalSlices}
              onSectionDecision={handleSectionDecision}
            />
          ) : c.narrative ? (
            <div className="card p-4 space-y-1.5">
              <h3 className="section-label">Narrative draft</h3>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{stripInlineCitations(c.narrative)}</p>
            </div>
          ) : (
            <div className="card card-muted p-6 text-center">
              <p className="text-sm text-slate-500">No report yet. Run analysis to generate a structured report.</p>
            </div>
          )}
          <ScreenshotPanel
            caseId={c.id}
            screenshots={extractScreenshotMetadata(c.casePackage)}
            locked={locked}
            onDeleted={refreshCase}
          />
        </div>
      )}

      {/* Findings tab */}
      {activeTab === 'findings' && (
        <div className="space-y-3">
          <div className="sticky top-0 z-10 -mx-1 px-1 py-1 backdrop-blur-sm bg-white/90 dark:bg-slate-950/90">
            <SignOffPanel c={c} onSignOff={handleSignOff} />
          </div>

          <details className="text-xs text-slate-500">
            <summary className="cursor-pointer select-none hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
              Keyboard shortcuts
            </summary>
            <div className="mt-2 card card-muted p-3 grid grid-cols-2 gap-x-6 gap-y-1">
              {KB_SHORTCUTS.map(([key, label]) => (
                <div key={key} className="flex items-center gap-2">
                  <kbd className="chip chip-muted font-mono text-[10px]">{key}</kbd>
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </details>

          {c.findings.length > 0 ? (
            <>
              {(['high', 'medium', 'low'] as FindingConfidence[]).map((level) => {
                const group = c.findings.filter((f) => f.confidence === level);
                if (group.length === 0) return null;
                const COLOR: Record<FindingConfidence, string> = {
                  high:   'text-emerald-600 dark:text-emerald-400',
                  medium: 'text-amber-600 dark:text-amber-400',
                  low:    'text-rose-600 dark:text-rose-400',
                };
                const LABEL: Record<FindingConfidence, string> = {
                  high:   'High confidence',
                  medium: 'Medium confidence',
                  low:    'Low confidence',
                };
                return (
                  <div key={level} className="space-y-2">
                    <p className={`text-xs font-semibold uppercase tracking-wide ${COLOR[level]}`}>{LABEL[level]}</p>
                    {group.map((f) => {
                      const i = c.findings.indexOf(f);
                      return (
                        <FindingCard
                          key={f.id}
                          ref={(el) => { findingRefs.current[i] = el; }}
                          finding={f}
                          index={i}
                          caseId={c.id}
                          locked={locked}
                          isFocused={focusedIdx === i}
                          editCounter={editCounters[f.id]}
                          signalSlices={signalSlices}
                          onDecision={handleFindingDecision}
                        />
                      );
                    })}
                  </div>
                );
              })}
              {signalSlices.length > 0 && (() => {
                const SCREEN_WAVEFORM_CAP = 50;
                const sorted = [...signalSlices].sort((a, b) => b.magnitude - a.magnitude);
                const shown = sorted.slice(0, SCREEN_WAVEFORM_CAP);
                return (
                  <details open className="group">
                    <summary className="cursor-pointer select-none text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors list-none flex items-center gap-2">
                      <span className="inline-block transition-transform group-open:rotate-90">▶</span>
                      Event Waveforms ({shown.length}{signalSlices.length > SCREEN_WAVEFORM_CAP ? ` of ${signalSlices.length}` : ''})
                    </summary>
                    <div className="mt-3 space-y-6">
                      {shown.map((ev, i) => (
                        <EventWaveformSnapshot key={ev.eventId} event={ev} index={i} />
                      ))}
                      {signalSlices.length > SCREEN_WAVEFORM_CAP && (
                        <p className="text-xs text-slate-400 dark:text-slate-500 text-center py-2">
                          {signalSlices.length - SCREEN_WAVEFORM_CAP} lower-magnitude events not shown — all {signalSlices.length} appear in the printed report appendix (top 20 by magnitude).
                        </p>
                      )}
                    </div>
                  </details>
                );
              })()}
            </>
          ) : (
            <div className="card card-muted p-6 text-center">
              <p className="text-sm text-slate-500">No findings yet. Run analysis to extract structured findings.</p>
            </div>
          )}
        </div>
      )}

      {/* Plan tab */}
      {activeTab === 'plan' && (
        <div className="space-y-4">
          {planError && (
            <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3">
              <p className="text-sm text-red-700 dark:text-red-400">{planError}</p>
            </div>
          )}

          {!c.findings.length || !c.structuredReport ? (
            <div className="card card-muted p-6 text-center">
              <p className="text-sm text-slate-500">Run analysis first to enable action plan generation.</p>
            </div>
          ) : !reviewComplete && !c.actionPlan ? (
            <div className="card card-muted p-6 text-center">
              <p className="text-sm text-slate-500">Review every finding and populated report section before generating an action plan.</p>
            </div>
          ) : c.actionPlan && !planGenerating ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">AI Action Plan</p>
                <div className="flex items-center gap-2">
                  <button
                    className="btn-ghost text-xs py-1 px-2 flex items-center gap-1"
                    onClick={() => printWithFilename(buildPdfFilename(c))}
                    title="Export report + action plan as PDF"
                  >
                    <FileDown size={12} /> Export Report + Plan
                  </button>
                  {!locked && reviewComplete && (
                    <button
                      className="btn-ghost text-xs py-1 px-2 flex items-center gap-1"
                      onClick={() => void startActionPlan()}
                      disabled={planGenerating}
                    >
                      <RefreshCw size={12} /> Regenerate
                    </button>
                  )}
                </div>
              </div>
              <ActionPlanView plan={c.actionPlan} findings={c.findings} />
            </div>
          ) : planGenerating ? (
            <ActionPlanThinking />
          ) : (
            <div className="card card-muted p-6 text-center space-y-3">
              <Sparkles size={20} className="text-teal-500 mx-auto" />
              <div>
                <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Generate AI Action Plan</p>
                <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                  Synthesises high-confidence findings into priority actions, verification steps, artefact caveats, and clinical context - tailored for the reviewing clinician.
                </p>
              </div>
              <button
                className="btn-teal mx-auto"
                onClick={() => void startActionPlan()}
              >
                <Sparkles size={13} /> Generate
              </button>
            </div>
          )}
        </div>
      )}

      {/* Audit tab */}
      {activeTab === 'audit' && (
        <div className="space-y-3">
          <div className="card p-4">
            <AuditTrail caseId={c.id} />
          </div>
        </div>
      )}

      {(locked || !!c.actionPlan) && c.findings.length > 0 && <PrintableReport c={c} signalSlices={signalSlices} />}
    </div>
  );
}
