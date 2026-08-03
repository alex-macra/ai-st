import { ArrowLeft, AlertTriangle } from 'lucide-react';
import { Button, QuotaCard } from '../ui';
import type { User } from '../shared/types';

interface Props {
  user: User;
  onBack: () => void;
}

function quotaFootnote(used: number, budget: number) {
  if (budget <= 0) return undefined;
  const pct = (used / budget) * 100;
  if (pct >= 95) {
    return (
      <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400">
        <AlertTriangle size={12} /> Nearly at your limit
      </span>
    );
  }
  if (pct >= 80) {
    return (
      <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
        <AlertTriangle size={12} /> Approaching your limit
      </span>
    );
  }
  return undefined;
}

export function UsagePage({ user, onBack }: Props) {
  const bud4h    = user.budget4h ?? 0;
  const budWeek  = user.budgetWeek ?? 0;
  const used4h   = user.tokens4h ?? 0;
  const usedWeek = user.tokensWeek ?? 0;
  const ends4h   = user.window4hEndsAt;
  const endsWeek = user.weekEndsAt;

  const footnote4h = quotaFootnote(used4h, bud4h);
  const footnoteWeek = quotaFootnote(usedWeek, budWeek);

  return (
    <div className="flex flex-col flex-1 min-h-0 w-full max-w-3xl mx-auto px-4 py-6">
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={onBack} icon={<ArrowLeft size={15} />}>
          Back
        </Button>
        <h1 className="text-base font-semibold text-slate-900 dark:text-slate-100">Usage</h1>
      </div>

      <div className="space-y-4">
        {bud4h > 0 ? (
          <QuotaCard
            label="Recent (4h window)"
            used={used4h}
            budget={bud4h}
            unit="token"
            {...(ends4h ? { windowEndsAt: ends4h } : {})}
            {...(footnote4h ? { footnote: footnote4h } : {})}
          />
        ) : (
          <div className="card p-5">
            <p className="text-sm text-slate-400 dark:text-slate-500">No usage limits configured for your account.</p>
          </div>
        )}

        {budWeek > 0 && (
          <QuotaCard
            label="This week"
            used={usedWeek}
            budget={budWeek}
            unit="token"
            {...(endsWeek ? { windowEndsAt: endsWeek } : {})}
            {...(footnoteWeek ? { footnote: footnoteWeek } : {})}
          />
        )}
      </div>
    </div>
  );
}
