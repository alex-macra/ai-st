import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const authStatePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '.auth', 'user.json');

function assertTemporaryPath(target: string): void {
  const relative = path.relative(tmpdir(), target);
  if (relative.startsWith('..') || path.isAbsolute(relative) || !path.basename(target).startsWith('ai-st-e2e-')) {
    throw new Error(`Refusing to remove non-E2E path: ${target}`);
  }
}

export default async function globalTeardown(): Promise<void> {
  await rm(authStatePath, { force: true });
  const root = process.env['AI_ST_E2E_ROOT'];
  if (!root) return;
  assertTemporaryPath(root);
  await rm(root, { recursive: true, force: true });
}
