import { useState, useEffect } from 'react';
import { Activity, Plus } from 'lucide-react';
import { useDarkMode, DarkModeToggle } from './ui';
import { CaseList } from './components/CaseList';
import { CaseUpload } from './components/CaseUpload';
import { ReviewWorkspace } from './components/ReviewWorkspace';
import { AuthView } from './components/AuthView';
import { AccountPanel } from './components/AccountPanel';
import { AccountPage } from './components/AccountPage';
import { UsagePage } from './components/UsagePage';
import { AdminPanel } from './components/AdminPanel';
import type { Case, User } from './shared/types';
import { getMe, logout, setUnauthorizedHandler, getCase } from './api';

type View = 'list' | 'upload' | 'workspace' | 'account' | 'usage' | 'admin';

export default function App() {
  const [user, setUser] = useState<User | null | 'loading'>('loading');
  const [view, setView] = useState<View>('list');
  const [selectedCase, setSelectedCase] = useState<Case | null>(null);
  const [listRefreshKey, setListRefreshKey] = useState(0);
  const { dark: isDark, toggle: toggleDark } = useDarkMode();

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    getMe()
      .then((u) => setUser(u))
      .catch(() => setUser(null));
  }, []);

  async function handleLogout() {
    await logout();
    setUser(null);
    setView('list');
    setSelectedCase(null);
  }

  function handleNavigate(page: 'account' | 'usage' | 'admin') {
    setView(page);
  }

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

  if (user === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <span className="text-sm text-slate-400 dark:text-slate-500">Loading…</span>
      </div>
    );
  }

  if (user === null) {
    return <AuthView onAuth={setUser} isDark={isDark} onToggleDark={toggleDark} />;
  }

  return (
    <div className="min-h-screen">
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
            <AccountPanel user={user} onSignOut={handleLogout} onNavigate={handleNavigate} />
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-5">
        {view === 'list' && <CaseList onSelect={handleSelectCase} refreshKey={listRefreshKey} />}
        {view === 'upload' && <CaseUpload onUploaded={handleUploaded} />}
        {view === 'workspace' && selectedCase && (
          <ReviewWorkspace initialCase={selectedCase} onBack={() => setView('list')} />
        )}
        {view === 'account' && (
          <AccountPage
            user={user}
            onBack={() => setView('list')}
            onUserUpdate={(patch) =>
              setUser((prev) => (prev && typeof prev === 'object' ? { ...prev, ...patch } : prev))
            }
          />
        )}
        {view === 'usage' && <UsagePage user={user} onBack={() => setView('list')} />}
        {view === 'admin' && <AdminPanel user={user} onBack={() => setView('list')} />}
      </main>
    </div>
  );
}
