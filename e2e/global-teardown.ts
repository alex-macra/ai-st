// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const authStatePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '.auth', 'user.json');

function assertTemporaryPath(target: string): void {
  const relative = path.relative(tmpdir(), target);
  if (
    relative.startsWith('..') ||
    path.isAbsolute(relative) ||
    !path.basename(target).startsWith('somnoscribe-e2e-')
  ) {
    throw new Error(`Refusing to remove non-E2E path: ${target}`);
  }
}

export default async function globalTeardown(): Promise<void> {
  await rm(authStatePath, { force: true });
  const root = process.env['SOMNOSCRIBE_E2E_ROOT'];
  if (!root) return;
  assertTemporaryPath(root);
  await rm(root, { recursive: true, force: true });
}
