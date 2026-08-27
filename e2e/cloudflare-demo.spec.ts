import { expect, test } from '@playwright/test';

const liveDemo = process.env.CLOUDFLARE_DEMO_LIVE === '1';

test.describe('deployed Cloudflare demo', () => {
  test.skip(!liveDemo, 'This proof is run only by the post-deploy Cloudflare release gate.');

  test('loads through the Pages proxy and records a proposal hold from the dashboard', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Keystone', level: 1 })).toBeVisible();
    await expect(page.getByText('Active conflicts').locator('..').getByText('3,050')).toBeVisible();

    const queue = page.getByRole('region', { name: 'Decide what to record' });
    await queue.getByRole('button', { name: 'Expand Decide what to record' }).click();
    const proposal = queue.getByRole('list', { name: 'Proposal results' }).getByRole('button').first();
    await expect(proposal).toBeVisible();
    await proposal.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Guarded proposal' })).toBeVisible();
    await dialog.getByRole('textbox', { name: 'Reason' }).fill('Cloudflare Pages proxy release verification');
    await dialog.getByRole('checkbox', { name: /I confirm this decision/u }).check();
    await dialog.getByRole('button', { name: 'Confirm hold' }).click();
    await expect(dialog.getByText('Decision recorded: held. This changed Keystone review state only.')).toBeVisible();
  });
});
