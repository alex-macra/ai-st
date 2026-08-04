// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig, devices } from '@playwright/test';
import { chmodSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const configuredRunRoot = process.env['SOMNOSCRIBE_E2E_ROOT'];
const runRoot = configuredRunRoot ?? mkdtempSync(path.join(tmpdir(), 'somnoscribe-e2e-'));
if (!configuredRunRoot) chmodSync(runRoot, 0o700);
const dbPath = process.env['SOMNOSCRIBE_E2E_DB'] ?? path.join(runRoot, 'cases.sqlite');
const uploadPath = process.env['SOMNOSCRIBE_E2E_UPLOADS'] ?? path.join(runRoot, 'uploads');
const artifactPath = process.env['SOMNOSCRIBE_E2E_ARTIFACTS'] ?? path.join(runRoot, 'artifacts');
const localPython = path.resolve('preprocessor/.venv/bin/python');
const pythonBin =
  process.env['SOMNOSCRIBE_PYTHON_BIN'] ?? (existsSync(localPython) ? localPython : 'python3');

process.env['SOMNOSCRIBE_E2E_DB'] = dbPath;
process.env['SOMNOSCRIBE_E2E_UPLOADS'] = uploadPath;
process.env['SOMNOSCRIBE_E2E_ARTIFACTS'] = artifactPath;
process.env['SOMNOSCRIBE_E2E_ROOT'] = runRoot;

const baseEnvironment = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
);

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['github'], ['list']] : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      // The screenshot capture is a documentation tool, not a test.
      testIgnore: /screenshots\.spec\.ts/,
    },
    {
      name: 'screenshots',
      testMatch: /screenshots\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: [
    {
      command: 'npm start',
      cwd: 'api',
      url: 'http://localhost:3001/healthz',
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
      env: {
        ...baseEnvironment,
        NODE_ENV: 'test',
        HOST: '127.0.0.1',
        TRUST_PROXY: 'false',
        DB_PATH: dbPath,
        PREPROCESSOR_URL: 'http://127.0.0.1:8001',
        CORS_ORIGINS: 'http://localhost:5173',
        SOMNOSCRIBE_SYNTHETIC_LLM: 'true',
        OPENAI_API_KEY: 'not-used-in-synthetic-test-mode',
        JWT_SECRET: 'synthetic-e2e-secret-not-for-production',
        AUTH_RATE_LIMIT_MAX: '1000',
        RATE_LIMIT_MAX: '1000',
        UPLOAD_RATE_LIMIT_MAX: '1000',
        UPLOAD_TMP_DIR: uploadPath,
        SCREENSHOTS_DIR: path.join(artifactPath, 'screenshots'),
        CHARTS_DIR: path.join(artifactPath, 'charts'),
        SLICES_DIR: path.join(artifactPath, 'slices'),
      },
    },
    {
      command: 'npm run dev',
      cwd: 'frontend',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
    },
    {
      command: `"${pythonBin}" -m uvicorn main:app --host 127.0.0.1 --port 8001`,
      cwd: 'preprocessor',
      url: 'http://127.0.0.1:8001/healthz',
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
    },
  ],
});
