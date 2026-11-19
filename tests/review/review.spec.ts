import fs from 'fs';
import { Page, TestInfo } from '@playwright/test';
import { test, expect } from '../../src/fixtures/test.fixture';
import { FIELD_LABELS, ReviewFieldKey, ReviewPage } from '../../src/pages/review.page';
import { addressRe, attachEvidence, docId, ensureSifUploaded, ensureUploaded, escapeRe, LINES, openDoc, reviewPo } from './support/review-data';

/*
 * Source: Test Cases/River Stream Test cases.xlsx, sheet "Review page" (TC_Review page_001 - 035).
 * TC_Review page_035 reviews a Riverstone SIF quote (Riverstone test SIF Files/..._QA8.sif) uploaded once per run.
 * The suite is split in two files: review.spec.ts (screenshot evidence) and review-recorded.spec.ts (screenshot + video of every test).
 * Every test reviews a document uploaded by this suite (see support/review-data.ts): a generated 2-page
 * purchase order with known values. Field and line-item edits stay in the browser (they are saved only by
 * "Complete"), so they never change the shared documents; Complete / Submit to ERP use the "erp" document.
 */

test.describe('River Stream - Document Review Suite: screenshot evidence', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  test.beforeEach(async ({ page }, testInfo) => {
    // The first test of the run uploads the suite's documents (about a minute); extraction is awaited on open
    test.setTimeout(300000);
    await ensureUploaded(page, testInfo);
  });

  // =========================================================================
  // Page, preview and PDF controls
  // =========================================================================

  test('TC_Review page_001: Verify Document Review page loads successfully with the page count.', async ({ reviewPage, documentsPage, page }) => {
    const po = reviewPo('main');
    const id = docId('main');
    await reviewPage.open(id); // waits until extraction has finished
    // Open the processed document from the Documents list, as the user does
    await documentsPage.navigate();
    await documentsPage.searchDocument(po.fileName);
    await documentsPage.openReview(documentsPage.rowByName(po.fileName));
    await expect(page).toHaveURL(new RegExp(`/review/${id}(\\?|$)`));
    await reviewPage.waitForReviewLoaded();
    await expect(reviewPage.pageHeading).toBeVisible();
    await expect(reviewPage.fileHeading(po.fileName)).toBeVisible();
    await expect(reviewPage.fileTypeLabel).toHaveText('Original PDF document');
    await expect(reviewPage.pageIndicator, 'page count').toHaveText('Page 1 / 2');
    await expect(reviewPage.pdfPage(1)).toBeVisible();
    await expect(reviewPage.analysisHeading).toBeVisible();
    await expect(reviewPage.extractedDataTab).toHaveAttribute('aria-selected', 'true');
    await expect(reviewPage.fieldValue(FIELD_LABELS.purchase_order)).toHaveText(po.poNumber);
    await expect(reviewPage.completeButton).toBeVisible();
  });

  test('TC_Review page_002: Verify PDF document preview display', async ({ reviewPage }) => {
    const po = reviewPo('main');
    await openDoc(reviewPage, 'main');
    await expect(reviewPage.fileHeading(po.fileName)).toBeVisible();
    // The uploaded PDF is rendered (canvas) with its text, at a real zoom level
    await expect(reviewPage.pdfCanvas.first()).toBeVisible();
    await expect(reviewPage.zoomLevel).toHaveText(/^[1-9]\d*%$/);
    await expect(reviewPage.pdfPage(1), 'page 1 of the uploaded PO').toContainText('PURCHASE ORDER');
    await expect(reviewPage.pdfPage(1)).toContainText(`PO Number: ${po.poNumber}`);
    await expect(reviewPage.pdfPage(1)).toBeInViewport();
  });

  test('TC_Review page_004: Verify zoom in and zoom out functionality', async ({ reviewPage }) => {
    await openDoc(reviewPage, 'main');
    const start = await reviewPage.zoomPercent();
    expect(start, 'initial zoom').toBeGreaterThan(0);
    const width = async () => (await reviewPage.pdfCanvas.first().boundingBox())!.width;
    const startWidth = await width();
    await reviewPage.zoomInButton.click();
    await expect(reviewPage.zoomLevel).toHaveText(`${start + 10}%`);
    await expect.poll(width, { message: 'page is drawn larger' }).toBeGreaterThan(startWidth);
    await reviewPage.zoomOutButton.click();
    await reviewPage.zoomOutButton.click();
    await expect(reviewPage.zoomLevel).toHaveText(`${start - 10}%`);
    await expect.poll(width, { message: 'page is drawn smaller' }).toBeLessThan(startWidth);
    await reviewPage.zoomInButton.click();
    await expect(reviewPage.zoomLevel, 'back to the initial zoom').toHaveText(`${start}%`);
    await expect(reviewPage.zoomInButton).toBeVisible();
    await expect(reviewPage.zoomOutButton).toBeVisible();
  });

  test('TC_Review page_005: Verify download button functionality.', async ({ reviewPage, page }) => {
    const po = reviewPo('main');
    await openDoc(reviewPage, 'main');
    await expect(reviewPage.downloadLink, 'download link to the original PDF').toHaveAttribute('href', /\.pdf\?/);
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), reviewPage.downloadButton.click()]);
    expect(download.suggestedFilename(), 'downloaded file name').toMatch(new RegExp(`^${escapeRe(po.fileName.replace(/\.pdf$/, ''))}.*\\.pdf$`));
    const file = fs.readFileSync(await download.path());
    expect(file.subarray(0, 5).toString(), 'a PDF file').toBe('%PDF-');
    expect(file.length, 'file size').toBeGreaterThan(1000);
    test.info().annotations.push({ type: 'note', description: `Downloaded ${download.suggestedFilename()} (${file.length} bytes)` });
    await expect(reviewPage.downloadButton).toBeVisible();
  });

  test('TC_Review page_007: Verify the search functionality', async ({ reviewPage }) => {
    await openDoc(reviewPage, 'main');
    await reviewPage.searchButton.click();
    await expect(reviewPage.searchInput).toBeVisible();
    await reviewPage.searchInput.fill('Pedestal');
    await reviewPage.searchSubmitButton.click();
    // "Pedestal" is printed twice in the PO (line items 1 and 2): match 1 of 2 (the viewer paints it orange)
    await expect(reviewPage.searchResultCount, 'match count').toHaveText('1 / 2');
    await expect(reviewPage.pdfPage(1).getByText(LINES[0].description, { exact: true }), 'first match').toBeVisible();
    await expect(reviewPage.pdfPage(1).getByText(LINES[1].description, { exact: true }), 'second match').toBeVisible();
    await expect(reviewPage.searchInput).toHaveValue('Pedestal');
  });

  // =========================================================================
  // Extracted data
  // =========================================================================

  test('TC_Review page_011: Verify JSON View tab display', async ({ reviewPage }) => {
    const po = reviewPo('main');
    await openDoc(reviewPage, 'main');
    await reviewPage.jsonViewTab.click();
    await expect(reviewPage.jsonViewTab).toHaveAttribute('aria-selected', 'true');
    await expect(reviewPage.jsonBlock).toBeVisible();
    const data = JSON.parse(await reviewPage.jsonBlock.innerText());
    expect(data.purchase_order?.value, 'purchase_order in the JSON').toBe(po.poNumber);
    expect(data.customer_name?.value, 'customer_name in the JSON').toBe(po.customer);
    expect(data.order_line_items, 'order_line_items in the JSON').toHaveLength(po.lines.length);
    await expect(reviewPage.jsonBlock).toContainText(`"purchase_order"`);
  });

  test('TC_Review page_012: Verify extracted field values', async ({ reviewPage }) => {
    const po = reviewPo('main');
    await openDoc(reviewPage, 'main');
    const expected: Array<[ReviewFieldKey, RegExp, number]> = [
      ['customer_name', new RegExp(`^${escapeRe(po.customer)}$`), 1],
      ['purchase_order', new RegExp(`^${po.poNumber}$`), 1],
      ['invoice_date', new RegExp(`^${escapeRe(po.date)}$`), 1],
      ['total_amount', new RegExp(`^${escapeRe(po.total)}$`), 2],
      ['billing_addressee_name', new RegExp(`^${escapeRe(po.billingName)}$`), 1],
      ['shipping_addressee_name', new RegExp(`^${escapeRe(po.shippingName)}$`), 1],
      ['billing_address', addressRe(po.billingAddress), 1],
      ['shipping_address', addressRe(po.shippingAddress), 1],
    ];
    for (const [key, value, pageNo] of expected) {
      const label = FIELD_LABELS[key];
      await reviewPage.fieldValue(label).scrollIntoViewIfNeeded();
      // Same value as printed in the PDF (page `pageNo`)
      await expect(reviewPage.fieldValue(label), label).toHaveText(value);
      await expect(reviewPage.fieldSource(label), `${label} source`).toHaveText(`Source: Page ${pageNo}`);
    }
    await expect(reviewPage.pdfPage(1)).toContainText(po.poNumber);
    await expect(reviewPage.pdfPage(2)).toContainText(po.total);
    await reviewPage.analysisHeading.scrollIntoViewIfNeeded();
  });

  test('TC_Review page_014: Verify field copy functionality', async ({ reviewPage, page }) => {
    const po = reviewPo('main');
    await openDoc(reviewPage, 'main');
    const label = FIELD_LABELS.purchase_order;
    await page.evaluate(() => navigator.clipboard.writeText(''));
    await reviewPage.fieldCopyButton(label).click();
    await expect(reviewPage.toast, 'confirmation').toContainText('Copied to clipboard!');
    expect(await page.evaluate(() => navigator.clipboard.readText()), 'clipboard').toBe(po.poNumber);
    await expect(reviewPage.fieldValue(label)).toHaveText(po.poNumber);
    await expect(reviewPage.fieldCopyButton(label)).toBeVisible();
  });

  test('TC_Review page_016: Verify confidence score display', async ({ reviewPage }) => {
    const doc = await openDoc(reviewPage, 'main');
    for (const [key, label] of Object.entries(FIELD_LABELS) as Array<[ReviewFieldKey, string]>) {
      await reviewPage.fieldCard(label).scrollIntoViewIfNeeded();
      const score = doc.extractedData[key].confidence_score;
      expect(score, `${label} confidence in the API`).toEqual(expect.any(Number));
      await expect(reviewPage.fieldConfidence(label), `${label} confidence`).toHaveText(`${score}%`);
    }
    await reviewPage.analysisHeading.scrollIntoViewIfNeeded();
  });

  test('TC_Review page_018: Verify document review page without errors', async ({ reviewPage, page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`Page error: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`Console error: ${m.text()}`);
    });
    page.on('response', (r) => {
      if (r.url().includes('/api/') && r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.request().method()} ${r.url()}`);
    });
    const doc = await openDoc(reviewPage, 'main');
    await reviewPage.jsonViewTab.click();
    await expect(reviewPage.jsonBlock).toBeVisible();
    await reviewPage.extractedDataTab.click();
    await expect(reviewPage.fieldValue(FIELD_LABELS.purchase_order)).toHaveText(reviewPo('main').poNumber);
    expect(doc.status).toBe('extracted');
    expect(errors, 'no page, console or API errors').toEqual([]);
    await expect(reviewPage.pdfPage(1)).toBeVisible();
    await expect(reviewPage.analysisHeading).toBeVisible();
  });

  // =========================================================================
  // Order Line Items
  // =========================================================================

  test('TC_Review page_030: Verify the Delete action in the Order line items.', async ({ reviewPage }) => {
    const po = reviewPo('main');
    await openDoc(reviewPage, 'main');
    await reviewPage.openLineItems();
    // The Actions column offers a Delete icon on every row
    await expect(reviewPage.lineItemHeaders.last()).toHaveText('Actions');
    for (let i = 0; i < po.lines.length; i++) await expect(reviewPage.deleteRowButton(i), `row ${i + 1} delete icon`).toBeVisible();
    // Clicking it removes the entire row
    await reviewPage.deleteRowButton(1).click();
    await expect(reviewPage.lineItemRows).toHaveCount(po.lines.length - 1);
    await expect(reviewPage.lineItemsModal.getByText(po.lines[1].description, { exact: true }), 'deleted row is gone').toHaveCount(0);
    await expect(reviewPage.lineItemsRowCount).toHaveText(`${po.lines.length - 1} rows`);
    await expect(reviewPage.lineItemRows.locator('td:first-child'), 'remaining rows').toHaveText([po.lines[0].code, po.lines[2].code]);
  });

  test('TC_Review page_034: Verify the extracted line-item data of an uploaded PDF matches the data shown after clicking Edit All', async ({ reviewPage, page }, testInfo) => {
    await openDoc(reviewPage, 'main');
    await expectEditAllMatchesExtracted(reviewPage, page, testInfo);
  });

  test(
    'TC_Review page_035: Verify the extracted line-item data of an uploaded SIF matches the data shown after clicking Edit All',
    { annotation: { type: 'issue', description: 'Known bug: after Edit All, the Options column of an uploaded SIF shows "[object Object]" in place of the extracted options (e.g. "B, Black, LEATHER COLOR OPTION, $10.00").' } },
    async ({ reviewPage, page }, testInfo) => {
      const id = await ensureSifUploaded(page, testInfo);
      await reviewPage.open(id); // waits until extraction has finished
      await expect(reviewPage.fileTypeLabel).toHaveText(/SIF/i);
      await expectEditAllMatchesExtracted(reviewPage, page, testInfo);
    },
  );
});

/** Cell texts of every line-item row by column header (input values while editing); the Actions column left out. */
async function lineItemsByColumn(reviewPage: ReviewPage): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const headers = (await reviewPage.lineItemColumns()).filter((h) => h !== 'Actions');
  const cells = await reviewPage.lineItemRows.evaluateAll((rows) =>
    rows.map((r) =>
      [...(r as HTMLTableRowElement).cells].map((c) =>
        ((c.querySelector('input, textarea') as HTMLInputElement | null)?.value ?? (c as HTMLElement).innerText).replace(/\s+/g, ' ').trim(),
      ),
    ),
  );
  return { headers, rows: cells.map((row) => Object.fromEntries(headers.map((h, i) => [h, row[i] ?? '']))) };
}

/**
 * Order Line Items popup: reads every extracted cell, clicks Edit All, and checks each input holds the same value.
 * Mismatched inputs are highlighted and listed in a note; matching tables get every input highlighted.
 */
async function expectEditAllMatchesExtracted(reviewPage: ReviewPage, page: Page, testInfo: TestInfo): Promise<void> {
  await reviewPage.openLineItems();
  const extracted = await lineItemsByColumn(reviewPage);
  expect(extracted.rows.length, 'line items extracted').toBeGreaterThan(0);
  await expect(reviewPage.lineItemRows, 'extracted rows').toHaveCount(extracted.rows.length);
  await attachEvidence(page, testInfo, 'Extracted line items before Edit All');

  await reviewPage.editAllButton.click();
  // The rows outlined for the "before" screenshot are the same elements: clear them so the final screenshot shows only the inputs checked
  await page.evaluate(() =>
    document.querySelectorAll<HTMLElement>('[data-rs-tested]').forEach((el) => {
      el.style.outline = el.style.outlineOffset = el.style.boxShadow = '';
      el.removeAttribute('data-rs-tested');
    }),
  );
  await expect(reviewPage.editingButton, 'Edit All mode').toBeVisible();
  await reviewPage.lineItemInput(0, 0).waitFor();
  const editing = await lineItemsByColumn(reviewPage);
  expect(editing.rows.length, 'rows while editing').toBe(extracted.rows.length);

  const mismatches: { row: number; column: string; extracted: string; editing: string }[] = [];
  extracted.rows.forEach((row, r) =>
    extracted.headers.forEach((column) => {
      const value = editing.headers.includes(column) ? editing.rows[r][column] : '(column not shown)';
      if (value !== row[column]) mismatches.push({ row: r + 1, column, extracted: row[column], editing: value });
    }),
  );
  testInfo.annotations.push({
    type: 'note',
    description:
      `Compared ${extracted.rows.length} rows x ${extracted.headers.length} columns (${extracted.headers.join(', ')}). ` +
      (mismatches.length
        ? `${mismatches.length} cells differ after Edit All: ` +
          mismatches.slice(0, 15).map((m) => `row ${m.row} ${m.column}: extracted "${m.extracted}", Edit All "${m.editing}"`).join('; ') +
          (mismatches.length > 15 ? '; ...' : '')
        : 'Every Edit All input holds the extracted value.'),
  });

  if (mismatches.length) {
    // Outline the inputs that differ (the first one scrolled into view for the screenshot)
    for (const m of mismatches) {
      const column = editing.headers.indexOf(m.column);
      if (column >= 0) await expect(reviewPage.lineItemInput(m.row - 1, column), `row ${m.row} ${m.column}`).toBeVisible();
    }
    const first = editing.headers.indexOf(mismatches[0].column);
    if (first >= 0) await reviewPage.lineItemInput(mismatches[0].row - 1, first).scrollIntoViewIfNeeded();
  } else {
    const inputs = reviewPage.lineItemsModal.locator('tbody input, tbody textarea');
    await expect(inputs, 'Edit All inputs').toHaveCount(await inputs.count());
  }
  expect(
    mismatches.map((m) => `row ${m.row} ${m.column}: extracted "${m.extracted}" / Edit All "${m.editing}"`),
    'every Edit All input shows the extracted value',
  ).toEqual([]);
}
