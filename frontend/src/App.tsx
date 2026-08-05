// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useEffect } from 'react';
import { Activity, Plus } from 'lucide-react';
import { useDarkMode, DarkModeToggle } from './ui';
import { CaseList } from './components/CaseList';
import { CaseUpload } from './components/CaseUpload';
import { ReviewWorkspace } from './components/ReviewWorkspace';
import type { Case } from '@contracts/types';
import { getCase, getConfig } from './api';
import type { DeploymentConfig } from './api';

type View = 'list' | 'upload' | 'workspace';

/**
 * Always on screen while the offline model is in use. A reviewer who arrives
 * mid-workflow has to be able to tell that the drafted text came from a canned
 * generator, not a model reading their study.
 */
function OfflineModelBanner({ config }: { config: DeploymentConfig | null }) {
  if (config?.llmMode !== 'demo') return null;
  return (
    <div
      role="status"
      className="bg-amber-500 px-4 py-1.5 text-center text-xs font-medium text-amber-950"
    >
      Offline model — report text is generated locally and carries no clinical meaning.
    </div>
  );
}

export default function App() {
  const [view, setView] = useState<View>('list');
  const [selectedCase, setSelectedCase] = useState<Case | null>(null);
  const [listRefreshKey, setListRefreshKey] = useState(0);
  const [config, setConfig] = useState<DeploymentConfig | null>(null);
  const { dark: isDark, toggle: toggleDark } = useDarkMode();

  useEffect(() => {
    getConfig()
      .then(setConfig)
      .catch(() => setConfig(null));
  }, []);

  function handleSelectCase(c: Case) {
    setSelectedCase(c);
    setView('workspace');
  }

  async function handleUploaded(caseId: string) {
    setListRefreshKey((k) => k + 1);
    const c = await getCase(caseId);
    setSelectedCase(c);
    setView('workspace');
  }

  return (
    <div className="min-h-screen">
      <OfflineModelBanner config={config} />
      <header className="border-b border-slate-200/70 dark:border-slate-800/70 bg-white dark:bg-slate-900 px-4 py-2.5">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <button
            className="flex items-center gap-2 text-slate-800 dark:text-slate-100 hover:text-teal-700 dark:hover:text-teal-400 transition-colors"
            onClick={() => setView('list')}
          >
            <Activity size={16} className="text-teal-600 dark:text-teal-400" />
            <span className="text-sm font-semibold tracking-tight">Somnoscribe</span>
          </button>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setView('upload')}
              aria-label="Upload study"
              title="Upload study"
              className="rounded-lg p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:text-slate-300 dark:hover:bg-slate-800 transition-colors"
            >
              <Plus size={15} />
            </button>
            <DarkModeToggle dark={isDark} onToggle={toggleDark} />
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-5">
        {view === 'list' && (
          <CaseList
            onSelect={handleSelectCase}
            refreshKey={listRefreshKey}
            onStartDemo={() => setView('upload')}
          />
        )}
        {view === 'upload' && <CaseUpload onUploaded={handleUploaded} />}
        {view === 'workspace' && selectedCase && (
          <ReviewWorkspace initialCase={selectedCase} onBack={() => setView('list')} />
        )}
      </main>
    </div>
  );
}
