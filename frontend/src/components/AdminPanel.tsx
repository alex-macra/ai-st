import { useState, useEffect, useCallback, type ReactNode } from 'react';
import {
  ArrowLeft,
  Activity,
  Users as UsersIcon,
  Download,
  RefreshCw,
  Shield,
  FileCheck,
  Hourglass,
  Coins,
  CalendarDays,
} from 'lucide-react';
import { StatCard, Pagination, Tabs, Button, type Tab as SharedTab } from '../ui';
import type { User } from '../shared/types';
import {
  adminDashboard,
  adminUsers,
  setUserAdmin,
  adminExportUsageCsvUrl,
  adminExportCasesJsonUrl,
  type AdminDashboardCounts,
  type AdminUserRow,
} from '../api';

interface Props {
  user: User;
  onBack: () => void;
}

const TAB_IDS = ['dashboard', 'users'] as const;
type TabId = (typeof TAB_IDS)[number];
const isTabId = (s: string): s is TabId => (TAB_IDS as readonly string[]).includes(s);

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

function DashboardTab() {
  const [data, setData] = useState<AdminDashboardCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    adminDashboard()
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <p className="text-sm text-slate-400 py-8 text-center">Loading…</p>;
  if (error || !data)
    return (
      <p className="text-sm text-red-500 py-8 text-center">
        {error ?? 'Failed to load dashboard.'}
      </p>
    );

  return (
    <div>
      <div className="flex justify-end mb-4">
        <button
          onClick={load}
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-teal-600 dark:hover:text-teal-400 transition-colors"
        >
          <RefreshCw size={12} /> Refresh
        </button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 tabular-nums">
        <StatCard label="Users" value={data.users} icon={<UsersIcon size={16} />} />
        <StatCard label="Cases" value={data.cases} icon={<Activity size={16} />} />
        <StatCard label="Signed off" value={data.signedOff} icon={<FileCheck size={16} />} />
        <StatCard label="Pending review" value={data.pending} icon={<Hourglass size={16} />} />
        <StatCard
          label="Tokens total"
          value={fmtTokens(data.tokensTotal)}
          icon={<Coins size={16} />}
        />
        <StatCard label="Cases today" value={data.casesToday} icon={<CalendarDays size={16} />} />
      </div>
    </div>
  );
}

function UsersTab() {
  const PAGE_SIZE = 50;
  const [rows, setRows] = useState<AdminUserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback((pg: number) => {
    setLoading(true);
    setError(null);
    adminUsers(pg, PAGE_SIZE)
      .then((r) => {
        setRows(r.users);
        setTotal(r.total);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load(page);
  }, [page, load]);

  async function toggleAdmin(u: AdminUserRow) {
    const next = !u.isAdmin;
    const confirmed = window.confirm(
      next ? `Grant admin privileges to ${u.email}?` : `Revoke admin privileges from ${u.email}?`,
    );
    if (!confirmed) return;
    setBusyId(u.id);
    try {
      await setUserAdmin(u.id, next);
      load(page);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update user');
    } finally {
      setBusyId(null);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      {error && <p className="text-xs text-red-500 mb-3">{error}</p>}
      {loading ? (
        <p className="text-sm text-slate-400 py-8 text-center">Loading…</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-slate-400">
                <th className="pb-2 pr-3 font-medium">Email</th>
                <th className="pb-2 pr-3 font-medium">Display name</th>
                <th className="pb-2 pr-3 font-medium">Created</th>
                <th className="pb-2 pr-3 font-medium tabular-nums">Tokens total</th>
                <th className="pb-2 font-medium">Admin</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} className="border-b border-slate-100 dark:border-slate-800/60">
                  <td className="py-2 pr-3 text-slate-700 dark:text-slate-200 font-mono">
                    {u.email}
                  </td>
                  <td className="py-2 pr-3 text-slate-500">{u.displayName ?? '—'}</td>
                  <td className="py-2 pr-3 text-slate-400">{fmtDate(u.createdAt)}</td>
                  <td className="py-2 pr-3 tabular-nums text-slate-500">
                    {fmtTokens(u.tokensTotal)}
                  </td>
                  <td className="py-2">
                    <button
                      onClick={() => void toggleAdmin(u)}
                      disabled={busyId === u.id}
                      className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-colors disabled:opacity-50 ${
                        u.isAdmin
                          ? 'bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
                      }`}
                    >
                      <Shield size={10} />
                      {u.isAdmin ? 'Admin' : 'Set admin'}
                    </button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-slate-400">
                    No users.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-end gap-3">
              <span className="text-xs text-slate-500 tabular-nums">{total} total</span>
              <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function tabLabel(icon: ReactNode, label: string) {
  return (
    <span className="flex items-center gap-1.5">
      {icon}
      {label}
    </span>
  );
}

export function AdminPanel({ user, onBack }: Props) {
  const [tab, setTab] = useState<TabId>('dashboard');

  const tabs: SharedTab[] = [
    { id: 'dashboard', label: tabLabel(<Activity size={13} />, 'Dashboard') },
    { id: 'users', label: tabLabel(<UsersIcon size={13} />, 'Users') },
  ];

  return (
    <div className="flex flex-col flex-1 min-h-0 w-full max-w-5xl mx-auto px-4 py-6">
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={onBack} icon={<ArrowLeft size={15} />}>
          Back
        </Button>
        <div className="flex items-center gap-2">
          <Shield size={15} className="text-teal-600 dark:text-teal-400" />
          <h1 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            AI-ST Admin
          </h1>
        </div>
        <span className="ml-auto text-xs text-slate-400 hidden sm:inline">{user.email}</span>
      </div>

      <div className="flex items-center justify-end gap-2 mb-3 flex-wrap">
        <a
          href={adminExportUsageCsvUrl()}
          download
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-teal-600 dark:hover:text-teal-400 transition-colors"
        >
          <Download size={12} /> Usage CSV
        </a>
        <a
          href={adminExportCasesJsonUrl()}
          download
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-teal-600 dark:hover:text-teal-400 transition-colors"
        >
          <Download size={12} /> Cases JSON
        </a>
      </div>

      <Tabs
        tabs={tabs}
        active={tab}
        onChange={(id) => {
          if (isTabId(id)) setTab(id);
        }}
        className="mb-6"
      />

      <div className="card p-5">
        {tab === 'dashboard' && <DashboardTab />}
        {tab === 'users' && <UsersTab />}
      </div>
    </div>
  );
}
