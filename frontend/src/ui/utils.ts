// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

/**
 * Format a metric for display: integers stay bare, everything else is fixed to
 * `digits`. Returns null when there is no value, so each caller decides how an
 * absent metric reads -- the printable report shows a dash, the review workspace
 * omits the row entirely.
 */
export function fmt(n: number | undefined | null, suffix = '', digits = 1): string | null {
  if (n === undefined || n === null) return null;
  return `${Number.isInteger(n) ? n : n.toFixed(digits)}${suffix}`;
}
