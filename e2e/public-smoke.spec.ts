// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '@playwright/test';

test('three-service upload → synthetic analysis → review → sign-off', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Upload study' })).toBeVisible();

  await page.getByRole('button', { name: 'Upload study' }).click();
  await page.getByRole('button', { name: /Add supporting files/i }).click();
  await page.locator('input[type="file"][accept=".pdf"]').setInputFiles({
    name: 'synthetic-report.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n'),
  });
  await page.getByRole('button', { name: 'Upload & Process' }).click();

  await expect(page.getByRole('button', { name: 'Back to cases' })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole('button', { name: 'Analyze' }).click();

  await expect(page.getByText(/Synthetic workflow verification completed/)).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByText('Deterministic reference checks are disabled for this analysis.'),
  ).toBeVisible();

  await page.getByRole('tab', { name: /Findings/ }).click();
  const pendingFindingConfirmations = page.getByRole('button', { name: 'Confirm', exact: true });
  const findingCount = await pendingFindingConfirmations.count();
  expect(findingCount).toBeGreaterThan(0);
  for (let index = 0; index < findingCount; index += 1) {
    await pendingFindingConfirmations.nth(index).click();
  }

  await page.getByRole('tab', { name: 'Report' }).click();

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
});
