// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import { cx } from './utils';

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
