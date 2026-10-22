import path from 'path';
import { test, expect } from '../../src/fixtures/test.fixture';
import { DocumentsPage, DOCUMENT_STATUSES, FileFormat, LibraryDocument } from '../../src/pages/documents.page';
import { QaData, uniqueName } from '../../src/test-data/qa-data';
import { createMockFile } from '../../src/utils/file-utils';

/**
 * Documents Library (TC_DOCU_021 - TC_DOCU_049).
 *
 * The library is shared and other suites upload concurrently, so assertions compare the table
 * with the listDocumentsLibrary API response the table was rendered from instead of fixed data.
 * Only TC_DOCU_039 creates data: one corrupted AUTO_ PDF so Re-Extract is exercised on a document
 * this suite owns (the library has no delete action, so it cannot be removed afterwards).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Text colour helpers for status badge styling checks */
const isTealOrGreen = ([r, g, b]: number[]) => g > r + 40 && g >= b - 30;
const isRed = ([r, g, b]: number[]) => r > g + 60 && r > b + 40;

test.describe('Documents Library', () => {
  // ===========================================================================
  // Page, organization selector (TC_DOCU_021 - TC_DOCU_023)
  // ===========================================================================

  test('TC_DOCU_021: Verify Document Library page is displayed', async ({ documentsPage, page }) => {
    const firstPage = await documentsPage.navigate();

    await expect(page).toHaveURL(/\/documents$/);
    await expect(documentsPage.headerTitle).toHaveText('Documents');
    await expect(documentsPage.pageHeading).toBeVisible();
    await expect(documentsPage.searchInput).toBeVisible();
    await expect(documentsPage.uploadNewFileButton).toBeVisible();
    await expect(documentsPage.filtersButton).toBeVisible();
    await expect(documentsPage.table).toBeVisible();
    expect(firstPage.documents.length).toBeGreaterThan(0);
    await expect(documentsPage.dataRows).toHaveCount(firstPage.documents.length);
  });

  test('TC_DOCU_022: Verify Organization dropdown is displayed', async ({ documentsPage }) => {
    await documentsPage.navigate();
    await expect(documentsPage.orgDropdown).toBeVisible();
    await expect(documentsPage.orgDropdown).toHaveText('All Organizations');
  });

  test('TC_DOCU_023: Verify Organization dropdown functionality', async ({ documentsPage }) => {
    const all = await documentsPage.navigate();
    expect(all.request.organizationName).toBeNull();

    const org = await documentsPage.selectOrganization(QaData.defaultOrg);

    await expect(documentsPage.orgDropdown).toHaveText(QaData.defaultOrg);
    expect(org.documents.length).toBeGreaterThan(0);
    for (const doc of org.documents) {
      expect(doc.organizationName.toLowerCase(), doc.fileName).toBe(QaData.defaultOrg.toLowerCase());
    }
    expect(org.totalCount, 'one organization must list fewer documents than all organizations').toBeLessThan(all.totalCount);
    expect(await documentsPage.getVisibleDocumentNames()).toEqual(org.documents.map(d => d.fileName));
  });

  // ===========================================================================
  // File format filters (TC_DOCU_024 - TC_DOCU_030)
  // ===========================================================================

  test('TC_DOCU_024: Verify file type filter buttons are displayed', async ({ documentsPage }) => {
    await documentsPage.navigate();
    await documentsPage.expandFilters();
    await expect(documentsPage.fileFormatHeading.locator('xpath=following-sibling::div[1]').getByRole('button'))
      .toHaveText(['All formats', 'PDF', 'XLS', 'XLSX', 'EDI', 'SIF']);
  });

  test('TC_DOCU_025: Verify All filter functionality', async ({ documentsPage }) => {
    const baseline = await documentsPage.navigate();
    const pdfOnly = await documentsPage.filterByFormat('PDF');
    expect(pdfOnly.totalCount).toBeLessThan(baseline.totalCount);

    const all = await documentsPage.filterByFormat('All formats');

    expect(all.request.fileTypeFilter ?? []).toEqual([]);
    // Other suites may upload meanwhile, so the total can only grow.
    expect(all.totalCount).toBeGreaterThanOrEqual(baseline.totalCount);
    await expect(documentsPage.formatSummary).toHaveText('Format: All');
    await expect(documentsPage.dataRows).toHaveCount(all.documents.length);
  });

  const formatCases: Array<{ id: string; format: FileFormat }> = [
    { id: 'TC_DOCU_026', format: 'PDF' },
    { id: 'TC_DOCU_027', format: 'XLS' },
    { id: 'TC_DOCU_028', format: 'XLSX' },
    { id: 'TC_DOCU_029', format: 'EDI' },
    { id: 'TC_DOCU_030', format: 'SIF' },
  ];
  for (const { id, format } of formatCases) {
    test(`${id}: Verify ${format} filter functionality`, async ({ documentsPage }) => {
      await documentsPage.navigate();
      const result = await documentsPage.filterByFormat(format);
      // Anchored so that ".xls" never accepts ".xlsx".
      const extension = new RegExp(`\\.${format}$`, 'i');

      expect(result.request.fileTypeFilter).toEqual([format]);
      expect(result.documents.length, `QA should hold ${format} documents`).toBeGreaterThan(0);
      for (const doc of result.documents) {
        expect(doc.fileName, `API returned a non-${format} document`).toMatch(extension);
      }
      const names = await documentsPage.getVisibleDocumentNames();
      expect(names).toEqual(result.documents.map(d => d.fileName));
      for (const name of names) {
        expect(name, `row shown under the ${format} filter`).toMatch(extension);
      }
      await expect(documentsPage.formatSummary).toHaveText(`Format: ${format}`);
    });
  }

  // ===========================================================================
  // Search (TC_DOCU_031 - TC_DOCU_032)
  // ===========================================================================

  test('TC_DOCU_031: Verify search functionality with valid document name', async ({ documentsPage }) => {
    const firstPage = await documentsPage.navigate();
    const target = firstPage.documents.find(d => path.parse(d.fileName).name.length >= 8);
    expect(target, 'need an existing document with a searchable name').toBeTruthy();
    const term = path.parse(target!.fileName).name;

    const result = await documentsPage.searchDocument(term);

    expect(result.request.search_text).toBe(term);
    expect(result.documents.map(d => d.fileName)).toContain(target!.fileName);
    await expect(documentsPage.rowByName(target!.fileName).first()).toBeVisible();
    const rowCount = await documentsPage.dataRows.count();
    for (let i = 0; i < rowCount; i++) {
      const row = documentsPage.dataRows.nth(i);
      const text = `${await documentsPage.nameCell(row).innerText()} ${await documentsPage.customerCell(row).innerText()}`;
      expect(text.toLowerCase(), 'every result must match the search term').toContain(term.toLowerCase());
    }
  });

  test('TC_DOCU_032: Verify search functionality with invalid document name', async ({ documentsPage }) => {
    test.info().annotations.push({
      type: 'issue',
      description: 'App defect: a search with no matches shows "No more documents to load" instead of an empty-state message.',
    });
    await documentsPage.navigate();
    const term = `AZZZZ${Date.now()}`;

    const result = await documentsPage.searchDocument(term);

    expect(result.totalCount).toBe(0);
    await expect(documentsPage.dataRows).toHaveCount(0);
    await expect(documentsPage.emptyStateMessage).toBeVisible();
  });

  // ===========================================================================
  // Columns and row content (TC_DOCU_033 - TC_DOCU_036)
  // ===========================================================================

  test('TC_DOCU_033: Verify document list columns', async ({ documentsPage }) => {
    await documentsPage.navigate();
    await expect(documentsPage.tableHeaders).toHaveText([
      /^document name$/i, /^customer$/i, /^uploaded by$/i, /^upload date$/i, /^status$/i, /^action$/i,
    ]);
  });

  test('TC_DOCU_034: Verify document names are displayed', async ({ documentsPage }) => {
    const firstPage = await documentsPage.navigate();
    const names = await documentsPage.getVisibleDocumentNames();

    expect(names.length).toBeGreaterThan(0);
    expect(names).toEqual(firstPage.documents.map(d => d.fileName));
    for (const name of names) expect(name.length).toBeGreaterThan(0);
  });

  test('TC_DOCU_035: Verify customer details are displayed', async ({ documentsPage }) => {
    const seenDocuments = documentsPage.trackListResponses();
    await documentsPage.navigate();
    await documentsPage.loadRows(60);
    const docs = await seenDocuments();

    const nameCounts = new Map<string, number>();
    docs.forEach(d => nameCounts.set(d.fileName, (nameCounts.get(d.fileName) || 0) + 1));
    const unique = docs.filter(d => nameCounts.get(d.fileName) === 1);
    const withCustomer = unique.filter(d => d.extractedData?.customer_name?.value).slice(0, 5);
    const withoutCustomer = unique.filter(d => !d.extractedData?.customer_name?.value).slice(0, 3);
    expect(withCustomer.length, 'the first 60 documents should include customer-associated documents').toBeGreaterThan(0);

    for (const doc of withCustomer) {
      const cell = documentsPage.customerCell(documentsPage.rowByName(doc.fileName));
      await expect(cell, doc.fileName).toContainText(doc.extractedData!.customer_name!.value!);
    }
    for (const doc of withoutCustomer) {
      await expect(documentsPage.customerCell(documentsPage.rowByName(doc.fileName)), doc.fileName).toHaveText('—');
    }
  });

  test('TC_DOCU_036: Verify upload date is displayed', async ({ documentsPage }) => {
    const firstPage = await documentsPage.navigate();
    const expected: string[] = [];
    for (const doc of firstPage.documents) expected.push(await documentsPage.formatUploadDate(doc.createdAt));

    const dates = await documentsPage.getVisibleUploadDates();
    expect(dates).toEqual(expected);
    for (const date of dates) expect(date).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/);
  });

  // ===========================================================================
  // Statuses and Re-Extract (TC_DOCU_037 - TC_DOCU_039)
  // ===========================================================================

  test('TC_DOCU_037: Verify Extracted status display', async ({ documentsPage, page }) => {
    await documentsPage.navigate();
    const extractedRows = documentsPage.dataRows.filter({ has: page.locator('td:nth-child(5)', { hasText: /^Extracted$/ }) });
    expect(await documentsPage.scrollUntilVisible(extractedRows), 'no Extracted document found').toBe(true);

    const badge = documentsPage.statusBadge(extractedRows.first());
    await expect(badge).toHaveText('Extracted');
    await expect(badge.locator('svg')).toHaveCount(1);
    const color = await documentsPage.textColorRgb(badge);
    expect(isTealOrGreen(color), `Extracted badge colour rgb(${color}) should be teal/green`).toBe(true);
  });

  test('TC_DOCU_038: Verify Failed status display', async ({ documentsPage, page }) => {
    test.setTimeout(150000);
    await documentsPage.navigate();
    // "Failed" (ERP/quotation insertion failed) comes from SIF quote requests, so narrow the list first.
    await documentsPage.filterByFormat('SIF');
    const failedRows = documentsPage.dataRows.filter({ has: page.locator('td:nth-child(5)', { hasText: /^Failed$/ }) });
    const found = await documentsPage.scrollUntilVisible(failedRows);
    test.skip(!found, 'No document with status "Failed" exists in QA and the UI offers no way to create one on demand');

    const row = failedRows.first();
    const badge = documentsPage.statusBadge(row);
    await expect(badge).toHaveText('Failed');
    await expect(badge.locator('svg')).toHaveCount(1);
    const color = await documentsPage.textColorRgb(badge);
    expect(isRed(color), `Failed badge colour rgb(${color}) should be red`).toBe(true);
    // An insertion failure is reviewed, not re-extracted.
    await expect(documentsPage.reviewButton(row)).toBeVisible();
    await expect(documentsPage.reExtractButton(row)).toHaveCount(0);
  });

  test('TC_DOCU_039: Verify the Failed status files document', async ({ uploadPage, documentsPage, page }) => {
    test.setTimeout(240000);
    // Precondition: an extraction-failed document owned by this suite (corrupted PDF).
    const name = `${uniqueName('DOCU039_Corrupt')}.pdf`;
    const file = createMockFile(name, '%PDF-1.4\n1 0 obj << /Type /Catalog >> garbage\n%%EOF_CORRUPTED', test.info().outputPath());
    await uploadPage.navigate('documents');
    await uploadPage.uploadDocument(file, 'Purchase Order', 'documents');

    const row = documentsPage.rowByName(name);
    await expect(async () => {
      await documentsPage.navigate();
      await documentsPage.searchDocument(name);
      await expect(documentsPage.statusBadge(row)).toHaveText('Extraction Failed', { timeout: 5000 });
    }).toPass({ timeout: 150000, intervals: [5000] });

    const color = await documentsPage.textColorRgb(documentsPage.statusBadge(row));
    expect(isRed(color), `Extraction Failed badge colour rgb(${color}) should be red`).toBe(true);
    await expect(documentsPage.reExtractButton(row)).toBeEnabled();
    await expect(documentsPage.reviewButton(row)).toHaveCount(0);

    const reExtract = page.waitForResponse(r => r.url().includes('/api/reUploadDocument') && r.request().method() === 'POST');
    await documentsPage.reExtractButton(row).click();
    const response = await reExtract;

    expect(response.status()).toBe(200);
    expect(response.request().postDataJSON().fileName).toBe(name);
    expect((await response.json()).status).toBe('processing');
    await expect(documentsPage.statusBadge(row)).toHaveText('Processing');
  });

  // ===========================================================================
  // Actions, scrolling, console errors (TC_DOCU_040 - TC_DOCU_043)
  // ===========================================================================

  test('TC_DOCU_040: Verify Review button visibility', async ({ documentsPage }) => {
    await documentsPage.navigate();
    await documentsPage.loadRows(45);
    const rows = await documentsPage.getRowStatusesAndActions();

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      // Extraction failures are re-extracted; every other document is reviewed.
      const expectedAction = row.status === 'Extraction Failed' ? 'Re-Extract' : 'Review';
      expect(row.action, `${row.name} (${row.status})`).toBe(expectedAction);
    }
  });

  test('TC_DOCU_041: Verify Review button functionality', async ({ documentsPage, page }) => {
    const firstPage = await documentsPage.navigate();
    const counts = new Map<string, number>();
    firstPage.documents.forEach(d => counts.set(d.fileName, (counts.get(d.fileName) || 0) + 1));
    const target = firstPage.documents.find(d => d.status !== 'failed' && counts.get(d.fileName) === 1);
    expect(target, 'need a reviewable document on the first page').toBeTruthy();

    await documentsPage.reviewButton(documentsPage.rowByName(target!.fileName)).click();

    await expect(page).toHaveURL(new RegExp(`/review/${target!._id}$`));
    await expect(page.getByRole('button', { name: 'Back to Documents' })).toBeVisible();
  });

  test('TC_DOCU_042: Verify vertical scrolling functionality', async ({ documentsPage }) => {
    test.setTimeout(180000);
    const firstPage = await documentsPage.navigate();
    expect(firstPage.hasMore, 'QA must hold more documents than one page').toBe(true);
    const initialRows = await documentsPage.dataRows.count();

    await documentsPage.loadRows(initialRows + 1);
    expect(await documentsPage.dataRows.count(), 'scrolling should load the next page').toBeGreaterThan(initialRows);

    const finalRows = await documentsPage.scrollToEnd(150000);
    await expect(documentsPage.noMoreDocumentsText).toBeVisible();
    // Concurrent uploads only add rows, so every document counted at load time must be reachable.
    expect(finalRows).toBeGreaterThanOrEqual(firstPage.totalCount);
  });

  test('TC_DOCU_043: Verify page loads without errors', async ({ documentsPage }) => {
    // Listener attached before navigation so errors during the initial load are captured.
    const errors = documentsPage.trackPageErrors();
    await documentsPage.navigate();
    await documentsPage.expandFilters();
    await documentsPage.loadRows(25);

    expect(errors).toEqual([]);
  });

  // ===========================================================================
  // Additional filters and row details (TC_DOCU_044 - TC_DOCU_049)
  // ===========================================================================

  test('TC_DOCU_044: Verify Document Type filter functionality', async ({ documentsPage }) => {
    const baseline = await documentsPage.navigate();

    const quotes = await documentsPage.filterByDocumentType('Quote request');
    expect(quotes.request.docTypeFilter).toEqual(['QUOTE_REQUEST']);
    expect(quotes.documents.length).toBeGreaterThan(0);
    for (const doc of quotes.documents) expect(doc.selectedDocType, doc.fileName).toBe('QUOTE_REQUEST');
    expect(quotes.totalCount).toBeLessThan(baseline.totalCount);
    await expect(documentsPage.typeSummary).toHaveText('Type: Quote request');
    expect(await documentsPage.getVisibleDocumentNames()).toEqual(quotes.documents.map(d => d.fileName));

    await documentsPage.clearAllFilters();
    const orders = await documentsPage.filterByDocumentType('Purchase order');
    expect(orders.request.docTypeFilter).toEqual(['PURCHASE_ORDER']);
    expect(orders.documents.length).toBeGreaterThan(0);
    for (const doc of orders.documents) expect(doc.selectedDocType, doc.fileName).toBe('PURCHASE_ORDER');
    await expect(documentsPage.typeSummary).toHaveText('Type: Purchase order');
  });

  test('TC_DOCU_045: Verify Upload Date calendar filter', async ({ documentsPage }) => {
    const baseline = await documentsPage.navigate();
    const to = startOfLocalDay(new Date(baseline.documents[0].createdAt));
    const from = new Date(to.getTime() - DAY_MS);
    const fromLabel = await documentsPage.formatUploadDate(from.toISOString());
    const toLabel = await documentsPage.formatUploadDate(to.toISOString());

    await documentsPage.selectDateRange(from, to);
    await expect(documentsPage.dateRangeButton).toHaveText(`${fromLabel} – ${toLabel}`);
    const result = await documentsPage.applyFilters(req => !!req.createdFrom);

    expect(new Date(result.request.createdFrom!).getTime()).toBe(from.getTime());
    expect(new Date(result.request.createdBefore!).getTime()).toBe(to.getTime() + DAY_MS);
    expect(result.documents.length).toBeGreaterThan(0);
    expect(result.totalCount).toBeLessThan(baseline.totalCount);
    for (const doc of result.documents) {
      const created = new Date(doc.createdAt).getTime();
      expect(created, doc.fileName).toBeGreaterThanOrEqual(from.getTime());
      expect(created, doc.fileName).toBeLessThan(to.getTime() + DAY_MS);
    }
    for (const date of await documentsPage.getVisibleUploadDates()) expect([fromLabel, toLabel]).toContain(date);
    await expect(documentsPage.dateSummary).toHaveText(`Date: ${fromLabel} – ${toLabel}`);
  });

  test('TC_DOCU_046: Verify filter summary and active-filter badge', async ({ documentsPage }) => {
    await documentsPage.navigate();
    await expect(documentsPage.activeFilterBadge).toHaveCount(0);
    await expect(documentsPage.formatSummary).toHaveText('Format: All');
    await expect(documentsPage.typeSummary).toHaveText('Type: All types');
    await expect(documentsPage.dateSummary).toHaveText('Date: Any time');

    await documentsPage.expandFilters();
    await expect(documentsPage.applyFiltersBtn).toBeDisabled();
    await documentsPage.formatButton('PDF').click();
    await documentsPage.documentTypeButton('Purchase order').click();
    // The summary reflects applied filters only.
    await expect(documentsPage.formatSummary).toHaveText('Format: All');
    await expect(documentsPage.applyFiltersBtn).toBeEnabled();

    await documentsPage.applyFilters(req => !!req.fileTypeFilter?.length && !!req.docTypeFilter?.length);

    await expect(documentsPage.formatSummary).toHaveText('Format: PDF');
    await expect(documentsPage.typeSummary).toHaveText('Type: Purchase order');
    await expect(documentsPage.dateSummary).toHaveText('Date: Any time');
    await expect(documentsPage.activeFilterBadge).toHaveText('2');
  });

  test('TC_DOCU_047: Verify Clear all filters resets the library', async ({ documentsPage }) => {
    const baseline = await documentsPage.navigate();
    await documentsPage.expandFilters();
    await expect(documentsPage.clearFiltersBtn).toBeDisabled();
    const filtered = await documentsPage.filterByFormat('XLS');
    expect(filtered.totalCount).toBeLessThan(baseline.totalCount);
    await expect(documentsPage.activeFilterBadge).toHaveText('1');

    const cleared = await documentsPage.clearAllFilters();

    expect(cleared.request.fileTypeFilter ?? []).toEqual([]);
    expect(cleared.request.docTypeFilter ?? []).toEqual([]);
    expect(cleared.request.createdFrom).toBeUndefined();
    expect(cleared.totalCount).toBeGreaterThanOrEqual(baseline.totalCount);
    await expect(documentsPage.activeFilterBadge).toHaveCount(0);
    await expect(documentsPage.formatSummary).toHaveText('Format: All');
    await expect(documentsPage.typeSummary).toHaveText('Type: All types');
    await expect(documentsPage.dateSummary).toHaveText('Date: Any time');
    await expect(documentsPage.clearFiltersBtn).toBeDisabled();
    await expect(documentsPage.applyFiltersBtn).toBeDisabled();
  });

  test('TC_DOCU_048: Verify Uploaded By hover card shows uploader details', async ({ documentsPage }) => {
    const firstPage = await documentsPage.navigate();
    const doc = firstPage.documents[0];
    const row = documentsPage.dataRows.first();
    await expect(documentsPage.nameCell(row)).toHaveText(doc.fileName);
    await expect(documentsPage.uploadedByTrigger(row)).toHaveText(doc.userName);

    await documentsPage.uploadedByTrigger(row).hover();

    await expect(documentsPage.uploadedByHoverCard).toBeVisible();
    await expect(documentsPage.uploadedByHoverCard).toContainText(doc.userName);
    await expect(documentsPage.uploadedByHoverCard).toContainText(doc.userEmail);
  });

  test('TC_DOCU_049: Verify document insertion statuses use the documented labels', async ({ documentsPage }) => {
    const seenDocuments = documentsPage.trackListResponses();
    await documentsPage.navigate();
    await documentsPage.loadRows(60);
    const statuses = await documentsPage.getVisibleStatuses();
    const docs: LibraryDocument[] = await seenDocuments();

    expect(statuses.length).toBeGreaterThan(0);
    for (const status of statuses) {
      expect(DOCUMENT_STATUSES as readonly string[], `unexpected status label "${status}"`).toContain(status);
    }
    // Raw extraction failures must surface as "Extraction Failed" (the only re-extractable state).
    const rawFailed = docs.filter(d => d.status === 'failed');
    for (const doc of rawFailed.slice(0, 5)) {
      await expect(documentsPage.statusBadge(documentsPage.rowByName(doc.fileName).first()), doc.fileName).toHaveText('Extraction Failed');
    }
  });
});
