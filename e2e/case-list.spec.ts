// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from '@playwright/test';

const EMPTY_CASES = JSON.stringify({ cases: [] });

test.describe('case list', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('/api/cases*', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: EMPTY_CASES });
    });
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Upload study' })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('shows app header with Somnoscribe branding', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Somnoscribe' })).toBeVisible();
  });

  test('shows empty state when no cases', async ({ page }) => {
    await expect(page.getByText('No cases yet')).toBeVisible();
    await expect(page.getByText(/Upload a study to get started/)).toBeVisible();
  });

  test('header upload button navigates to upload form', async ({ page }) => {
    await page.getByRole('button', { name: 'Upload study' }).click();
    await expect(page.getByRole('heading', { name: 'Upload Sleep Study' })).toBeVisible();
  });

  test('case list shows cases when API returns them', async ({ page }) => {
    const sampleCase = {
      id: 'case-00000000-0000-0000-0000-000000000001',
      name: 'study.edf',
      status: 'draft',
      cohort: 'adult',
      createdAt: new Date().toISOString(),
      findings: [],
      edfAvailable: true,
      studyHash: 'abc123',
    };

    // Remove the beforeEach empty-cases handler (FIFO - it would win otherwise)
    await page.unroute('/api/cases*');
    await page.route('/api/cases*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ cases: [sampleCase] }),
      });
    });

    await page.reload();
    await expect(page.getByText('study.edf')).toBeVisible();
    await expect(page.getByText('draft')).toBeVisible();
  });
});
