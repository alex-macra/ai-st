// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '@playwright/test';

/**
 * The demo study exists so someone with no sleep study to hand can still see the
 * application work. That claim is only true if the generated recording survives
 * the real upload and preprocessing path, so this drives it from the button
 * rather than posting the file directly.
 */
test('generated demo study uploads and preprocesses through the ordinary path', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Upload study' })).toBeVisible();
  await page.getByRole('button', { name: 'Upload study' }).click();

  await expect(page.getByRole('heading', { name: 'Try it with a demo study' })).toBeVisible();
  // The panel describes the generator, which is what a reader compares the
  // detected numbers against.
  await expect(page.getByText('Flow, Thorax, SpO2, Pulse, Position')).toBeVisible();

  await page.getByRole('button', { name: 'Load demo study' }).click();

  await expect(page.getByText('somnoscribe-demo-study.edf')).toBeVisible({ timeout: 30_000 });
  // A generated recording is an adult one; loading it must say so.
  await expect(page.getByRole('radio', { name: 'Adult' })).toBeChecked();

  await page.getByRole('button', { name: 'Upload & Process' }).click();

  await expect(page.getByRole('button', { name: 'Back to cases' })).toBeVisible({
    timeout: 60_000,
  });
  // Preprocessing found signal, not an empty documents-only package.
  await expect(page.getByRole('button', { name: 'Analyze' })).toBeVisible();
});
