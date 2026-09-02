import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { ONBOARDING_INTRO_STORAGE_KEY } from '../frontend/src/onboardingMemory';

const liveDemo = process.env.CLOUDFLARE_DEMO_LIVE === '1';
const coldStartTimeoutMs = 150_000;

async function suppressOnboarding(page: Page): Promise<void> {
  await page.addInitScript((key: string) => {
    window.localStorage.setItem(key, JSON.stringify({
      seen: true,
      seenAt: '2026-01-15T12:00:00.000Z',
      outcome: 'completed'
    }));
  }, ONBOARDING_INTRO_STORAGE_KEY);
}

async function loadDashboard(page: Page): Promise<void> {
  await suppressOnboarding(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Keystone', level: 1 })).toBeVisible();
  await expect(page.getByText('Evidence connected')).toBeVisible({ timeout: liveDemo ? coldStartTimeoutMs : 10_000 });
  await expect(page.getByRole('heading', { name: 'Start with the evidence' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Find the conflicts' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Decide what to record' })).toBeVisible();
  await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>('button[aria-label="Expand Start with the evidence"]')?.click();
    document.querySelector<HTMLButtonElement>('button[aria-label="Expand Find the conflicts"]')?.click();
    document.querySelector<HTMLButtonElement>('button[aria-label="Expand Decide what to record"]')?.click();
  });
}

test.describe('production dashboard', () => {
  let consoleErrors: string[];
  let pageErrors: string[];
  let transientOverviewResponses: Promise<boolean>[];

  test.describe.configure({ timeout: liveDemo ? 180_000 : 30_000 });

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];
    pageErrors = [];
    transientOverviewResponses = [];
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('response', (response) => {
      if (response.status() !== 503 || new URL(response.url()).pathname !== '/api/v1/overview') return;
      transientOverviewResponses.push(response.json()
        .then((body: unknown) => typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'object' && body.error !== null && 'code' in body.error && (body.error.code === 'bootstrap_in_progress' || body.error.code === 'backend_unavailable'))
        .catch(() => false));
    });
  });

  test.afterEach(async () => {
    const transientResponseCount = (await Promise.all(transientOverviewResponses)).filter(Boolean).length;
    let remainingTransientErrors = transientResponseCount;
    const unexpectedConsoleErrors = consoleErrors.filter((message) => {
      if (remainingTransientErrors > 0 && message === 'Failed to load resource: the server responded with a status of 503 ()') {
        remainingTransientErrors -= 1;
        return false;
      }
      return true;
    });
    expect(unexpectedConsoleErrors, 'the production bundle must not emit unexpected console errors').toEqual([]);
    expect(pageErrors, 'the production bundle must not emit uncaught page errors').toEqual([]);
  });

  test('loads the real evidence window with security headers and bounded layout', async ({ page }) => {
    const response = await page.request.get('/');
    expect(response.status()).toBe(200);
    expect(response.headers()['x-content-type-options']).toBe('nosniff');
    expect(response.headers()['x-frame-options']).toBe('DENY');
    expect(response.headers()['referrer-policy']).toBe('no-referrer');
    expect(response.headers()['content-security-policy']).toContain("default-src 'self'");

    const favicon = await page.request.get('/favicon.ico');
    expect(favicon.status()).toBe(200);
    expect(favicon.headers()['content-type']).toMatch(/icon|png/i);
    expect(Buffer.from(await favicon.body()).subarray(0, 4)).toEqual(Buffer.from([0, 0, 1, 0]));

    await loadDashboard(page);
    await expect(page.getByText('Active conflicts').locator('..').getByText('305')).toBeVisible();
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

    const conflictRegion = page.getByRole('region', { name: 'Find the conflicts' });
    await conflictRegion.getByRole('combobox', { name: 'Source' }).selectOption('payments');
    await expect(conflictRegion.getByText('Checking this evidence window…')).toBeHidden();
    const rows = conflictRegion.locator('tbody tr');
    await expect(rows.first()).toBeVisible();
    const rowCount = await rows.count();
    for (let index = 0; index < rowCount; index += 1) await expect(rows.nth(index).getByRole('list', { name: 'Evidence sources' })).toContainText('Payments');
    await conflictRegion.getByRole('button', { name: 'Reset' }).click();
    await expect(conflictRegion.getByRole('combobox', { name: 'Source' })).toHaveValue('');
  });

  test('opens an auditable modal, traps focus, and restores the invoking control', async ({ page }) => {
    await loadDashboard(page);
    const conflictRegion = page.getByRole('region', { name: 'Find the conflicts' });
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

    await page.getByRole('region', { name: 'Find the conflicts' }).locator('tbody .row-link').first().click();
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
    await expect(page.getByRole('combobox', { name: 'Review state' })).toBeVisible();
    expect(await page.evaluate(() => document.body.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
});

test.describe('first-visit onboarding spotlight', () => {
  test('shows an informative hero above the accordions, then remembers skip in local cache', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Keystone', level: 1 })).toBeVisible();
    const intro = page.getByRole('region', { name: 'Keystone intro' });
    await expect(intro).toBeVisible();
    await expect(intro).toContainText('You do not create an account');
    const headerBox = await page.locator('.site-header').boundingBox();
    const introBox = await intro.boundingBox();
    const overviewBox = await page.getByRole('heading', { name: 'Start with the evidence' }).boundingBox();
    expect(headerBox && introBox && overviewBox).toBeTruthy();
    expect(headerBox!.y).toBeLessThan(introBox!.y);
    expect(introBox!.y).toBeLessThan(overviewBox!.y);

    await intro.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Begin with what is verified' })).toBeVisible();
    await page.getByRole('button', { name: 'Skip intro' }).click();
    await expect(intro).toHaveCount(0);
    expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}').seen, ONBOARDING_INTRO_STORAGE_KEY)).toBe(true);

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Start with the evidence' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Skip intro' })).toHaveCount(0);
  });

  test('keeps the intro banner inside the viewport width', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Keystone intro' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
});
