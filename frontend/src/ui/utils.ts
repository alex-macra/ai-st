// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}
