import { test, expect } from '@playwright/test';

// No storageState - these tests verify the unauthenticated UI.
test.use({ storageState: undefined });

test.describe('auth screen', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('shows Somnoscribe branding and choice buttons', async ({ page }) => {
    await expect(page.getByText('Somnoscribe Sleep Study Review Assistant')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Activate with license key' })).toBeVisible();
  });

  test('sign in flow: choice → email input → OTP screen', async ({ page }) => {
    await page.getByRole('button', { name: 'Sign in' }).click();

    const emailInput = page.locator('#login-email');
    await expect(emailInput).toBeVisible();
    await expect(emailInput).toHaveAttribute('type', 'email');

    await emailInput.fill(DEV_EMAIL);
    await page.getByRole('button', { name: 'Send sign-in code' }).click();

    await expect(page.locator('#otp-code')).toBeVisible();
    await expect(page.getByText(DEV_EMAIL)).toBeVisible();
  });

  test('back button from login returns to choice', async ({ page }) => {
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByText('← Back').click();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });

  test('back button from OTP screen returns to login', async ({ page }) => {
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.locator('#login-email').fill(DEV_EMAIL);
    await page.getByRole('button', { name: 'Send sign-in code' }).click();
    await expect(page.locator('#otp-code')).toBeVisible();

    await page.getByText('← Back').click();
    await expect(page.locator('#login-email')).toBeVisible();
  });

  test('activate flow: choice → activate form', async ({ page }) => {
    await page.getByRole('button', { name: 'Activate with license key' }).click();
    await expect(page.getByText('Activate account')).toBeVisible();
    await expect(page.locator('#act-key')).toBeVisible();
  });

  test('dark mode toggle works on auth screen', async ({ page }) => {
    const html = page.locator('html');
    const toggleBtn = page.getByRole('button', { name: /dark mode|light mode/i });

    const isDark = await html.evaluate((el) => el.classList.contains('dark'));
    await toggleBtn.click();
    if (isDark) {
      await expect(html).not.toHaveClass(/dark/);
    } else {
      await expect(html).toHaveClass(/dark/);
    }
  });

  test('matches the synthetic unauthenticated visual baseline', async ({ page }) => {
    await page.evaluate(() => {
      window.localStorage.setItem('dark-mode', 'false');
    });
    await page.reload();
    await expect(page).toHaveScreenshot('auth-screen.png', {
      animations: 'disabled',
      caret: 'hide',
      fullPage: true,
      maxDiffPixelRatio: 0.012,
    });
  });
});

const DEV_EMAIL = 'reviewer@example.test';
