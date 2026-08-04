// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState, type ReactNode } from 'react';
import { Progress, progressToneFromPercent, type ProgressTone } from './primitives';
import { cx } from './utils';

export interface QuotaCardProps {
  label: string;
  used: number;
  budget: number;
  unit?: string;
  remainingLabel?: string;
  windowEndsAt?: number;
  thresholds?: { warning: number; danger: number };
  tone?: ProgressTone;
  footnote?: ReactNode;
  className?: string;
}

function countdown(milliseconds: number): string {
  if (milliseconds <= 0) return 'now';
  const minutes = Math.floor(milliseconds / 60_000);
  const hours = Math.floor(minutes / 60);
  if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${Math.max(1, minutes)}m`;
}

export function QuotaCard({
  label,
  used,
  budget,
  unit = '',
  remainingLabel,
  windowEndsAt,
  thresholds = { warning: 0.8, danger: 0.95 },
  tone,
  footnote,
  className,
}: QuotaCardProps) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (windowEndsAt === undefined) return;
    const timer = window.setInterval(() => tick((value) => value + 1), 60_000);
    return () => window.clearInterval(timer);
  }, [windowEndsAt]);

  const unlimited = !Number.isFinite(budget);
  const percent = unlimited ? 0 : Math.max(0, Math.min(100, (used / Math.max(1, budget)) * 100));
  const selectedTone =
    tone ??
    (percent >= thresholds.danger * 100
      ? 'danger'
      : percent >= thresholds.warning * 100
        ? 'warning'
        : progressToneFromPercent(percent));
  const remaining = unlimited ? null : Math.max(0, budget - used);
  const unitLabel = remaining === 1 ? unit : `${unit}s`;

  return (
    <section
      className={cx('rounded-2xl border border-ui-border bg-ui-bg-raised p-5', className)}
      aria-label={label}
    >
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-ui-text">{label}</h2>
        <span className="text-xs tabular-nums text-ui-text-subtle">
          {used.toLocaleString()} / {unlimited ? 'Unlimited' : budget.toLocaleString()}
        </span>
      </div>
      <Progress value={percent} tone={selectedTone} label={`${label} usage`} />
      <div className="mt-3 flex items-start justify-between gap-3 text-xs text-ui-text-muted">
        <span>
          {remainingLabel ??
            (unlimited
              ? 'Unlimited'
              : `${remaining?.toLocaleString()} ${unitLabel.trim()} remaining`)}
        </span>
        {windowEndsAt !== undefined && (
          <span>resets in {countdown(windowEndsAt - Date.now())}</span>
        )}
      </div>
      {footnote && <div className="mt-2 text-xs">{footnote}</div>}
    </section>
  );
}

export interface TokenUsageRow {
  label: string;
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export interface TokenUsagePanelProps {
  rows: TokenUsageRow[];
  costUsd?: number;
  model?: string;
  title?: string;
  className?: string;
}

export function TokenUsagePanel({
  rows,
  costUsd,
  model,
  title = 'Token usage',
  className,
}: TokenUsagePanelProps) {
  if (rows.length === 0) return null;
  const totalInput = rows.reduce((total, row) => total + row.input, 0);
  const totalOutput = rows.reduce((total, row) => total + row.output, 0);
  return (
    <section
      className={cx('space-y-2 rounded-lg border border-ui-border bg-ui-bg-raised p-3', className)}
    >
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold text-ui-text-muted">{title}</h4>
        {model && <span className="truncate text-xs text-ui-text-subtle">{model}</span>}
      </div>
      <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        {rows.map((row) => (
          <div key={row.label}>
            <dt className="font-medium text-ui-text-muted">{row.label}</dt>
            <dd className="text-ui-text">
              <span aria-label="input tokens">↑ {row.input.toLocaleString()}</span> /{' '}
              <span aria-label="output tokens">↓ {row.output.toLocaleString()}</span>
            </dd>
          </div>
        ))}
      </dl>
      <div className="flex justify-between border-t border-ui-border pt-2 text-xs text-ui-text-muted">
        <span>
          Total: ↑ {totalInput.toLocaleString()} / ↓ {totalOutput.toLocaleString()}
        </span>
        {costUsd !== undefined && <span>${costUsd.toFixed(4)}</span>}
      </div>
    </section>
  );
}

export type DeltaDir = 'up' | 'down' | 'neutral';

export interface StatCardProps {
  label: string;
  value: string | number;
  delta?: { value: string; dir: DeltaDir; label?: string };
  sub?: string;
  icon?: ReactNode;
  sparkline?: ReactNode;
  loading?: boolean;
  className?: string;
}

export function StatCard({
  label,
  value,
  delta,
  sub,
  icon,
  sparkline,
  loading = false,
  className,
}: StatCardProps) {
  return (
    <section className={cx('rounded-2xl border border-ui-border bg-ui-bg-raised p-5', className)}>
      <div className="flex items-start gap-3">
        {icon && (
          <div
            aria-hidden="true"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ui-accent/10 text-ui-accent"
          >
            {icon}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-ui-text-muted">{label}</p>
          {loading ? (
            <div className="mt-2 h-7 w-20 animate-pulse rounded bg-ui-bg-muted" />
          ) : (
            <p className="mt-1 text-2xl font-semibold text-ui-text">{value}</p>
          )}
          {delta && (
            <p
              className={cx(
                'mt-1 text-xs',
                delta.dir === 'up'
                  ? 'text-green-600'
                  : delta.dir === 'down'
                    ? 'text-red-600'
                    : 'text-ui-text-muted',
              )}
            >
              {delta.value}
              {delta.label ? ` ${delta.label}` : ''}
            </p>
          )}
          {!delta && sub && <p className="mt-1 text-xs text-ui-text-subtle">{sub}</p>}
        </div>
        {sparkline}
      </div>
    </section>
  );
}
