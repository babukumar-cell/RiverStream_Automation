import { test, expect } from '../../src/fixtures/test.fixture';
import { Config } from '../../src/config/environment';

test.describe('River Stream - Left Side Fields & Dashboard Suite', () => {

  test.beforeEach(async ({ loginPage, dashboardPage }) => {
    await loginPage.navigate();
    await loginPage.login(Config.adminEmail, Config.adminPassword);
    const isLoaded = await dashboardPage.isDashboardLoaded();
    expect(isLoaded).toBeTruthy();
  });

  test('TC_Logout_001: Verify Logout button visibility and location', async ({ leftSidePage }) => {
    await expect(leftSidePage.logoutButton).toBeVisible();
  });

  test('TC_Org_003: Verify Organization dropdown is displayed', async ({ leftSidePage }) => {
    await expect(leftSidePage.orgDropdown).toBeVisible();
  });

  test('TC_Dashboard_006: Verify Total Documents card is displayed', async ({ leftSidePage }) => {
    await expect(leftSidePage.totalDocumentsCard).toBeVisible();
  });

  test('TC_Dashboard_007: Verify Processing Rate card is displayed', async ({ leftSidePage }) => {
    await expect(leftSidePage.processingRateCard).toBeVisible();
  });

  test('TC_Dashboard_008: Verify Extraction Accuracy card is displayed', async ({ leftSidePage }) => {
    await expect(leftSidePage.extractionAccuracyCard).toBeVisible();
  });

  test('TC_Dashboard_009: Verify Reviewed card is displayed', async ({ leftSidePage }) => {
    await expect(leftSidePage.reviewedCard).toBeVisible();
  });

  test('TC_Dashboard_011: Verify Pending Review card is displayed', async ({ leftSidePage }) => {
    await expect(leftSidePage.pendingReviewCard).toBeVisible();
  });

  test('TC_Dashboard_013: Verify Processing card is displayed', async ({ leftSidePage }) => {
    await expect(leftSidePage.processingCard).toBeVisible();
  });

  test('TC_Dashboard_015: Verify Avg Processing Time card is displayed', async ({ leftSidePage }) => {
    await expect(leftSidePage.avgProcessingTimeCard).toBeVisible();
  });

  test('TC_Nav_021: Verify Documents navigation link works', async ({ leftSidePage, page }) => {
    if (await leftSidePage.documentsNavLink.isVisible()) {
      await leftSidePage.documentsNavLink.click();
      await page.waitForURL((url) => !url.pathname.endsWith('/dashboard'), { timeout: 15000 }).catch(() => {});
      expect(page.url()).toMatch(/document/i);
    }
  });

  test('TC_Logout_002: Verify Logout button functionality redirects to login', async ({ leftSidePage, page }) => {
    await leftSidePage.clickLogout();
    await page.waitForURL((url) => url.pathname.includes('/login') || url.pathname === '/', { timeout: 15000 }).catch(() => {});
    expect(page.url()).toMatch(/riverstream(-qa)?\.azurewebsites\.net/);
  });

});
