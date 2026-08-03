import { test, expect } from '@playwright/test';

test.use({ storageState: 'e2e/.auth/user.json' });

const FAKE_EDF = { name: 'night1.edf', mimeType: 'application/octet-stream', buffer: Buffer.from('0       ') };
const FAKE_PDF = { name: 'report.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') };
const FAKE_IMG = { name: 'screen.png', mimeType: 'image/png', buffer: Buffer.from('PNG') };
const MOCK_USER = JSON.stringify({ user: { id: 'test-id', email: 'reviewer@example.test', organizationId: null } });
const EMPTY_CASES = JSON.stringify({ cases: [] });

test.describe('CaseUpload form', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('/api/auth/me', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: MOCK_USER });
    });
    // Stub cases so the initial list load never hits the real API
    await page.route('/api/cases*', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: EMPTY_CASES });
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Upload study' }).click();
    await expect(page.getByRole('heading', { name: 'Upload Sleep Study' })).toBeVisible();
  });

  test('renders Patient Cohort and Study Files sections', async ({ page }) => {
    await expect(page.getByRole('group').filter({ hasText: 'Patient Cohort' })).toBeVisible();
    await expect(page.getByRole('group').filter({ hasText: 'Study Files' })).toBeVisible();
  });

  test('upload button is disabled and warning shown when no files selected', async ({ page }) => {
    const submitBtn = page.getByRole('button', { name: 'Upload & Process' });
    await expect(submitBtn).toBeDisabled();
    await expect(page.getByText('Select at least one file to enable the upload button.')).toBeVisible();
  });

  test('cohort defaults to pediatric and can toggle to adult', async ({ page }) => {
    const adultRadio = page.getByRole('radio', { name: 'Adult' });
    const pediatricRadio = page.getByRole('radio', { name: 'Pediatric' });

    await expect(pediatricRadio).toBeChecked();
    await expect(adultRadio).not.toBeChecked();

    await adultRadio.click();
    await expect(adultRadio).toBeChecked();
    await expect(pediatricRadio).not.toBeChecked();
  });

  test('selecting EDF shows filename and enables submit button', async ({ page }) => {
    await page.locator('input[type="file"][accept=".edf"]').setInputFiles(FAKE_EDF);

    await expect(page.getByText('night1.edf')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Upload & Process' })).toBeEnabled();
    await expect(page.getByText('Select at least one file to enable the upload button.')).not.toBeVisible();
  });

  test('clearing EDF removes file and disables submit again', async ({ page }) => {
    await page.locator('input[type="file"][accept=".edf"]').setInputFiles(FAKE_EDF);
    await expect(page.getByText('night1.edf')).toBeVisible();

    await page.getByRole('button', { name: 'Remove night1.edf', exact: true }).click();
    await expect(page.getByText('night1.edf')).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Upload & Process' })).toBeDisabled();
  });

  test('selecting PDF alone enables submit', async ({ page }) => {
    // PDF input is inside a collapsible section — expand it first
    await page.getByRole('button', { name: /Add supporting files/i }).click();
    await page.locator('input[type="file"][accept=".pdf"]').setInputFiles(FAKE_PDF);
    await expect(page.getByText('report.pdf')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Upload & Process' })).toBeEnabled();
  });

  test('selecting screenshot alone enables submit', async ({ page }) => {
    // Screenshot input is inside a collapsible section — expand it first
    await page.getByRole('button', { name: /Add supporting files/i }).click();
    await page.locator('input[type="file"][accept="image/*"]').setInputFiles(FAKE_IMG);
    await expect(page.getByText('screen.png')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Upload & Process' })).toBeEnabled();
  });

  test('successful upload opens workspace for the new case', async ({ page }) => {
    const MOCK_CASE = {
      id: 'test-case-abc', name: 'study.edf', status: 'draft', cohort: 'pediatric',
      createdAt: new Date().toISOString(), findings: [], edfAvailable: true, studyHash: 'abc',
    };
    await page.route('/api/upload', async (route) => {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ caseId: 'test-case-abc', studyHash: 'abc', name: 'study.edf' }),
      });
    });
    // Specific case detail — wins over beforeEach /api/cases* (LIFO matching)
    await page.route('/api/cases/test-case-abc', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ case: MOCK_CASE }) });
    });

    await page.locator('input[type="file"][accept=".edf"]').setInputFiles(FAKE_EDF);
    await page.getByRole('button', { name: 'Upload & Process' }).click();

    // Wait for the workspace's unambiguous "Back to cases" button — confirms
    // the upload succeeded and navigation to the workspace view completed.
    await expect(page.getByRole('button', { name: 'Back to cases' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('heading', { name: 'study.edf' })).toBeAttached();
  });

  test('upload error shows toast', async ({ page }) => {
    await page.route('/api/upload', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Preprocessor unavailable' }),
      });
    });

    await page.locator('input[type="file"][accept=".edf"]').setInputFiles(FAKE_EDF);
    await page.getByRole('button', { name: 'Upload & Process' }).click();

    await expect(page.getByText('Preprocessor unavailable')).toBeVisible({ timeout: 10_000 });
  });

  test('progress bar and step text appear during upload', async ({ page }) => {
    let resolveUpload!: () => void;
    const uploadDone = new Promise<void>((res) => { resolveUpload = res; });

    const MOCK_CASE = {
      id: 'slow-case', name: 'study.edf', status: 'draft', cohort: 'pediatric',
      createdAt: new Date().toISOString(), findings: [], edfAvailable: true, studyHash: 'abc',
    };
    await page.route('/api/upload', async (route) => {
      await uploadDone;
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ caseId: 'slow-case', studyHash: 'abc', name: 'study.edf' }),
      });
    });
    await page.route('/api/cases/slow-case', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ case: MOCK_CASE }) });
    });

    await page.locator('input[type="file"][accept=".edf"]').setInputFiles(FAKE_EDF);
    await page.getByRole('button', { name: 'Upload & Process' }).click();

    // Progress text visible while upload is in-flight
    await expect(page.getByText('Sending files to server…')).toBeVisible({ timeout: 3_000 });

    resolveUpload();
    // Navigation to the workspace is the success signal — wait for the
    // workspace-only "Back to cases" button, which is unambiguous.
    await expect(page.getByRole('button', { name: 'Back to cases' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('heading', { name: 'study.edf' })).toBeAttached();
  });
});
