import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';

const AUTH_STATE = 'e2e/.auth/user.json';

async function expectWcagAa(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();

  expect(result.violations, JSON.stringify(result.violations, null, 2)).toEqual([]);
}

async function authenticatedPage(
  browser: Browser,
): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ storageState: AUTH_STATE });
  const page = await context.newPage();
  return { page, close: () => context.close() };
}

test.describe('WCAG 2.2 AA automated checks', () => {
  test('authentication choices and forms have no axe violations', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await expectWcagAa(page);

    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('#login-email')).toBeVisible();
    await expectWcagAa(page);

    await page.getByText('← Back').click();
    await page.getByRole('button', { name: 'Activate with license key' }).click();
    await expect(page.locator('#act-key')).toBeVisible();
    await expectWcagAa(page);

    await page.getByRole('button', { name: /dark mode/i }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expectWcagAa(page);
  });

  test('case list and account menu have no axe violations', async ({ browser }) => {
    const authenticated = await authenticatedPage(browser);
    try {
      await authenticated.page.goto('/');
      await expect(authenticated.page.getByRole('button', { name: 'Upload study' })).toBeVisible();
      await expectWcagAa(authenticated.page);

      await authenticated.page.getByRole('button', { name: 'Account menu' }).click();
      await expect(authenticated.page.getByRole('menu')).toBeVisible();
      await expectWcagAa(authenticated.page);

      await authenticated.page.keyboard.press('Escape');
      await authenticated.page.getByRole('button', { name: /dark mode/i }).click();
      await expect(authenticated.page.locator('html')).toHaveClass(/dark/);
      await expectWcagAa(authenticated.page);
    } finally {
      await authenticated.close();
    }
  });

  test('upload form has no axe violations', async ({ browser }) => {
    const authenticated = await authenticatedPage(browser);
    try {
      await authenticated.page.goto('/');
      await authenticated.page.getByRole('button', { name: 'Upload study' }).click();
      await expect(
        authenticated.page.getByRole('heading', { name: 'Upload Sleep Study' }),
      ).toBeVisible();
      await expectWcagAa(authenticated.page);

      await authenticated.page.getByRole('button', { name: /dark mode/i }).click();
      await expect(authenticated.page.locator('html')).toHaveClass(/dark/);
      await expectWcagAa(authenticated.page);
    } finally {
      await authenticated.close();
    }
  });
});

test.describe('WCAG 2.2 AA interaction checks', () => {
  test('authentication flow preserves keyboard focus and minimum target size', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto('/');

    const headings = page.getByRole('heading', { level: 1 });
    await expect(headings).toHaveCount(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);

    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: /dark mode/i })).toBeFocused();
    await page.keyboard.press('Tab');
    const activate = page.getByRole('button', { name: 'Activate with license key' });
    await expect(activate).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#act-email')).toBeFocused();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Activate account');

    await page.keyboard.press('Shift+Tab');
    const back = page.getByRole('button', { name: '← Back' });
    await expect(back).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(activate).toBeFocused();

    const controls = page.locator('button, input, select, textarea, [role="button"]');
    for (let index = 0; index < (await controls.count()); index += 1) {
      const box = await controls.nth(index).boundingBox();
      if (box) {
        expect(box.width, `control ${index} width`).toBeGreaterThanOrEqual(24);
        expect(box.height, `control ${index} height`).toBeGreaterThanOrEqual(24);
      }
    }
  });

  test('account menu closes with Escape and restores trigger focus', async ({ browser }) => {
    const authenticated = await authenticatedPage(browser);
    try {
      await authenticated.page.goto('/');
      const trigger = authenticated.page.getByRole('button', { name: 'Account menu' });
      await trigger.click();
      await expect(authenticated.page.getByRole('menu')).toBeVisible();
      await authenticated.page.keyboard.press('Escape');
      await expect(authenticated.page.getByRole('menu')).toBeHidden();
      await expect(trigger).toBeFocused();
    } finally {
      await authenticated.close();
    }
  });

  test('upload form reflows without horizontal scrolling at 320px', async ({ browser }) => {
    const context = await browser.newContext({
      storageState: AUTH_STATE,
      viewport: { width: 320, height: 800 },
    });
    const page = await context.newPage();
    try {
      await page.goto('/');
      await page.getByRole('button', { name: 'Upload study' }).click();
      await expect(
        page.getByRole('heading', { level: 1, name: 'Upload Sleep Study' }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      ).toBe(true);
    } finally {
      await context.close();
    }
  });
});
