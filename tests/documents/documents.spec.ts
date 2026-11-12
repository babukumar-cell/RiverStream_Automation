import { Page } from '@playwright/test';
import { test, expect } from '../../src/fixtures/test.fixture';
import { QaData } from '../../src/test-data/qa-data';
import { DOCUMENT_STATUSES } from '../../src/pages/documents.page';

/** A search term that cannot match any document name. */
const NO_MATCH_TERM = 'AZZZZ_NO_MATCH_99999';

/** Attaches a named screenshot of the current viewport (with any highlights) to the report. */
/** Removes highlight boxes drawn by earlier assertions, so the next screenshot shows only the new ones. */
async function clearHighlights(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelectorAll<HTMLElement>('[data-rs-tested]').forEach(el => {
      el.style.outline = '';
      el.style.outlineOffset = '';
      el.style.boxShadow = '';
      el.removeAttribute('data-rs-tested');
    });
  });
}

async function attachEvidence(page: Page, name: string): Promise<void> {
  const file = test.info().outputPath(`${name.replace(/[^\w-]+/g, '_')}.png`);
  await page.screenshot({ path: file });
  await test.info().attach(name, { path: file, contentType: 'image/png' });
}

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
    // A default value must be selected (e.g. "All Organizations")
    await expect(documentsPage.orgDropdown).toHaveText(/\S/);
  });

  test('TC_Document_044: Verify Organization dropdown functionality', async ({ documentsPage }) => {
    await documentsPage.navigate();
    const org = await documentsPage.selectOrganization(QaData.defaultOrg);
    await expect(documentsPage.orgDropdown).toHaveText(QaData.defaultOrg);
    // The list must refresh to only that organization's documents
    expect(org.documents.length).toBeGreaterThan(0);
    for (const d of org.documents) {
      expect(d.organizationName.toLowerCase(), `${d.fileName} organization`).toBe(QaData.defaultOrg.toLowerCase());
    }
  });

  test('TC_Document_045: Verify search functionality with valid document name', async ({ documentsPage }) => {
    const all = await documentsPage.navigate();
    const sample = all.documents[0].fileName;
    const result = await documentsPage.search(sample);
    expect(result.documents.map(d => d.fileName), 'search results').toContain(sample);
    await expect(documentsPage.rowByName(sample).first()).toBeVisible();
  });

  test('TC_Document_046: Verify search functionality with invalid document name', async ({ documentsPage }) => {
    await documentsPage.navigate();
    const result = await documentsPage.search(NO_MATCH_TERM);
    expect(result.documents).toHaveLength(0);
    // Nothing may be rendered in the table either
    await expect(documentsPage.dataRows).toHaveCount(0);
  });

  test('TC_Document_047: Verify that the Filters section is displayed on the Document Library page.', async ({ documentsPage }) => {
    await documentsPage.navigate();
    await expect(documentsPage.filtersButton).toBeVisible();
    await expect(documentsPage.formatSummary).toBeVisible();
    await expect(documentsPage.typeSummary).toBeVisible();
    await expect(documentsPage.dateSummary).toBeVisible();
  });

  test('TC_Document_048: Verify the available File Format options.', async ({ documentsPage }) => {
    await documentsPage.navigate();
    await documentsPage.expandFilters();
    await expect(documentsPage.fileFormatSection).toBeVisible();
    await expect(documentsPage.fileFormatHeading.locator('xpath=following-sibling::div[1]').getByRole('button'))
      .toHaveText(['All formats', 'PDF', 'XLS', 'XLSX', 'EDI', 'SIF']);
  });

  test('TC_Document_049: Verify filtering by file format.', async ({ documentsPage }) => {
    await documentsPage.navigate();
    const res = await documentsPage.filterByFormat('PDF');
    expect(res.request.fileTypeFilter).toEqual(['PDF']);
    expect(res.documents.length).toBeGreaterThan(0);
    for (const d of res.documents) {
      expect(d.fileName.toLowerCase(), 'API result').toMatch(/\.pdf$/);
    }
    // Only PDF documents may be shown in the table
    for (const name of await documentsPage.getVisibleDocumentNames()) {
      expect(name.toLowerCase(), 'table row').toMatch(/\.pdf$/);
    }

    // Evidence: re-open the panel (Apply collapses it) so the selected format is on screen and highlighted
    await expect(documentsPage.formatSummary).toHaveText(/Format:\s*PDF/i);
    await documentsPage.expandFilters();
    await expect(documentsPage.formatButton('PDF')).toHaveClass(/bg-blue-600/);
    await expect(documentsPage.formatButton('PDF')).toBeInViewport();
  });

  test('TC_Document_050: Verify the available Document Type options.', async ({ documentsPage }) => {
    await documentsPage.navigate();
    await documentsPage.expandFilters();
    await expect(documentsPage.docTypeSection).toBeVisible();
    await expect(documentsPage.docTypeHeading.locator('xpath=following-sibling::div[1]').getByRole('button'))
      .toHaveText(['All document types', 'Purchase order', 'Quote request']);
  });

  test('TC_Document_051: Verify filtering by document type.', async ({ documentsPage }) => {
    await documentsPage.navigate();
    const res = await documentsPage.filterByDocType('Purchase Order');
    expect(res.request.docTypeFilter).toEqual(['PURCHASE_ORDER']);
    expect(res.documents.length).toBeGreaterThan(0);
    for (const d of res.documents) {
      expect(d.selectedDocType, `${d.fileName} document type`).toBe('PURCHASE_ORDER');
    }

    // Evidence: re-open the panel (Apply collapses it) so the selected type is on screen and highlighted
    await expect(documentsPage.typeSummary).toHaveText(/Type:\s*Purchase order/i);
    await documentsPage.expandFilters();
    await expect(documentsPage.documentTypeButton('Purchase order')).toHaveClass(/bg-blue-600/);
    await expect(documentsPage.documentTypeButton('Purchase order')).toBeInViewport();
  });

  test('TC_Document_052: Verify the Upload Date filter.', async ({ documentsPage }) => {
    await documentsPage.navigate();
    await documentsPage.expandFilters();
    await expect(documentsPage.uploadDateSection).toBeVisible();
    await expect(documentsPage.dateRangeButton).toBeVisible();
    // The date button must open the calendar
    await documentsPage.dateRangeButton.click();
    await expect(documentsPage.calendar).toBeVisible();
  });

  test('TC_Document_053: Verify filtering by upload date.', async ({ documentsPage }) => {
    await documentsPage.navigate();
    const to = new Date();
    const from = new Date(to.getFullYear(), to.getMonth(), to.getDate() - 7);
    await documentsPage.selectDateRange(from, to);
    const res = await documentsPage.applyFilters(req => !!req.createdFrom);

    expect(res.request.createdFrom, 'date filter sent to the API').toBeTruthy();
    expect(res.documents.length, 'documents uploaded in the last 7 days').toBeGreaterThan(0);
    const start = new Date(res.request.createdFrom!).getTime();
    const end = res.request.createdBefore ? new Date(res.request.createdBefore).getTime() : Infinity;
    for (const d of res.documents) {
      const created = new Date(d.createdAt).getTime();
      expect(created >= start && created < end, `${d.fileName} uploaded ${d.createdAt} is inside the range`).toBe(true);
    }
    await expect(documentsPage.dateSummary).not.toHaveText(/Any time/i);

    // Evidence: re-open the panel (Apply collapses it) so the selected date range is on screen and highlighted
    await expect(documentsPage.dateSummary, 'summary shows the selected dates').toHaveText(/^Date:.*\d/);
    await documentsPage.expandFilters();
    await expect(documentsPage.dateRangeButton, 'date filter shows the selected range').toHaveText(/\d/);
    await expect(documentsPage.dateRangeButton).toBeInViewport();
  });

  test('TC_Document_054: Verify applying multiple filters together.', async ({ documentsPage }) => {
    await documentsPage.navigate();
    await documentsPage.filterByFormat('PDF');
    const res = await documentsPage.filterByDocType('Purchase Order');
    // Both filters must be sent together, and every result must satisfy both
    expect(res.request.fileTypeFilter).toEqual(['PDF']);
    expect(res.request.docTypeFilter).toEqual(['PURCHASE_ORDER']);
    expect(res.documents.length).toBeGreaterThan(0);
    for (const d of res.documents) {
      expect(d.fileName.toLowerCase(), `${d.fileName} format`).toMatch(/\.pdf$/);
      expect(d.selectedDocType, `${d.fileName} document type`).toBe('PURCHASE_ORDER');
    }
    await expect(documentsPage.formatSummary).toHaveText(/PDF/);
    await expect(documentsPage.typeSummary).toHaveText(/Purchase/i);
  });

  test('TC_Document_055: Verify the Clear all filters button.', async ({ documentsPage }) => {
    await documentsPage.navigate();
    await documentsPage.filterByFormat('PDF');
    const result = await documentsPage.clearAllFilters();
    expect(result.request.fileTypeFilter ?? []).toHaveLength(0);
    expect(result.request.docTypeFilter ?? []).toHaveLength(0);
    expect(result.request.createdFrom).toBeFalsy();
    await expect(documentsPage.formatSummary).toHaveText(/Format:\s*All/);
    await expect(documentsPage.allFormatsFilterBtn).toHaveClass(/bg-blue-600/);
  });

  test('TC_Document_056: Verify the Apply Active Filters button.', async ({ documentsPage }) => {
    await documentsPage.navigate();
    await documentsPage.expandFilters();
    // Apply stays disabled until a filter selection is changed
    await expect(documentsPage.applyFiltersBtn).toBeDisabled();
    await documentsPage.formatButton('PDF').click();
    await expect(documentsPage.applyFiltersBtn).toBeEnabled();
    // Apply must send the selected filter and refresh the list
    const res = await documentsPage.applyFilters(req => !!req.fileTypeFilter?.includes('PDF'));
    expect(res.request.fileTypeFilter).toEqual(['PDF']);
    await expect(documentsPage.formatSummary).toHaveText(/PDF/);
  });

  test('TC_Document_057: Verify the filter summary displayed at the top.', async ({ documentsPage }) => {
    await documentsPage.navigate();
    await expect(documentsPage.formatSummary).toHaveText(/Format:\s*All/);
    await documentsPage.filterByFormat('PDF');
    await expect(documentsPage.formatSummary).toHaveText(/Format:\s*PDF/);
    await expect(documentsPage.typeSummary).toBeVisible();
    await expect(documentsPage.dateSummary).toBeVisible();
    // Active filter count badge on the Filters button
    await expect(documentsPage.filterSummaryPill).toHaveText('1');
  });

  test('TC_Document_058: Verify collapsing the Filters section.', async ({ documentsPage }) => {
    await documentsPage.navigate();
    await documentsPage.expandFilters();
    await documentsPage.collapseFilters();
    await expect(documentsPage.filtersPanel).toHaveCount(0);
  });

  test('TC_Document_059: Verify expanding the Filters section.', async ({ documentsPage }) => {
    await documentsPage.navigate();
    await expect(documentsPage.expandFiltersButton.or(documentsPage.collapseFiltersButton)).toBeVisible();
    if (await documentsPage.collapseFiltersButton.isVisible()) {
      await documentsPage.collapseFilters();
    }
    await documentsPage.expandFiltersButton.click();
    await expect(documentsPage.filtersPanel).toBeVisible();
    await expect(documentsPage.fileFormatHeading).toBeVisible();
    await expect(documentsPage.docTypeHeading).toBeVisible();
    await expect(documentsPage.collapseFiltersButton).toBeVisible();
  });

  test('TC_Document_060: Verify the default filter selection.', async ({ documentsPage }) => {
    await documentsPage.navigate();
    await documentsPage.expandFilters();
    await expect(documentsPage.filtersPanel.getByRole('button', { name: 'All formats' })).toHaveClass(/bg-blue-600/);
    await expect(documentsPage.filtersPanel.getByRole('button', { name: 'All document types' })).toHaveClass(/bg-blue-600/);
  });

  test('TC_Document_061: Verify the table results when no documents match the selected filters.', async ({ documentsPage }) => {
    await documentsPage.navigate();
    await documentsPage.filterByFormat('XLSX');
    const result = await documentsPage.search(NO_MATCH_TERM);
    // Filter is still active alongside the search, and nothing matches
    expect(result.request.fileTypeFilter).toEqual(['XLSX']);
    expect(result.documents).toHaveLength(0);
    await expect(documentsPage.dataRows).toHaveCount(0);

    // Evidence: open the panel so the selected XLSX filter, the search text and the empty table are all on screen
    await documentsPage.expandFilters();
    await expect(documentsPage.formatButton('XLSX')).toHaveClass(/bg-blue-600/);
    await expect(documentsPage.formatSummary).toHaveText(/Format:\s*XLSX/);
    await expect(documentsPage.searchInput).toHaveValue(NO_MATCH_TERM);
    await expect(documentsPage.noMoreDocumentsText.or(documentsPage.emptyStateMessage).first()).toBeVisible();
  });

  test('TC_Document_062: Verify document list columns', async ({ documentsPage }) => {
    await documentsPage.navigate();
    await expect(documentsPage.tableHeaderCells).toHaveText([
      'Document Name',
      'Customer',
      'Uploaded By',
      'Upload Date',
      'Status',
      'Action',
    ]);
  });

  test('TC_Document_063: Verify document names are displayed', async ({ documentsPage }) => {
    const pageData = await documentsPage.navigate();
    expect(pageData.documents.length).toBeGreaterThan(0);
    // Each rendered row shows the file name returned by the API, in the same order.
    // toHaveText normalises whitespace (HTML collapses repeated spaces) and highlights every name cell.
    await expect(documentsPage.dataRows.locator('td:nth-child(1)'))
      .toHaveText(pageData.documents.map(d => d.fileName.replace(/\s+/g, ' ').trim()));
  });

  test('TC_Document_064: Verify customer details are displayed', async ({ documentsPage }) => {
    const pageData = await documentsPage.navigate();
    // The table shows the reviewer-corrected customer (user_value) when present, else the extracted value,
    // with the organization underneath; documents without a customer show "—".
    const expected = pageData.documents.map(d => {
      const c = d.extractedData?.customer_name;
      return (c?.user_value || c?.value || '').trim();
    });
    expect(expected.filter(Boolean).length, 'documents on the first page with a customer').toBeGreaterThan(0);
    for (let i = 0; i < expected.length; i++) {
      const cell = documentsPage.customerCell(documentsPage.dataRows.nth(i));
      if (expected[i]) {
        await expect(cell, `row ${i} customer`).toContainText(expected[i]);
        await expect(cell, `row ${i} organization`).toContainText(pageData.documents[i].organizationName, { ignoreCase: true });
      } else {
        await expect(cell, `row ${i} (no customer)`).toHaveText('—');
      }
    }
  });

  test('TC_Document_065: Verify upload date is displayed', async ({ documentsPage }) => {
    const pageData = await documentsPage.navigate();
    // Each row must show the correct upload date (same format and time zone the table uses)
    for (let i = 0; i < Math.min(5, pageData.documents.length); i++) {
      const expected = await documentsPage.formatUploadDate(pageData.documents[i].createdAt);
      await expect(documentsPage.uploadDateCell(documentsPage.dataRows.nth(i)), `row ${i} upload date`).toHaveText(expected);
    }
  });

  test('TC_Document_066: Verify Extracted status display', async ({ documentsPage, page }) => {
    test.setTimeout(300000);
    await documentsPage.navigate();
    const row = await documentsPage.findRowByStatus(/^Extracted$/, 150);
    expect(row, 'an Extracted document in the first 150 documents').not.toBeNull();
    // Centre the row (so it is not hidden under the sticky header) before highlighting the badge
    await documentsPage.scrollRowToCenter(row!);
    const badge = documentsPage.statusBadge(row!);
    await expect(badge).toHaveText('Extracted');
    await expect(badge).toBeInViewport();
    // Rendered as a styled status pill
    await expect(badge).toHaveClass(/rounded-full/);
    await expect(badge).toHaveClass(/\bbg-\w+-\d+/);
    await attachEvidence(page, 'Extracted status');
  });

  test('TC_Document_067: Verify Processing, Reviewed, Sucess, Partial sucess, Failed insertion status display', async ({ documentsPage, page }) => {
    test.setTimeout(300000);
    await documentsPage.navigate();

    // Scroll to each mentioned status, highlight its badge and attach a screenshot per status
    const wanted = ['Processing', 'Reviewed', 'Success', 'Partially Success', 'Failed'];
    const missing: string[] = [];
    for (const status of wanted) {
      const row = await documentsPage.findRowByStatus(new RegExp(`^${status}$`), 150);
      if (!row) { missing.push(status); continue; }
      await documentsPage.scrollRowToCenter(row);
      await clearHighlights(page);
      await expect(documentsPage.statusBadge(row)).toHaveText(status);
      await expect(documentsPage.statusBadge(row)).toBeInViewport();
      await expect(documentsPage.nameCell(row)).toBeVisible();
      await attachEvidence(page, `Status - ${status}`);
    }

    // Every status rendered so far must be one of the documented labels
    for (const s of await documentsPage.getVisibleStatuses()) {
      expect(DOCUMENT_STATUSES as readonly string[], `status "${s}"`).toContain(s);
    }
    expect(missing, `statuses not found in the first 150 documents: ${missing.join(', ')}`).toEqual([]);
  });

  test('TC_Document_068: Verify the Failed status files document', async ({ documentsPage, page }) => {
    test.setTimeout(300000);
    await documentsPage.navigate();
    // Scroll the library until a Failed document appears
    const row = await documentsPage.findRowByStatus(/^Failed$/, 150);
    expect(row, 'a document with "Failed" status in the first 150 documents').not.toBeNull();
    // Centre the row (so it is not hidden under the sticky header), highlight the badge, capture it
    await documentsPage.scrollRowToCenter(row!);
    await expect(documentsPage.statusBadge(row!)).toHaveText('Failed');
    await expect(documentsPage.statusBadge(row!)).toBeInViewport();
    await attachEvidence(page, 'Failed status');
  });

  test('TC_Document_069: Verify Uploaded By column on Documents page', async ({ documentsPage }) => {
    await documentsPage.navigate();
    await expect(documentsPage.tableHeaderCells.filter({ hasText: /Uploaded By/i }).first()).toBeVisible();
  });

  test('TC_Document_070: Verify Review button visibility', async ({ documentsPage }) => {
    await documentsPage.navigate();
    const rows = await documentsPage.getRowStatusesAndActions();
    expect(rows.length).toBeGreaterThan(0);
    // Every document (except failed extractions, which offer Re-Extract) must have a Review button
    const reviewable = rows.filter(r => r.status !== 'Extraction Failed');
    for (const r of reviewable) {
      expect(r.action, `${r.name} action`).toContain('Review');
    }
    // Asserting on the buttons themselves highlights each one in the screenshot
    await expect(documentsPage.dataRows.getByRole('button', { name: 'Review', exact: true })).toHaveCount(reviewable.length);
  });

  test('TC_Document_071: Verify Review button functionality', async ({ documentsPage, reviewPage, page }) => {
    await documentsPage.navigate();
    await documentsPage.openReview(0);
    await expect(page).toHaveURL(/\/review\/[A-Za-z0-9]+(\?.*)?$/);
    // Wait for the review page to finish loading so the screenshot shows the loaded document
    // (Elements common to every review page: PO pages show "Complete", SIF/quote pages show "Submit to ERP".)
    await reviewPage.waitForReviewLoaded();
    await expect(reviewPage.extractedDataTab).toBeVisible({ timeout: 30000 });
    await expect(reviewPage.completeButton.or(reviewPage.submitToErpButton).first()).toBeVisible({ timeout: 30000 });
    await expect(reviewPage.backButton).toBeVisible();
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  });

  test('TC_Document_072: Verify vertical scrolling functionality', async ({ documentsPage }) => {
    const firstPage = await documentsPage.navigate();
    const initial = await documentsPage.dataRows.count();
    test.skip(!firstPage.hasMore, 'Library fits on one page; nothing to scroll.');
    // Scrolling the table must load the next page of documents
    const nextPage = documentsPage.waitForListResponse(req => req.startIndex > 0);
    const after = await documentsPage.loadRows(initial + 1);
    const loaded = await nextPage;
    expect(after).toBeGreaterThan(initial);
    expect(loaded.documents.length).toBeGreaterThan(0);
  });

  test('TC_Document_073: Verify page loads without errors', async ({ documentsPage }) => {
    // Console errors, uncaught page errors and 5xx responses
    const errors = documentsPage.trackPageErrors();
    await documentsPage.navigate();
    expect(errors).toEqual([]);
  });

});
