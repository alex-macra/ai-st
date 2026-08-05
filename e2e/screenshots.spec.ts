// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '@playwright/test';

const OUT = 'docs/images';

test('capture the README screenshot from the synthetic journey', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Upload study' })).toBeVisible();

  await page.getByRole('button', { name: 'Upload study' }).click();
  await expect(page.getByRole('button', { name: 'Upload & Process' })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.getByRole('button', { name: 'Load demo study' }).click();
  await expect(page.getByText('somnoscribe-demo-study.edf')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Upload & Process' }).click();

  await expect(page.getByRole('button', { name: 'Back to cases' })).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole('button', { name: 'Analyze' }).click();
  await expect(page.getByText(/Synthetic workflow verification completed/)).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole('tab', { name: /Findings/ }).click();
  await page.screenshot({ path: `${OUT}/review-workspace.png` });
});
