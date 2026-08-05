// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import path from 'node:path';

/**
 * Resolve `childName` inside `rootPath`, or return null if it would escape.
 *
 * Every artifact directory is addressed by an identifier that arrived over the
 * wire, so this is the single containment check the artifact routes share. It
 * is deliberately purely lexical: callers that also need to defeat symlinks
 * follow up with `realpath` and `lstat`.
 */
export function pathWithin(rootPath: string, childName: string): string | null {
  const root = path.resolve(rootPath);
  const child = path.resolve(root, childName);
  const relative = path.relative(root, child);
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    return null;
  return child;
}
