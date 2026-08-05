// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Alert } from '../ui';
import { deleteScreenshot } from '../api';

interface ScreenshotMetadata {
  id: string;
  originalName: string;
}

interface Props {
  caseId: string;
  screenshots: ScreenshotMetadata[];
  locked: boolean;
  onDeleted: () => Promise<void>;
}

export function ScreenshotPanel({ caseId, screenshots, locked, onDeleted }: Props) {
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (screenshots.length === 0) return null;

  async function handleDelete(screenshotId: string) {
    if (deleteConfirm !== screenshotId) {
      setDeleteConfirm(screenshotId);
      return;
    }

    setDeleting(screenshotId);
    setError(null);
    try {
      await deleteScreenshot(caseId, screenshotId);
      setDeleteConfirm(null);
      await onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete screenshot');
    } finally {
      setDeleting(null);
    }
  }

  function cancelDelete() {
    setDeleteConfirm(null);
  }

  return (
    <div className="card p-4 space-y-3">
      <h3 className="section-label">Uploaded sketches & screenshots</h3>

      {error && <Alert variant="danger">{error}</Alert>}

      <div className="space-y-2">
        {screenshots.map((ss) => (
          <div
            key={ss.id}
            className="flex items-center justify-between gap-3 p-2 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50"
          >
            <span className="text-xs text-slate-700 dark:text-slate-300 truncate font-mono">
              {ss.originalName}
            </span>
            {!locked &&
              (deleteConfirm === ss.id ? (
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    className="btn-danger text-xs py-1 px-2"
                    onClick={() => void handleDelete(ss.id)}
                    disabled={deleting === ss.id}
                  >
                    {deleting === ss.id ? 'Deleting…' : 'Confirm'}
                  </button>
                  <button
                    className="btn-ghost text-xs py-1 px-2"
                    onClick={cancelDelete}
                    disabled={deleting === ss.id}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors shrink-0"
                  onClick={() => void handleDelete(ss.id)}
                  title="Delete screenshot"
                  aria-label="Delete screenshot"
                >
                  <Trash2 size={14} />
                </button>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}
