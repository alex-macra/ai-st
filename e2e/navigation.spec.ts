import { test, expect } from '@playwright/test';

test.use({ storageState: 'e2e/.auth/user.json' });

const MOCK_USER = JSON.stringify({ user: { id: 'test-id', email: 'reviewer@example.test', organizationId: null } });
const EMPTY_CASES = JSON.stringify({ cases: [] });

test.describe('navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('/api/auth/me', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: MOCK_USER });
    });
    await page.route('/api/cases*', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: EMPTY_CASES });
    });
    await page.goto('/');
    await expect(page.getByText('No cases yet')).toBeVisible({ timeout: 10_000 });
  });

  test('dark mode toggle switches html.dark class', async ({ page }) => {
    const html = page.locator('html');
    const isDark = await html.evaluate((el) => el.classList.contains('dark'));

    const toggleBtn = page.getByRole('button', { name: /dark mode|light mode/i });
    await toggleBtn.click();

    if (isDark) {
      await expect(html).not.toHaveClass(/dark/);
    } else {
      await expect(html).toHaveClass(/dark/);
    }

    // Second click restores original state
    await toggleBtn.click();
    if (isDark) {
      await expect(html).toHaveClass(/dark/);
    } else {
      await expect(html).not.toHaveClass(/dark/);
    }
  });

  test('AI-ST logo button navigates to case list from upload', async ({ page }) => {
    await page.getByRole('button', { name: 'Upload study' }).click();
    await expect(page.getByRole('heading', { name: 'Upload Sleep Study' })).toBeVisible();

    await page.getByRole('button', { name: 'AI-ST' }).click();
    await expect(page.getByText('No cases yet')).toBeVisible();
    await expect(page.getByText('Upload a study to get started.')).toBeVisible();
  });

  test('sign out redirects to auth screen', async ({ page }) => {
    await page.route('/api/auth/logout', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    });

    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible({ timeout: 5_000 });
  });
});
