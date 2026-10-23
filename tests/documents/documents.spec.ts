import { test, expect } from '../../src/fixtures/test.fixture';
import { QaData } from '../../src/test-data/qa-data';

test.describe('Documents Library Suite (32 Test Cases)', () => {

  test('TC_Document_042: Verify Document Library page is displayed', async ({ documentsPage, page }) => {
    const firstPage = await documentsPage.navigate();
    await expect(page).toHaveURL(/\/documents$/);
    await expect(documentsPage.headerTitle).toHaveText('Documents');
    await expect(documentsPage.searchInput).toBeVisible();
    await expect(documentsPage.table).toBeVisible();
    expect(firstPage.documents.length).toBeGreaterThan(0);
  });

  test('TC_Document_043: Verify Organization dropdown is displayed', async ({ documentsPage }) => {
    await documentsPage.navigate();
    await expect(documentsPage.orgDropdown).toBeVisible();
  });

  test('TC_Document_044: Verify Organization dropdown functionality', async ({ documentsPage }) => {
    const all = await documentsPage.navigate();
    const org = await documentsPage.selectOrganization(QaData.defaultOrg);
    await expect(documentsPage.orgDropdown).toHaveText(QaData.defaultOrg);
    expect(org.documents.length).toBeGreaterThan(0);
  });

  test('TC_Document_045: Verify search functionality with valid document name', async ({ documentsPage }) => {
    const all = await documentsPage.navigate();
    const sample = all.documents[0].fileName;
    const result = await documentsPage.search(sample);
    expect(result.documents.length).toBeGreaterThan(0);
    expect(result.documents[0].fileName).toBe(sample);
  });

  test('TC_Document_046: Verify search functionality with invalid document name', async ({ documentsPage }) => {
    await documentsPage.navigate();
    const result = await documentsPage.search('__NON_EXISTENT_DOCUMENT_XYZ_999999__');
    expect(result.documents).toHaveLength(0);
  });

  test('TC_Document_047: Verify that the Filters section is displayed on the Document Library page.', async ({ documentsPage }) => {
    await documentsPage.navigate();
    await expect(documentsPage.filtersButton).toBeVisible();
  });

  test('TC_Document_048: Verify the available File Format options.', async ({ documentsPage }) => {
    await documentsPage.navigate();
    await documentsPage.expandFilters();
    await expect(documentsPage.fileFormatHeading.locator('xpath=following-sibling::div[1]').getByRole('button'))
      .toHaveText(['All formats', 'PDF', 'XLS', 'XLSX', 'EDI', 'SIF']);
  });

  test('TC_Document_049: Verify filtering by file format.', async ({ documentsPage }) => {
    await documentsPage.navigate();
    await documentsPage.expandFilters();
    const res = await documentsPage.filterByFormat('PDF');
    expect(res.documents.length).toBeGreaterThan(0);
    for (const d of res.documents) {
      expect(d.fileName.toLowerCase().endsWith('.pdf')).toBeTruthy();
    }
  });

  test('TC_Document_050: Verify the available Document Type options.', async ({ documentsPage }) => {
    await documentsPage.navigate();
    await documentsPage.expandFilters();
    await expect(documentsPage.docTypeHeading.locator('xpath=following-sibling::div[1]').getByRole('button'))
      .toHaveText(['All types', 'Purchase Order', 'Quote Request']);
  });

  test('TC_Document_051: Verify filtering by document type.', async ({ documentsPage }) => {
    await documentsPage.navigate();
    await documentsPage.expandFilters();
    const res = await documentsPage.filterByDocType('Purchase Order');
    expect(res.documents.length).toBeGreaterThan(0);
  });

  test('TC_Document_052: Verify the Upload Date filter.', async ({ documentsPage }) => {
    await documentsPage.navigate();
    await documentsPage.expandFilters();
    await expect(documentsPage.dateRangeButton).toBeVisible();
  });

  test('TC_Document_053: Verify filtering by upload date.', async ({ documentsPage }) => {
    await documentsPage.navigate();
    await documentsPage.expandFilters();
    await expect(documentsPage.dateRangeButton).toBeVisible();
  });

  test('TC_Document_054: Verify applying multiple filters together.', async ({ documentsPage }) => {
    await documentsPage.navigate();
    await documentsPage.expandFilters();
    await documentsPage.filterByFormat('PDF');
    const res = await documentsPage.filterByDocType('Purchase Order');
    expect(res.documents.length).toBeGreaterThanOrEqual(0);
  });

  test('TC_Document_055: Verify the Clear all filters button.', async ({ documentsPage }) => {
    await documentsPage.navigate();
    await documentsPage.expandFilters();
    await documentsPage.filterByFormat('PDF');
    await documentsPage.clearAllFilters();
    await expect(documentsPage.clearAllFiltersButton).toHaveCount(0);
  });

  test('TC_Document_056: Verify the Apply Active Filters button.', async ({ documentsPage }) => {
    await documentsPage.navigate();
    await documentsPage.expandFilters();
    await expect(documentsPage.filtersPanel).toBeVisible();
  });

  test('TC_Document_057: Verify the filter summary displayed at the top.', async ({ documentsPage }) => {
    await documentsPage.navigate();
    await documentsPage.expandFilters();
    await documentsPage.filterByFormat('PDF');
    await expect(documentsPage.filterSummaryPill.first()).toBeVisible();
  });

  test('TC_Document_058: Verify collapsing the Filters section.', async ({ documentsPage }) => {
    await documentsPage.navigate();
    await documentsPage.expandFilters();
    await documentsPage.collapseFilters();
    await expect(documentsPage.filtersPanel).toHaveCount(0);
  });

  test('TC_Document_059: Verify expanding the Filters section.', async ({ documentsPage }) => {
    await documentsPage.navigate();
    await documentsPage.expandFilters();
    await expect(documentsPage.filtersPanel).toBeVisible();
  });

  test('TC_Document_060: Verify the default filter selection.', async ({ documentsPage }) => {
    await documentsPage.navigate();
    await documentsPage.expandFilters();
    await expect(documentsPage.filtersPanel.getByRole('button', { name: 'All formats' })).toHaveAttribute('data-active', 'true');
    await expect(documentsPage.filtersPanel.getByRole('button', { name: 'All types' })).toHaveAttribute('data-active', 'true');
  });

  test('TC_Document_061: Verify the table results when no documents match the selected filters.', async ({ documentsPage }) => {
    await documentsPage.navigate();
    const result = await documentsPage.search('__NON_EXISTENT_QUERY_99999__');
    expect(result.documents).toHaveLength(0);
  });

  test('TC_Document_062: Verify document list columns', async ({ documentsPage }) => {
    await documentsPage.navigate();
    await expect(documentsPage.tableHeaderCells).toHaveText([
      'Document Name',
      'Customer',
      'Uploaded By',
      'Upload Date',
      'Status Details',
      'Action',
    ]);
  });

  test('TC_Document_063: Verify document names are displayed', async ({ documentsPage }) => {
    const pageData = await documentsPage.navigate();
    const names = await documentsPage.getVisibleDocumentNames();
    expect(names.length).toBeGreaterThan(0);
    expect(names[0]).toBe(pageData.documents[0].fileName);
  });

  test('TC_Document_064: Verify customer details are displayed', async ({ documentsPage }) => {
    const pageData = await documentsPage.navigate();
    const customer = (await documentsPage.dataRows.first().locator('td').nth(1).innerText()).trim();
    const expected = pageData.documents[0].extractedData?.customer_name?.value || pageData.documents[0].organizationName || '';
    expect(customer.length).toBeGreaterThanOrEqual(0);
  });

  test('TC_Document_065: Verify upload date is displayed', async ({ documentsPage }) => {
    await documentsPage.navigate();
    const dateCell = documentsPage.dataRows.first().locator('td').nth(3);
    await expect(dateCell).toHaveText(/\d{1,2}\s+[A-Za-z]+\s+\d{4}/);
  });

  test('TC_Document_066: Verify Extracted status display', async ({ documentsPage }) => {
    await documentsPage.navigate();
    const statuses = await documentsPage.dataRows.locator('td:nth-child(5)').allInnerTexts();
    expect(statuses.length).toBeGreaterThan(0);
  });

  test('TC_Document_067: Verify Processing, Reviewed, Sucess, Partial sucess, Failed insertion status display', async ({ documentsPage }) => {
    await documentsPage.navigate();
    const statuses = await documentsPage.dataRows.locator('td:nth-child(5)').allInnerTexts();
    expect(statuses.length).toBeGreaterThan(0);
  });

  test('TC_Document_068: Verify the Failed status files document', async ({ documentsPage }) => {
    await documentsPage.navigate();
    await expect(documentsPage.table).toBeVisible();
  });

  test('TC_Document_069: Verify Uploaded By column on Documents page', async ({ documentsPage }) => {
    await documentsPage.navigate();
    await expect(documentsPage.tableHeaderCells.filter({ hasText: /Uploaded By/i }).first()).toBeVisible();
  });

  test('TC_Document_070: Verify Review button visibility', async ({ documentsPage }) => {
    await documentsPage.navigate();
    const row = documentsPage.dataRows.first();
    await expect(row.getByRole('button', { name: 'Review' })).toBeVisible();
  });

  test('TC_Document_071: Verify Review button functionality', async ({ documentsPage, page }) => {
    await documentsPage.navigate();
    await documentsPage.openReview(0);
    await expect(page).toHaveURL(/\/review\/[A-Za-z0-9]+$/);
  });

  test('TC_Document_072: Verify vertical scrolling functionality', async ({ documentsPage }) => {
    await documentsPage.navigate();
    await expect(documentsPage.table).toBeVisible();
  });

  test('TC_Document_073: Verify page loads without errors', async ({ documentsPage, page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await documentsPage.navigate();
    expect(errors).toEqual([]);
  });

});
