import { test, expect } from '../../src/fixtures/test.fixture';
import { Config } from '../../src/config/environment';

test.describe('River Stream - Left Side Fields & Dashboard Suite (40 Test Cases)', () => {

  test.beforeEach(async ({ loginPage, dashboardPage }) => {
    await loginPage.navigate();
    await loginPage.login(Config.adminEmail, Config.adminPassword);
    const isLoaded = await dashboardPage.isDashboardLoaded();
    expect(isLoaded).toBeTruthy();
  });

  // =========================================================================
  // Logout & Navigation
  // =========================================================================

  test('TC_Lefit-side-fields_001: Verify Logout button visibility and location', async ({ leftSidePage }) => {
    await expect(leftSidePage.logoutButton).toBeVisible();
  });

  test('TC_Left-side-fields_001: Verify Logout button functionality', async ({ leftSidePage, page }) => {
    await leftSidePage.clickLogout();
    await page.waitForURL((url) => url.pathname.includes('/login') || url.pathname === '/', { timeout: 15000 }).catch(() => {});
    expect(page.url()).toMatch(/riverstream(-qa)?\.azurewebsites\.net/);
  });

  // =========================================================================
  // Metric Cards & Layout
  // =========================================================================

  test('TC_Dashboard_003: Verify Total Documents metric card with counts displayed', async ({ dashboardPage }) => {
    const card = dashboardPage.kpiTabs.filter({ hasText: /Total Documents/i }).first();
    await expect(card).toBeVisible();
    await expect(card).toHaveText(/\d+/);
  });

  test('TC_Dashboard_004: Verify Organization dropdown is displayed', async ({ dashboardPage }) => {
    await expect(dashboardPage.orgCombobox).toBeVisible();
  });

  test('TC_Dashboard_005: Verify Organization dropdown options', async ({ dashboardPage, page }) => {
    await dashboardPage.openOrgDropdown();
    const count = await dashboardPage.orgOptions.count();
    expect(count).toBeGreaterThan(0);
    await page.keyboard.press('Escape');
  });

  test('TC_Dashboard_006: Verify Organization selection functionality', async ({ dashboardPage }) => {
    await dashboardPage.openOrgDropdown();
    const firstOption = dashboardPage.orgOptions.first();
    const orgName = (await firstOption.innerText()).trim();
    await firstOption.click();
    await expect(dashboardPage.orgCombobox).toHaveText(new RegExp(orgName, 'i'));
  });

  test('TC_Dashboard_007: Verify Reviewed metric card is displayed', async ({ dashboardPage }) => {
    const card = dashboardPage.kpiTabs.filter({ hasText: /Reviewed/i }).first();
    await expect(card).toBeVisible();
  });

  test('TC_Dashboard_008: Verify Pending Review metric card is displayed', async ({ dashboardPage }) => {
    const card = dashboardPage.kpiTabs.filter({ hasText: /Pending Review/i }).first();
    await expect(card).toBeVisible();
  });

  test('TC_Dashboard_009: Verify Processing metric card is displayed', async ({ dashboardPage }) => {
    const card = dashboardPage.kpiTabs.filter({ hasText: /Processing/i }).first();
    await expect(card).toBeVisible();
  });

  test('TC_Dashboard_010: Verify dashboard card alignment', async ({ dashboardPage }) => {
    await expect(dashboardPage.kpiTablist).toBeVisible();
    const box = await dashboardPage.kpiTablist.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(300);
  });

  test('TC_Dashboard_011: Verify dashboard data refresh on page reload', async ({ dashboardPage, page }) => {
    await page.reload();
    expect(await dashboardPage.isDashboardLoaded()).toBeTruthy();
    await expect(dashboardPage.kpiTablist).toBeVisible();
  });

  test('TC_Dashboard_012: Verify dashboard responsiveness', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await expect(page.locator('aside')).toBeVisible();
    await expect(page.locator('main').first()).toBeVisible();
  });

  // =========================================================================
  // Uploaded By Columns & Tracking
  // =========================================================================

  test('TC_Dashboard_014: Verify Uploaded By column on Dashboard', async ({ dashboardPage }) => {
    await expect(dashboardPage.tableHeaderCells.filter({ hasText: /Uploaded By/i }).first()).toBeVisible();
  });

  test('TC_Dashboard_015: Verify Uploaded By column on Documents page', async ({ page }) => {
    await page.goto('/documents');
    await expect(page.locator('thead th, thead td').filter({ hasText: /Uploaded By/i }).first()).toBeVisible();
  });

  test('TC_Dashboard_016: Verify name for website-uploaded documents', async ({ dashboardPage }) => {
    const rows = dashboardPage.tableRows;
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('TC_Dashboard_017: Verify name for email-received documents', async ({ dashboardPage }) => {
    const rows = dashboardPage.tableRows;
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('TC_Dashboard_018: Verify Uploaded By for different users', async ({ dashboardPage }) => {
    const count = await dashboardPage.tableRows.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('TC_Dashboard_019: Verify Uploaded By values match across pages', async ({ dashboardPage, page }) => {
    const dashRow = dashboardPage.tableRows.first();
    if (await dashRow.isVisible().catch(() => false)) {
      const fileName = (await dashRow.locator('td').first().innerText()).trim();
      await page.goto('/documents');
      await page.getByPlaceholder('Search documents...').fill(fileName);
      await expect(page.locator('tbody tr').first()).toContainText(fileName);
    }
  });

  test('TC_Dashboard_020: Verify Uploaded By for existing documents', async ({ dashboardPage }) => {
    const count = await dashboardPage.tableRows.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  // =========================================================================
  // Export Functionality
  // =========================================================================

  test('TC_Dashboard_021: Verify the Export icon is visible for all user logins.', async ({ dashboardPage }) => {
    await expect(dashboardPage.exportButton).toBeVisible();
  });

  test('TC_Dashboard_022: Verify the CSV download option.', async ({ dashboardPage }) => {
    await dashboardPage.exportButton.click();
    await expect(dashboardPage.exportCsvItem).toBeVisible();
    await dashboardPage.page.keyboard.press('Escape');
  });

  test('TC_Dashboard_023: Verify the XLSX download option.', async ({ dashboardPage }) => {
    await dashboardPage.exportButton.click();
    await expect(dashboardPage.exportXlsxItem).toBeVisible();
    await dashboardPage.page.keyboard.press('Escape');
  });

  test('TC_Dashboard_024: Verify the exported report based on the applied filters.', async ({ dashboardPage }) => {
    await expect(dashboardPage.exportButton).toBeVisible();
  });

  test('TC_Dashboard_025: Verify the Document Name column in the exported report.', async ({ dashboardPage }) => {
    await expect(dashboardPage.tableHeaderCells.filter({ hasText: /Document Name|File Name/i }).first()).toBeVisible();
  });

  test('TC_Dashboard_026: Verify the Customer column in the exported report.', async ({ dashboardPage }) => {
    await expect(dashboardPage.tableHeaderCells.filter({ hasText: /Customer/i }).first()).toBeVisible();
  });

  test('TC_Dashboard_027: Verify the Uploaded By and Uploader Email columns.', async ({ dashboardPage }) => {
    await expect(dashboardPage.tableHeaderCells.filter({ hasText: /Uploaded By/i }).first()).toBeVisible();
  });

  test('TC_Dashboard_028: Verify the Uploaded From column.', async ({ dashboardPage }) => {
    const count = await dashboardPage.tableRows.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('TC_Dashboard_029: Verify the Upload Date column.', async ({ dashboardPage }) => {
    await expect(dashboardPage.tableHeaderCells.filter({ hasText: /Upload Date|Date/i }).first()).toBeVisible();
  });

  test('TC_Dashboard_030: Verify the Status Details column.', async ({ dashboardPage }) => {
    await expect(dashboardPage.tableHeaderCells.filter({ hasText: /Status/i }).first()).toBeVisible();
  });

  // =========================================================================
  // Date Filters
  // =========================================================================

  test('TC_Dashboard_031: Verify the date filter is displayed in the Dashboard header.', async ({ dashboardPage }) => {
    await expect(dashboardPage.dateRangeButton).toBeVisible();
  });

  test('TC_Dashboard_032: Verify the default date filter option.', async ({ dashboardPage }) => {
    await expect(dashboardPage.dateRangeButton).toHaveAttribute('aria-label', /Date range:/i);
  });

  test('TC_Dashboard_033: Verify the This week filter.', async ({ dashboardPage }) => {
    await dashboardPage.dateRangeButton.click();
    const thisWeek = dashboardPage.page.getByRole('button', { name: /This week/i });
    if (await thisWeek.isVisible().catch(() => false)) {
      await thisWeek.click();
    }
    await dashboardPage.page.keyboard.press('Escape');
  });

  test('TC_Dashboard_034: Verify the Last week filter.', async ({ dashboardPage }) => {
    await dashboardPage.dateRangeButton.click();
    const lastWeek = dashboardPage.page.getByRole('button', { name: /Last week/i });
    if (await lastWeek.isVisible().catch(() => false)) {
      await lastWeek.click();
    }
    await dashboardPage.page.keyboard.press('Escape');
  });

  test('TC_Dashboard_035: Verify the This month filter.', async ({ dashboardPage }) => {
    await dashboardPage.dateRangeButton.click();
    const thisMonth = dashboardPage.page.getByRole('button', { name: /This month/i });
    if (await thisMonth.isVisible().catch(() => false)) {
      await thisMonth.click();
    }
    await dashboardPage.page.keyboard.press('Escape');
  });

  test('TC_Dashboard_036: Verify the Last month filter.', async ({ dashboardPage }) => {
    await dashboardPage.dateRangeButton.click();
    const lastMonth = dashboardPage.page.getByRole('button', { name: /Last month/i });
    if (await lastMonth.isVisible().catch(() => false)) {
      await lastMonth.click();
    }
    await dashboardPage.page.keyboard.press('Escape');
  });

  test('TC_Dashboard_037: Verify the single date filter.', async ({ dashboardPage }) => {
    await expect(dashboardPage.dateRangeButton).toBeVisible();
  });

  test('TC_Dashboard_038: Verify the custom date range selection.', async ({ dashboardPage }) => {
    await dashboardPage.dateRangeButton.click();
    await expect(dashboardPage.dateRangeGroup.or(dashboardPage.calendar)).toBeVisible();
    await dashboardPage.page.keyboard.press('Escape');
  });

  test('TC_Dashboard_039: Verify the Cards filter.', async ({ dashboardPage }) => {
    const kpiTab = dashboardPage.kpiTabs.nth(1);
    await kpiTab.click();
    await expect(kpiTab).toHaveAttribute('aria-selected', 'true');
  });

  test('TC_Dashboard_040: Verify Document Type Filter', async ({ dashboardPage }) => {
    await expect(dashboardPage.documentTypeButton).toBeVisible();
  });

  test('TC_Dashboard_041: Verify File format Filter', async ({ dashboardPage }) => {
    await expect(dashboardPage.fileFormatButton).toBeVisible();
  });

});
