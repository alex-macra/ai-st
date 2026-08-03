import { request } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const AUTH_FILE = path.join(__dirname, '.auth/user.json');

const API = 'http://localhost:3001';

export default async function globalSetup(): Promise<void> {
  await mkdir(path.join(__dirname, '.auth'), { recursive: true });

  const dbPath = process.env['SOMNOSCRIBE_E2E_DB'];
  if (!dbPath) throw new Error('SOMNOSCRIBE_E2E_DB was not configured');

  const output = execFileSync('npm', ['run', 'license:generate', '--', '1', 'starter'], {
    cwd: path.join(__dirname, '../api'),
    encoding: 'utf8',
    env: { ...process.env, DB_PATH: dbPath },
  });
  const licenseKey = output.match(/AIST-(?:[A-F0-9]{4}-){4}[A-F0-9]{4}/)?.[0];
  if (!licenseKey) throw new Error('Invitation generator did not return a key');

  const ctx = await request.newContext({ baseURL: API });
  const email = `reviewer-${Date.now()}@example.test`;

  const activation = await ctx.post('/api/auth/activate', {
    data: { email, licenseKey },
  });
  if (!activation.ok()) {
    throw new Error(`Activation failed: ${activation.status()} ${await activation.text()}`);
  }

  await ctx.storageState({ path: AUTH_FILE });
  await ctx.dispose();
}
