// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig } from '@playwright/test';
import { chmodSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// One server on its own port and its own database, so a burst of 429s here
// cannot leak into any other suite. TEST_RATE_LIMIT_INCLUDE_LOOPBACK overrides
// the dev-time loopback skip so loopback requests are actually limited.

const PORT = 3092;
const RUN_ROOT = mkdtempSync(path.join(tmpdir(), 'somnoscribe-api-e2e-'));
chmodSync(RUN_ROOT, 0o700);
process.env['SOMNOSCRIBE_API_E2E_ROOT'] = RUN_ROOT;

export default defineConfig({
  testDir: './e2e',
  globalTeardown: './e2e/global-teardown.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['github'], ['list']] : 'list',
  timeout: 15_000,
  expect: { timeout: 5_000 },
  use: { baseURL: `http://localhost:${PORT}` },

  webServer: [
    {
      command: 'npm start',
      url: `http://localhost:${PORT}/healthz`,
      reuseExistingServer: !process.env['CI'],
      timeout: 30_000,
      env: {
        PORT: String(PORT),
        HOST: '127.0.0.1',
        DB_PATH: path.join(RUN_ROOT, 'rate-limit.sqlite'),
        TEST_RATE_LIMIT_INCLUDE_LOOPBACK: '1',
        RATE_LIMIT_MAX: '5',
        RATE_LIMIT_WINDOW_MS: '60000',
        NODE_ENV: 'test',
        OPENAI_API_KEY: 'not-used-in-api-contract-tests',
        TRUST_PROXY: 'false',
      },
    },
  ],
});
