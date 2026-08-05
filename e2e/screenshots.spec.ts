// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Captures the images embedded in README.md.
 *
 * This is not a test and does not run in CI. It walks the same synthetic
 * journey as public-smoke.spec.ts so the images can only ever show generated
 * fixture data, never a real study. Refresh them with:
 *
 *   npm run screenshots
 */
import { expect, test } from '@playwright/test';

const OUT = 'docs/images';

test('capture the README images from the synthetic journey', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Upload study' })).toBeVisible();

  await page.getByRole('button', { name: 'Upload study' }).click();
  await expect(page.getByRole('button', { name: 'Upload & Process' })).toBeVisible();
  // Each capture is sized to its own content. A fixed tall viewport leaves the
  // shorter screens as mostly empty background in the README. The demo panel
  // and the form share a page, so they are captured element by element rather
  // than by cropping the viewport around whichever one happens to be on top.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByTestId('demo-panel').screenshot({ path: `${OUT}/demo-panel.png` });
  await page.locator('form').screenshot({ path: `${OUT}/upload.png` });

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

  const pendingFindingConfirmations = page.getByRole('button', { name: 'Confirm', exact: true });
  const findingCount = await pendingFindingConfirmations.count();
  expect(findingCount).toBeGreaterThan(0);
  for (let index = 0; index < findingCount; index += 1) {
    await pendingFindingConfirmations.nth(index).click();
  }

  await page.getByRole('tab', { name: 'Report' }).click();
  await expect(page.getByRole('heading', { name: 'Summary', exact: true })).toBeVisible();
  await page.screenshot({ path: `${OUT}/report-sections.png` });

  for (const section of ['Summary', 'Study quality', 'Impression']) {
    const card = page
      .locator('.card')
      .filter({ has: page.getByRole('heading', { name: section, exact: true }) });
    await card.getByRole('button', { name: 'Confirm' }).click();
  }

  await page.getByRole('tab', { name: /Findings/ }).click();
  await page.getByPlaceholder('Reviewer name').fill('Synthetic Reviewer');
  await page.getByRole('button', { name: 'Sign off' }).click();
  await expect(page.getByText('Case signed off')).toBeVisible({ timeout: 10_000 });

  await page.getByRole('button', { name: 'Back to cases' }).click();
  await expect(page.getByRole('button', { name: 'Upload study' })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 340 });
  await page.screenshot({ path: `${OUT}/case-list.png` });
});
