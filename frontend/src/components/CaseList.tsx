import { useEffect, useState } from 'react';
import { RefreshCw, ChevronRight, Trash2, RotateCcw, FileText } from 'lucide-react';
import { Alert, EmptyState, Badge, CASE_STATUS_VARIANT } from '../ui';
import { getCases, deleteCase, clearCaseAnalysis } from '../api';
import type { Case } from '../shared/types';

interface Props {
  onSelect: (c: Case) => void;
  refreshKey?: number;
}

export function CaseList({ onSelect, refreshKey }: Props) {
  const [cases, setCases] = useState<Case[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [clearingId, setClearingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setCases(await getCases());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load cases');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [refreshKey]);

  async function handleDelete(c: Case) {
    if (!window.confirm(`Delete case ${c.id.slice(0, 8)}? This cannot be undone.`)) return;

    setDeletingId(c.id);
    setError(null);
    try {
      await deleteCase(c.id);
      setCases((prev) => prev.filter((x) => x.id !== c.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeletingId(null);
    }
  }

  async function handleClear(c: Case) {
    if (!window.confirm(`Clear analysis for ${c.id.slice(0, 8)}? Findings and report will be removed; uploaded files are kept.`)) return;

    setClearingId(c.id);
    setError(null);
    try {
      await clearCaseAnalysis(c.id);
      setCases((prev) => prev.map((x) => x.id === c.id ? { ...x, findings: [], status: 'draft' } : x));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Clear failed');
    } finally {
      setClearingId(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Cases</h2>
        <button className="btn-ghost p-1.5" onClick={() => void load()} title="Refresh">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && <Alert variant="danger">{error}</Alert>}

      {!loading && cases.length === 0 && (
        <EmptyState
          icon={<FileText size={28} />}
          title="No cases yet"
          description="Upload a study to get started."
        />
      )}

      <ul className="space-y-2">
        {cases.map((c) => (
          <li key={c.id} className="card p-0 hover:shadow-md transition-shadow flex items-stretch">
            <button
              className="flex-1 text-left p-4 flex items-center gap-3 min-w-0"
              onClick={() => onSelect(c)}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant={CASE_STATUS_VARIANT[c.status] ?? 'default'}>{c.status.replaceAll('_', ' ')}</Badge>
                  <span className="text-sm font-medium mono truncate">{c.name}</span>
                </div>
                <p className="text-xs text-slate-500 truncate">
                  {new Date(c.createdAt).toLocaleString()}
                  {c.findings.length > 0 && ` · ${c.findings.length} findings`}
                </p>
              </div>
              <ChevronRight size={16} className="text-slate-400 shrink-0" />
            </button>
            {c.status !== 'signed_off' && c.findings.length > 0 && (
              <button
                className="btn-ghost px-3 text-slate-400 hover:text-amber-600 dark:hover:text-amber-400 disabled:opacity-50"
                onClick={() => void handleClear(c)}
                disabled={clearingId === c.id || deletingId === c.id}
                title="Clear analysis"
                aria-label="Clear analysis"
              >
                <RotateCcw size={15} className={clearingId === c.id ? 'animate-spin' : ''} />
              </button>
            )}
            {c.status !== 'signed_off' && (
              <button
                className="btn-ghost px-3 text-slate-400 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50"
                onClick={() => void handleDelete(c)}
                disabled={deletingId === c.id || clearingId === c.id}
                title="Delete case"
                aria-label="Delete case"
              >
                <Trash2 size={15} className={deletingId === c.id ? 'animate-pulse' : ''} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
