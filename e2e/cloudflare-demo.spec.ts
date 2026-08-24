import { expect, test } from '@playwright/test';

const liveDemo = process.env.CLOUDFLARE_DEMO_LIVE === '1';

test.describe('deployed Cloudflare demo', () => {
  test.skip(!liveDemo, 'This proof is run only by the post-deploy Cloudflare release gate.');

  test('loads through the Pages proxy and records a proposal hold from the dashboard', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Keystone', level: 1 })).toBeVisible();
    await expect(page.getByText('Active conflicts').locator('..').getByText('3,050')).toBeVisible();

    const queue = page.getByRole('region', { name: 'Proposal queue' });
    await expect(queue.getByRole('button').first()).toBeVisible();
    await queue.getByRole('button').first().click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Guarded proposal' })).toBeVisible();
    await dialog.getByRole('textbox', { name: 'Reason' }).fill('Cloudflare Pages proxy release verification');
    await dialog.getByRole('checkbox', { name: /I confirm this decision/u }).check();
    await dialog.getByRole('button', { name: 'Confirm hold' }).click();
    await expect(dialog.getByText('Decision recorded: held. This changed Keystone review state only.')).toBeVisible();
  });
});
