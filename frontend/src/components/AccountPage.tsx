import { useState } from 'react';
import { ArrowLeft, Pencil, Check, X } from 'lucide-react';
import { Button, Input } from '../ui';
import type { User } from '../shared/types';
import { updateDisplayName } from '../api';

const TIER_LABELS: Record<string, string> = { starter: 'Starter', pro: 'Pro', unlimited: 'Unlimited' };
const TIER_COLORS: Record<string, string> = {
  starter: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  pro: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
  unlimited: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
};

interface Props {
  user: User;
  onBack: () => void;
  onUserUpdate: (updated: Partial<User>) => void;
}

export function AccountPage({ user, onBack, onUserUpdate }: Props) {
  const tier = user.tier ?? 'starter';
  const tierLabel = TIER_LABELS[tier] ?? tier;
  const tierColor = TIER_COLORS[tier] ?? TIER_COLORS['starter']!;

  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState(user.name ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    const trimmed = nameInput.trim();
    if (!trimmed) { setError('Name cannot be empty'); return; }
    setSaving(true);
    setError(null);
    try {
      await updateDisplayName(trimmed);
      onUserUpdate({ name: trimmed });
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    setNameInput(user.name ?? '');
    setError(null);
    setEditing(false);
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 w-full max-w-3xl mx-auto px-4 py-6">
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={onBack} icon={<ArrowLeft size={15} />}>
          Back
        </Button>
        <h1 className="text-base font-semibold text-slate-900 dark:text-slate-100">My Account</h1>
      </div>

      <div className="card p-5 space-y-4">
        <h2 className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">Account</h2>

        {/* Display name row */}
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-0.5 flex-1 min-w-0">
            <p className="text-xs text-slate-400 dark:text-slate-500">Display name</p>
            {editing ? (
              <div className="flex items-center gap-2">
                <Input
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void handleSave(); if (e.key === 'Escape') handleCancel(); }}
                  maxLength={100}
                  autoFocus
                  className="flex-1 min-w-0"
                />
                <button
                  onClick={() => void handleSave()}
                  disabled={saving}
                  aria-label="Save name"
                  className="p-1 text-teal-600 hover:text-teal-700 dark:text-teal-400 dark:hover:text-teal-300 disabled:opacity-50"
                >
                  <Check size={15} />
                </button>
                <button
                  onClick={handleCancel}
                  disabled={saving}
                  aria-label="Cancel"
                  className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 disabled:opacity-50"
                >
                  <X size={15} />
                </button>
              </div>
            ) : (
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                {user.name ?? <span className="text-slate-400 dark:text-slate-500 italic">Not set</span>}
              </p>
            )}
            {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
          </div>
          {!editing && (
            <button
              onClick={() => { setNameInput(user.name ?? ''); setEditing(true); }}
              aria-label="Edit display name"
              className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors rounded"
            >
              <Pencil size={14} />
            </button>
          )}
        </div>

        {/* Email row */}
        <div className="flex items-center justify-between gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
          <div className="space-y-0.5 min-w-0">
            <p className="text-xs text-slate-400 dark:text-slate-500">Email</p>
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{user.email}</p>
          </div>
          <span className={`shrink-0 text-xs font-medium px-2.5 py-1 rounded-full ${tierColor}`}>
            {tierLabel}
          </span>
        </div>
      </div>
    </div>
  );
}
