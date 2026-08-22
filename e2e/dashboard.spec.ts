import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function loadDashboard(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Keystone', level: 1 })).toBeVisible();
  await expect(page.getByText('Evidence connected')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Trust overview' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Conflict evidence' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Proposal queue' })).toBeVisible();
}

test.describe('production dashboard', () => {
  let consoleErrors: string[];
  let pageErrors: string[];

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];
    pageErrors = [];
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('pageerror', (error) => pageErrors.push(error.message));
  });

  test.afterEach(() => {
    expect(consoleErrors, 'the production bundle must not emit console errors').toEqual([]);
    expect(pageErrors, 'the production bundle must not emit uncaught page errors').toEqual([]);
  });

  test('loads the real evidence window with security headers and bounded layout', async ({ page }) => {
    const response = await page.request.get('/');
    expect(response.status()).toBe(200);
    expect(response.headers()['x-content-type-options']).toBe('nosniff');
    expect(response.headers()['x-frame-options']).toBe('DENY');
    expect(response.headers()['referrer-policy']).toBe('no-referrer');
    expect(response.headers()['content-security-policy']).toContain("default-src 'self'");

    await loadDashboard(page);
    await expect(page.getByText('Active conflicts').locator('..').getByText('3,050')).toBeVisible();
    await expect(page.getByText('source writes: zero')).toBeVisible();
    await expect(page.getByLabel('Source freshness').getByText('CRM')).toBeVisible();
    await expect(page.getByLabel('Source freshness').getByText('APP')).toBeVisible();
    await expect(page.getByLabel('Source freshness').getByText('PAYMENTS')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test('supports skip navigation and keyboard-operable evidence filters', async ({ page }) => {
    await loadDashboard(page);
    const skipLink = page.getByRole('link', { name: 'Skip to reconciliation workspace' });
    await page.keyboard.press('Tab');
    await expect(skipLink).toBeFocused();
    await expect(skipLink).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#main-content$/u);

    const conflictRegion = page.getByRole('region', { name: 'Conflict evidence' });
    await conflictRegion.getByRole('combobox', { name: 'Source' }).selectOption('payments');
    await expect(conflictRegion.getByText('Checking this evidence window…')).toBeHidden();
    const rows = conflictRegion.locator('tbody tr');
    await expect(rows.first()).toBeVisible();
    const rowCount = await rows.count();
    for (let index = 0; index < rowCount; index += 1) await expect(rows.nth(index).getByRole('list', { name: 'Sources' })).toContainText('payments');
    await conflictRegion.getByRole('button', { name: 'Reset' }).click();
    await expect(conflictRegion.getByRole('combobox', { name: 'Source' })).toHaveValue('');
  });

  test('opens an auditable modal, traps focus, and restores the invoking control', async ({ page }) => {
    await loadDashboard(page);
    const conflictRegion = page.getByRole('region', { name: 'Conflict evidence' });
    await conflictRegion.getByRole('combobox', { name: 'Proposal status' }).selectOption('pending');
    await expect(conflictRegion.getByText('Checking this evidence window…')).toBeHidden();
    const trigger = conflictRegion.locator('tbody .row-link').first();
    await trigger.focus();
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Invariant evidence' })).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Guarded proposal' })).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Field lineage' })).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Audit history' })).toBeVisible();
    const close = dialog.getByRole('button', { name: 'Close conflict detail' });
    await expect(close).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();

    const reason = dialog.getByRole('textbox', { name: 'Reason' });
    await reason.fill('Browser-only review check');
    await dialog.getByRole('checkbox', { name: /I confirm this decision/u }).check();
    await expect(dialog.getByRole('button', { name: 'Confirm hold' })).toBeEnabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('has no automated WCAG A or AA violations in the loaded and detail states', async ({ page }) => {
    await loadDashboard(page);
    const loaded = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(loaded.violations).toEqual([]);

    await page.getByRole('region', { name: 'Conflict evidence' }).locator('tbody .row-link').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    const detail = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(detail.violations).toEqual([]);
  });

  test('keeps all review controls usable at the configured viewport', async ({ page }, testInfo) => {
    await loadDashboard(page);
    const viewport = page.viewportSize();
    expect(viewport).toBeTruthy();
    if (testInfo.project.name === 'narrow-chromium') expect(viewport!.width).toBeLessThanOrEqual(400);
    else expect(viewport!.width).toBeGreaterThanOrEqual(1200);

    const filters = page.getByRole('group', { name: 'Filter conflicts' });
    await expect(filters.getByRole('combobox', { name: 'Conflict type' })).toBeVisible();
    await expect(filters.getByRole('combobox', { name: 'Minimum confidence' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Queue status' })).toBeVisible();
    expect(await page.evaluate(() => document.body.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
});
