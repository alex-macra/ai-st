import { execFileSync } from 'node:child_process';

// globalSetup runs after the web servers boot, so seed the fresh private test
// database without replacing the file behind better-sqlite3's open handle.
export default async function globalSetup(): Promise<void> {
  const authDb = process.env['AI_ST_API_E2E_AUTH_DB'];
  if (!authDb) throw new Error('AI_ST_API_E2E_AUTH_DB was not configured');
  execFileSync('npm', ['run', 'seed:dev'], {
    stdio: 'pipe',
    env: { ...process.env, DB_PATH: authDb },
  });
}
