import { defineConfig } from '@playwright/test';
import { chmodSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Two webServer blocks on separate ports so the auth flow and the rate-limit
// flow don't share rate-limit state. TEST_RATE_LIMIT_INCLUDE_LOOPBACK overrides
// the dev-time loopback skip so loopback requests are actually limited.

const AUTH_PORT = 3091;
const RATE_LIMIT_PORT = 3092;
const RUN_ROOT = mkdtempSync(path.join(tmpdir(), 'ai-st-api-e2e-'));
chmodSync(RUN_ROOT, 0o700);
const AUTH_DB = path.join(RUN_ROOT, 'auth.sqlite');
const RATE_LIMIT_DB = path.join(RUN_ROOT, 'rate-limit.sqlite');
process.env['AI_ST_API_E2E_ROOT'] = RUN_ROOT;
process.env['AI_ST_API_E2E_AUTH_DB'] = AUTH_DB;
process.env['AI_ST_API_E2E_RATE_LIMIT_DB'] = RATE_LIMIT_DB;

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['github'], ['list']] : 'list',
  timeout: 15_000,
  expect: { timeout: 5_000 },

  webServer: [
    {
      command: 'npm start',
      url: `http://localhost:${AUTH_PORT}/healthz`,
      reuseExistingServer: !process.env['CI'],
      timeout: 30_000,
      env: {
        PORT:           String(AUTH_PORT),
        HOST:           '127.0.0.1',
        DB_PATH:        AUTH_DB,
        JWT_SECRET:     'e2e-integration-test-secret-32-bytes',
        DEV_OTP_BYPASS: 'true',
        AUTH_RATE_LIMIT_MAX: '1000',
        NODE_ENV:       'test',
        OPENAI_API_KEY: 'not-used-in-api-contract-tests',
        TRUST_PROXY:    'false',
      },
    },
    {
      command: 'npm start',
      url: `http://localhost:${RATE_LIMIT_PORT}/healthz`,
      reuseExistingServer: !process.env['CI'],
      timeout: 30_000,
      env: {
        PORT:           String(RATE_LIMIT_PORT),
        HOST:           '127.0.0.1',
        DB_PATH:        RATE_LIMIT_DB,
        JWT_SECRET:     'e2e-integration-test-secret-32-bytes',
        TEST_RATE_LIMIT_INCLUDE_LOOPBACK: '1',
        RATE_LIMIT_MAX:        '5',
        RATE_LIMIT_WINDOW_MS:  '60000',
        NODE_ENV:       'test',
        OPENAI_API_KEY: 'not-used-in-api-contract-tests',
        TRUST_PROXY:    'false',
      },
    },
  ],

  projects: [
    {
      name: 'auth',
      testMatch: 'auth.spec.ts',
      use: { baseURL: `http://localhost:${AUTH_PORT}` },
    },
    {
      name: 'rate-limit',
      testMatch: 'rate-limit.spec.ts',
      use: { baseURL: `http://localhost:${RATE_LIMIT_PORT}` },
    },
  ],
});
