// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const THEME_TEXT_MUTED = {
  light: '71 85 105',
  dark: '203 213 225',
} as const;

async function waitForSettledTheme(page: Page): Promise<void> {
  const dark = await page.locator('html').evaluate((element) => element.classList.contains('dark'));
  // This semantic colour token feeds the muted text that axe evaluates. It
  // has no hover state, unlike the toggle, and its computed value proves the
  // palette settled without relying on an empty animation list.
  await expect
    .poll(() =>
      page.locator('html').evaluate((element) => {
        return getComputedStyle(element).getPropertyValue('--ui-text-muted').trim();
      }),
    )
    .toBe(dark ? THEME_TEXT_MUTED.dark : THEME_TEXT_MUTED.light);
}

/**
 * WCAG 2.2 AA 2.5.8 wants a 24×24 CSS px target.
 *
 * Visually-hidden inputs are excluded deliberately: an `.sr-only` file input
 * paired with a visible drop zone is not itself a target — the drop zone is, and
 * it is measured like any other control.
 */
async function expectMinimumTargetSize(page: Page): Promise<void> {
  const controls = page.locator(
    'button:not(.sr-only), input:not(.sr-only), select, textarea, [role="button"]',
  );
  for (let index = 0; index < (await controls.count()); index += 1) {
    const box = await controls.nth(index).boundingBox();
    if (box) {
      const description = await controls.nth(index).evaluate((el) => el.outerHTML.slice(0, 80));
      expect(box.width, `width of ${description}`).toBeGreaterThanOrEqual(24);
      expect(box.height, `height of ${description}`).toBeGreaterThanOrEqual(24);
    }
  }
}

async function expectWcagAa(page: Page): Promise<void> {
  await waitForSettledTheme(page);

  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();

  expect(result.violations, JSON.stringify(result.violations, null, 2)).toEqual([]);
}

test.describe('WCAG 2.2 AA automated checks', () => {
  test('case list has no axe violations', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Upload study' })).toBeVisible();
    // This suite runs the offline model, so the persistent disclosure is part of
    // the page axe audits.
    await expect(page.getByRole('status')).toContainText(/report text is generated/i);
    await expectWcagAa(page);

    await page.getByRole('button', { name: /dark mode/i }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expectWcagAa(page);
  });

  test('upload form has no axe violations', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Upload study' }).click();
    await expect(page.getByRole('heading', { name: 'Upload Sleep Study' })).toBeVisible();
    await expectWcagAa(page);

    await page.getByRole('button', { name: /dark mode/i }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expectWcagAa(page);
  });
});

test.describe('WCAG 2.2 AA interaction checks', () => {
  test('landing view preserves keyboard focus and minimum target size', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Upload study' })).toBeVisible();

    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);

    // With no sign-in screen the header is the first stop: the brand button,
    // then upload, then the theme toggle. Upload must be reachable and operable
    // by keyboard alone.
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Somnoscribe' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Upload study' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: 'Upload Sleep Study' })).toBeVisible();

    await expectMinimumTargetSize(page);
  });

  test('upload form reflows without horizontal scrolling at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Upload study' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Upload Sleep Study' })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await expectMinimumTargetSize(page);
  });
});
