import { test, expect, Page } from '@playwright/test';

async function waitForLoaded(page: Page): Promise<void> {
  await expect(page.getByText(/^Loading\.{0,3}$/i)).toHaveCount(0, { timeout: 30000 });
}

test.describe('Smoke: settings', () => {
  test('TC_SETT_072: User details open from the Users list', async ({ page }) => {
    await page.goto('/users');
    await waitForLoaded(page);
    await page.getByRole('main').getByRole('button', { name: /view/i }).first().click();
    await expect(page).toHaveURL(/\/users\/.+/);
    await expect(page.getByText('Basic Information')).toBeVisible();
    await expect(page.getByText('Organization Information')).toBeVisible();
  });

  test('TC_SETT_119: Organization details open from the Organizations list', async ({ page }) => {
    await page.goto('/organizations');
    await waitForLoaded(page);
    await page.getByRole('main').getByRole('button', { name: /view/i }).first().click();
    await expect(page).toHaveURL(/\/organizations\/ORG/i);
    await expect(page.getByText('Subscription', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Document Limit')).toBeVisible();
  });
});
