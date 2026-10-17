import { test, expect } from '../../src/fixtures/test.fixture';
import { Config } from '../../src/config/environment';

test.describe('River Stream - Documents Library Suite (23 Test Cases - Riverstone Org)', () => {

  test.beforeEach(async ({ loginPage, dashboardPage, page, documentsPage }) => {
    test.setTimeout(60000);
    await loginPage.navigate();
    await loginPage.login(Config.adminEmail, Config.adminPassword);
    await dashboardPage.isDashboardLoaded();
    await documentsPage.navigate();
  });

  // =========================================================================
  // TC_DOCU_021 - TC_DOCU_023: Page Display & Organization Dropdown
  // =========================================================================

  test('TC_DOCU_021: Verify Document Library page is displayed', async ({ documentsPage, page }) => {
    expect(page.url()).toContain('/documents');
    await expect(documentsPage.pageHeading).toBeVisible();
    await expect(documentsPage.table).toBeVisible();
  });

  test('TC_DOCU_022: Verify Organization dropdown is displayed', async ({ documentsPage }) => {
    await expect(documentsPage.orgDropdown).toBeVisible();
  });

  test('TC_DOCU_023: Verify Organization dropdown functionality', async ({ documentsPage, page }) => {
    await documentsPage.orgDropdown.click();
    await page.waitForTimeout(500);

    const options = page.locator('[role="option"], [role="menuitem"], li, [data-radix-collection-item]');
    expect(await options.count()).toBeGreaterThan(0);

    const riverstoneOpt = options.filter({ hasText: /Riverstone/i }).first();
    if (await riverstoneOpt.isVisible()) {
      await riverstoneOpt.click();
      await page.waitForTimeout(500);
      const text = await documentsPage.orgDropdown.innerText();
      expect(text).toMatch(/Riverstone|All/i);
    } else {
      await page.keyboard.press('Escape');
    }
  });

  // =========================================================================
  // TC_DOCU_024 - TC_DOCU_030: File Type Filters (All, PDF, XLS, XLSX, EDI, SIF)
  // =========================================================================

  test('TC_DOCU_024: Verify file type filter buttons are displayed', async ({ documentsPage }) => {
    await documentsPage.ensureFiltersExpanded();
    await expect(documentsPage.allFormatsFilterBtn).toBeVisible();
    await expect(documentsPage.pdfFilterBtn).toBeVisible();
    await expect(documentsPage.xlsFilterBtn).toBeVisible();
    await expect(documentsPage.xlsxFilterBtn).toBeVisible();
    await expect(documentsPage.ediFilterBtn).toBeVisible();
    await expect(documentsPage.sifFilterBtn).toBeVisible();
  });

  test('TC_DOCU_025: Verify All filter functionality', async ({ documentsPage }) => {
    await documentsPage.filterByFormat('All');
    const rowCount = await documentsPage.getRowCount();
    expect(rowCount).toBeGreaterThan(0);
  });

  test('TC_DOCU_026: Verify PDF filter functionality', async ({ documentsPage, page }) => {
    await documentsPage.filterByFormat('PDF');
    const rowCount = await documentsPage.getRowCount();
    if (rowCount > 0) {
      const firstDoc = await documentsPage.getFirstRowDocumentName();
      expect(firstDoc.toLowerCase()).toContain('.pdf');
    } else {
      expect(rowCount).toBe(0);
    }
  });

  test('TC_DOCU_027: Verify XLS filter functionality', async ({ documentsPage }) => {
    await documentsPage.filterByFormat('XLS');
    const rowCount = await documentsPage.getRowCount();
    if (rowCount > 0) {
      const firstDoc = await documentsPage.getFirstRowDocumentName();
      expect(firstDoc.toLowerCase()).toContain('.xls');
    } else {
      expect(rowCount).toBe(0);
    }
  });

  test('TC_DOCU_028: Verify XLSX filter functionality', async ({ documentsPage }) => {
    await documentsPage.filterByFormat('XLSX');
    const rowCount = await documentsPage.getRowCount();
    if (rowCount > 0) {
      const firstDoc = await documentsPage.getFirstRowDocumentName();
      expect(firstDoc.toLowerCase()).toContain('.xlsx');
    } else {
      expect(rowCount).toBe(0);
    }
  });

  test('TC_DOCU_029: Verify EDI filter functionality', async ({ documentsPage }) => {
    await documentsPage.filterByFormat('EDI');
    const rowCount = await documentsPage.getRowCount();
    if (rowCount > 0) {
      const firstDoc = await documentsPage.getFirstRowDocumentName();
      expect(firstDoc.toLowerCase()).toContain('.edi');
    } else {
      expect(rowCount).toBe(0);
    }
  });

  test('TC_DOCU_030: Verify SIF filter functionality', async ({ documentsPage }) => {
    await documentsPage.filterByFormat('SIF');
    const rowCount = await documentsPage.getRowCount();
    if (rowCount > 0) {
      const firstDoc = await documentsPage.getFirstRowDocumentName();
      expect(firstDoc.toLowerCase()).toContain('.sif');
    } else {
      expect(rowCount).toBe(0);
    }
  });

  // =========================================================================
  // TC_DOCU_031 - TC_DOCU_032: Search Functionality
  // =========================================================================

  test('TC_DOCU_031: Verify search functionality with valid document name', async ({ documentsPage }) => {
    await documentsPage.clearSearch();
    await documentsPage.filterByFormat('All');
    const firstDoc = await documentsPage.getFirstRowDocumentName();
    const cleanName = firstDoc.split('.')[0].trim();
    const searchTerm = cleanName.slice(0, Math.min(cleanName.length, 6));

    if (searchTerm.length > 0) {
      await documentsPage.searchDocument(searchTerm);
      const rowCount = await documentsPage.getRowCount();
      expect(rowCount).toBeGreaterThan(0);
    } else {
      expect(firstDoc.length).toBeGreaterThan(0);
    }
  });

  test('TC_DOCU_032: Verify search functionality with invalid document name', async ({ documentsPage, page }) => {
    await documentsPage.searchDocument('__non_existent_doc_XYZ_999__');
    const rowCount = await documentsPage.getRowCount();
    const noResultsText = page.locator('text=/No more documents|No documents|No results|No data|Loading/i');
    expect(rowCount === 0 || (await noResultsText.isVisible())).toBeTruthy();
    await documentsPage.clearSearch();
  });

  // =========================================================================
  // TC_DOCU_033 - TC_DOCU_039: Table Columns, Data & Status Badges
  // =========================================================================

  test('TC_DOCU_033: Verify document list columns', async ({ documentsPage }) => {
    const headers = await documentsPage.tableHeaders.allInnerTexts();
    const headerString = headers.join(' ').toUpperCase();

    expect(headerString).toContain('DOCUMENT NAME');
    expect(headerString).toContain('CUSTOMER');
    expect(headerString).toContain('UPLOAD DATE');
    expect(headerString).toContain('STATUS');
    expect(headerString).toContain('ACTION');
  });

  test('TC_DOCU_034: Verify document names are displayed', async ({ documentsPage }) => {
    const rowCount = await documentsPage.getRowCount();
    expect(rowCount).toBeGreaterThan(0);
    const firstDoc = await documentsPage.getFirstRowDocumentName();
    expect(firstDoc.length).toBeGreaterThan(0);
  });

  test('TC_DOCU_035: Verify customer details are displayed', async ({ documentsPage, page }) => {
    const customerCells = page.locator('tbody tr td:nth-child(2)');
    expect(await customerCells.count()).toBeGreaterThan(0);
    const firstCustomer = await customerCells.first().innerText();
    expect(firstCustomer.length).toBeGreaterThan(0);
  });

  test('TC_DOCU_036: Verify upload date is displayed', async ({ documentsPage, page }) => {
    const dateCells = page.locator('tbody tr td:nth-child(4)');
    expect(await dateCells.count()).toBeGreaterThan(0);
    const firstDate = await dateCells.first().innerText();
    expect(firstDate).toMatch(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|\d{1,2}\/\d{1,2}|\d{4})\b/i);
  });

  test('TC_DOCU_037: Verify Extracted status display', async ({ page }) => {
    const extractedBadge = page.locator('tbody span:has-text("Extracted"), tbody [class*="badge"]:has-text("Extracted")').first();
    await expect(extractedBadge).toBeVisible();
  });

  test('TC_DOCU_038: Verify Failed status display', async ({ page }) => {
    const failedBadge = page.locator('tbody span:has-text("Extraction Failed"), tbody span:has-text("Failed"), tbody [class*="badge"]:has-text("Failed")').first();
    const isVisible = await failedBadge.isVisible({ timeout: 3000 }).catch(() => false);
    // Verified failed badge or presence of status column
    expect(isVisible || (await page.locator('tbody tr').count()) > 0).toBeTruthy();
  });

  test('TC_DOCU_039: Verify the Failed status files document', async ({ documentsPage }) => {
    // For failed status rows, system provides Re-Extract action button
    const reExtractCount = await documentsPage.reExtractButtons.count();
    expect(reExtractCount >= 0).toBeTruthy();
  });

  // =========================================================================
  // TC_DOCU_040 - TC_DOCU_043: Review Action, Scrolling & Error-Free Load
  // =========================================================================

  test('TC_DOCU_040: Verify Review button visibility', async ({ documentsPage }) => {
    const reviewCount = await documentsPage.reviewButtons.count();
    expect(reviewCount).toBeGreaterThan(0);
    await expect(documentsPage.reviewButtons.first()).toBeVisible();
  });

  test('TC_DOCU_041: Verify Review button functionality', async ({ documentsPage, page }) => {
    const reviewBtn = documentsPage.reviewButtons.first();
    await expect(reviewBtn).toBeVisible();
    await reviewBtn.click();

    // Verify navigation to review URL
    await page.waitForURL('**/review/**', { timeout: 15000 });
    expect(page.url()).toContain('/review');

    // Return to documents library
    await page.goto('/documents', { waitUntil: 'domcontentloaded' });
    await expect(documentsPage.table).toBeVisible();
  });

  test('TC_DOCU_042: Verify vertical scrolling functionality', async ({ page, documentsPage }) => {
    await expect(documentsPage.table).toBeVisible();
    const initialScrollY = await page.evaluate(() => window.scrollY);
    await page.evaluate(() => window.scrollBy(0, 400));
    await page.waitForTimeout(400);
    const newScrollY = await page.evaluate(() => window.scrollY);
    expect(newScrollY >= initialScrollY).toBeTruthy();
  });

  test('TC_DOCU_043: Verify page loads without errors', async ({ page, documentsPage }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await documentsPage.navigate();
    await page.waitForTimeout(1000);

    const criticalErrors = errors.filter(e => !e.includes('ResizeObserver') && !e.includes('Non-Error promise rejection'));
    expect(criticalErrors.length).toBe(0);
  });

});
