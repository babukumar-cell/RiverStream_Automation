import { test, expect } from '../../src/fixtures/test.fixture';
import { FIELD_LABELS, ReviewFieldKey } from '../../src/pages/review.page';
import { addressRe, attachEvidence, ensureUploaded, LINE_COLUMNS, LINES, lineValues, openDoc, reviewPo, VENDOR } from './support/review-data';

/*
 * Source: Test Cases/River Stream Test cases.xlsx, sheet "Review page" (TC_Review page_001 - 033).
 * The suite is split in two files: review-recorded.spec.ts (screenshot + video of every test) and review.spec.ts (screenshot evidence).
 * Every test reviews a document uploaded by this suite (see support/review-data.ts): a generated 2-page
 * purchase order with known values. Field and line-item edits stay in the browser (they are saved only by
 * "Complete"), so they never change the shared documents; Complete / Submit to ERP use the "erp" document.
 */

// Every test in this file is recorded, not only failures: the video shows each click, drag and edit.
// (Playwright only accepts the video option at the top level of a spec file.)
test.use({ video: { mode: 'on', size: { width: 1280, height: 720 } } });

test.describe('River Stream - Document Review Suite: recorded (video)', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  test.beforeEach(async ({ page }, testInfo) => {
    // The first test of the run uploads the suite's documents (about a minute); extraction is awaited on open
    test.setTimeout(300000);
    await ensureUploaded(page, testInfo);
  });

  // =========================================================================
  // Page navigation and PDF controls
  // =========================================================================

  test('TC_Review page_003: Verify page navigation and ciatation controls by clicking the Source number and the order line items value', async ({ reviewPage }) => {
    await openDoc(reviewPage, 'main');
    // Previous / Next page controls
    await expect(reviewPage.pageIndicator).toHaveText('Page 1 / 2');
    await expect(reviewPage.prevPageButton, 'no previous page on page 1').toBeDisabled();
    await reviewPage.goToPage('next');
    await expect(reviewPage.pageIndicator).toHaveText('Page 2 / 2');
    await expect(reviewPage.nextPageButton, 'no next page on the last page').toBeDisabled();
    await reviewPage.goToPage('previous');
    await expect(reviewPage.pageIndicator).toHaveText('Page 1 / 2');
    // Citation: the Source number of a field opens the page the value was read from
    await expect(reviewPage.fieldSource(FIELD_LABELS.total_amount)).toHaveText('Source: Page 2');
    await reviewPage.fieldSource(FIELD_LABELS.total_amount).click();
    await reviewPage.waitForPdfScrollSettled();
    await expect(reviewPage.pageIndicator, 'Total Amount is cited on page 2').toHaveText('Page 2 / 2');
    // Citation from an order line item value (Order Line Items opened in the panel): line item 1 is on page 1
    await reviewPage.expandLineItemsInline();
    await expect(reviewPage.inlineLineItemRows.first().locator('td').nth(5), 'Page of line item 1').toHaveText('1');
    await reviewPage.inlineLineItemValue(0, 1).click();
    await reviewPage.waitForPdfScrollSettled();
    await expect(reviewPage.pageIndicator, 'line item 1 is cited on page 1').toHaveText('Page 1 / 2');
    await expect(reviewPage.inlineLineItemValue(0, 1)).toHaveText(LINES[0].description);
    await expect(reviewPage.pdfPage(1).getByText(LINES[0].description, { exact: true })).toBeVisible();
  });

  test('TC_Review page_008: Verify Vertical Scroll Functionality', async ({ reviewPage, page }) => {
    await openDoc(reviewPage, 'main');
    // PDF preview: scrolling down reaches page 2, scrolling up returns to page 1
    const pdf = (await reviewPage.pdfPage(1).boundingBox())!;
    await page.mouse.move(pdf.x + pdf.width / 2, pdf.y + 50);
    await expect(async () => {
      await page.mouse.wheel(0, 600);
      await expect(reviewPage.pageIndicator).toHaveText('Page 2 / 2', { timeout: 1500 });
    }).toPass({ timeout: 20000 });
    await expect(reviewPage.pdfPage(2)).toBeInViewport({ ratio: 0.2 });
    await expect(async () => {
      await page.mouse.wheel(0, -600);
      await expect(reviewPage.pageIndicator).toHaveText('Page 1 / 2', { timeout: 1500 });
    }).toPass({ timeout: 20000 });
    // Extracted data: the bottom section can be scrolled into view and back
    await reviewPage.lineItemsSummary.scrollIntoViewIfNeeded();
    await expect(reviewPage.lineItemsSummary, 'bottom of the extracted data').toBeInViewport();
    await reviewPage.analysisHeading.scrollIntoViewIfNeeded();
    await expect(reviewPage.analysisHeading, 'back at the top').toBeInViewport();
    await expect(reviewPage.pdfPage(1)).toBeInViewport({ ratio: 0.2 });
  });

  test('TC_Review page_010: Verify Back to Dashboard navigation', async ({ reviewPage, dashboardPage, page }) => {
    // Opened from the Dashboard, the review page offers "Back to Dashboard"
    await dashboardPage.navigate();
    await openDoc(reviewPage, 'main', 'dashboard');
    await expect(reviewPage.backButton).toHaveText('Back to Dashboard');
    await reviewPage.backButton.click();
    await expect(page).toHaveURL(/\/dashboard(\?|$)/);
    await dashboardPage.expectLoaded();
    await expect(dashboardPage.kpiTablist, 'Dashboard').toBeVisible();
  });

  // =========================================================================
  // Extracted data
  // =========================================================================

  test('TC_Review page_013: Verify field edit functionality', async ({ reviewPage }) => {
    const po = reviewPo('main');
    await openDoc(reviewPage, 'main');
    const label = FIELD_LABELS.purchase_order;
    await reviewPage.fieldEditButton(label).click();
    await expect(reviewPage.fieldInput(label)).toHaveValue(po.poNumber);
    const updated = `${po.poNumber}-EDITED`;
    await reviewPage.fieldInput(label).fill(updated);
    await reviewPage.fieldSaveButton(label).click();
    await expect(reviewPage.toast, 'confirmation').toContainText('Values updated!');
    await expect(reviewPage.fieldInput(label)).toHaveCount(0);
    await expect(reviewPage.fieldValue(label), 'updated value').toHaveText(updated);
  });

  test('TC_Review page_015: Verify the selection functionality', async ({ reviewPage }) => {
    const po = reviewPo('main');
    await openDoc(reviewPage, 'main');
    const label = FIELD_LABELS.customer_name;
    await expect(reviewPage.fieldValue(label)).toHaveText(po.customer);
    // Selection icon, then select a text in the PDF: it fills the field
    await reviewPage.pickFromPdf(label, 1, VENDOR);
    await expect(reviewPage.fieldInput(label), 'selected PDF text').toHaveValue(VENDOR);
    await reviewPage.fieldSaveButton(label).click();
    await expect(reviewPage.toast).toContainText('Values updated!');
    await expect(reviewPage.fieldValue(label), 'extracted value replaced by the selection').toHaveText(VENDOR);
    await expect(reviewPage.pdfPage(1).getByText(VENDOR, { exact: true })).toBeVisible();
  });

  test('TC_Review page_017: Verify address swap functionality', async ({ reviewPage }) => {
    const po = reviewPo('main');
    await openDoc(reviewPage, 'main');
    const L = FIELD_LABELS;
    await reviewPage.swapNamesButton.scrollIntoViewIfNeeded();
    await expect(reviewPage.fieldValue(L.billing_addressee_name)).toHaveText(po.billingName);
    await expect(reviewPage.fieldValue(L.shipping_addressee_name)).toHaveText(po.shippingName);
    await reviewPage.swapNamesButton.click();
    await reviewPage.swapAddressesButton.click();
    // Billing and shipping values are exchanged
    await expect(reviewPage.fieldValue(L.billing_addressee_name), 'billing name').toHaveText(po.shippingName);
    await expect(reviewPage.fieldValue(L.shipping_addressee_name), 'shipping name').toHaveText(po.billingName);
    await expect(reviewPage.fieldValue(L.billing_address), 'billing address').toHaveText(addressRe(po.shippingAddress));
    await expect(reviewPage.fieldValue(L.shipping_address), 'shipping address').toHaveText(addressRe(po.billingAddress));
    await expect(reviewPage.swapNamesButton).toBeVisible();
    await expect(reviewPage.swapAddressesButton).toBeVisible();
  });

  // =========================================================================
  // Client JSON matching (needs the client JSON configuration: see the notes in each test)
  // =========================================================================

  const CLIENT_JSON_PENDING =
    'Needs the client JSON configuration used for matching (client name, billing and shipping addresses) and a document for it; ' +
    'QA organization riverstonetech has no such client configured.';

  test('TC_Review page_019: Verify Client and Billing Address auto-replacement when Customer Name partially matches client JSON', async () => {
    test.fixme(true, CLIENT_JSON_PENDING);
  });

  test('TC_Review page_020: Verify no replacement when Customer Name does not match client JSON', async ({ reviewPage }) => {
    const po = reviewPo('nomatch');
    await openDoc(reviewPage, 'nomatch');
    // "ABC Furniture" is not a client: customer and billing details stay as printed in the document
    await expect(reviewPage.pdfPage(1)).toContainText(po.customer);
    await expect(reviewPage.fieldValue(FIELD_LABELS.customer_name), 'Customer Name').toHaveText(po.customer);
    await expect(reviewPage.fieldValue(FIELD_LABELS.billing_addressee_name), 'Billing Addressee Name').toHaveText(po.billingName);
    await expect(reviewPage.fieldValue(FIELD_LABELS.billing_address), 'Billing Address').toHaveText(addressRe(po.billingAddress));
  });

  test('TC_Review page_021: Verify Shipping Address auto-replacement when match is greater than 75%', async () => {
    test.fixme(true, CLIENT_JSON_PENDING);
  });

  test('TC_Review page_022: Verify no Shipping Address replacement when match is less than 75%', async () => {
    test.fixme(true, CLIENT_JSON_PENDING);
  });

  test('TC_Review page_023: Verify correct JSON values are applied after replacement', async () => {
    test.fixme(true, CLIENT_JSON_PENDING);
  });

  // =========================================================================
  // Order Line Items
  // =========================================================================

  test('TC_Review page_024: Verify expand icon in the order line item', async ({ reviewPage, page }) => {
    const po = reviewPo('main');
    await openDoc(reviewPage, 'main');
    await expect(reviewPage.lineItemsSummary).toHaveText(`Table with ${po.lines.length} rows`);
    await reviewPage.openLineItems();
    await expect(reviewPage.lineItemsModal.getByRole('heading', { name: 'Order Line Items' })).toBeVisible();
    await expect(reviewPage.lineItemsRowCount).toHaveText(`${po.lines.length} rows`);
    expect(await reviewPage.lineItemColumns()).toEqual(LINE_COLUMNS);
    expect((await reviewPage.lineItemValues()).map((r) => r.slice(0, 5))).toEqual(po.lines.map(lineValues));
    // Shown in the middle of the page
    const box = (await reviewPage.lineItemsModal.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(Math.abs(box.x + box.width / 2 - viewport.width / 2), 'centred horizontally').toBeLessThan(viewport.width * 0.05);
    expect(Math.abs(box.y + box.height / 2 - viewport.height / 2), 'centred vertically').toBeLessThan(viewport.height * 0.1);
    await expect(reviewPage.lineItemRows).toHaveCount(po.lines.length);
  });

  test('TC_Review page_025: Verify Edit all button functionality', async ({ reviewPage }) => {
    const po = reviewPo('main');
    await openDoc(reviewPage, 'main');
    await reviewPage.openLineItems();
    await reviewPage.editAllButton.click();
    // Every row becomes editable
    for (let i = 0; i < po.lines.length; i++) {
      await expect(reviewPage.lineItemInput(i, 0), `row ${i + 1} editable`).toHaveValue(po.lines[i].code);
    }
    await reviewPage.lineItemInput(0, 2).fill('5');
    await reviewPage.lineItemInput(1, 1).fill(`${po.lines[1].description} - edited`);
    await reviewPage.saveAllButton.click();
    await expect(reviewPage.editAllButton, 'editing finished').toBeVisible();
    await expect(reviewPage.lineItemsModal.locator('tbody input')).toHaveCount(0);
    await expect(reviewPage.lineItemCell(0, 2), 'saved quantity').toHaveText('5');
    await expect(reviewPage.lineItemCell(1, 1), 'saved description').toHaveText(`${po.lines[1].description} - edited`);
  });

  test('TC_Review page_026: Verify the editing status.', async ({ reviewPage }) => {
    const po = reviewPo('main');
    await openDoc(reviewPage, 'main');
    await reviewPage.openLineItems();
    await expect(reviewPage.editAllButton).toBeVisible();
    await reviewPage.editAllButton.click();
    // The Edit All button now reads "Editing..."
    await expect(reviewPage.editAllButton).toHaveCount(0);
    await expect(reviewPage.editingButton, 'status').toBeVisible();
    await expect(reviewPage.saveAllButton).toBeVisible();
    await expect(reviewPage.cancelButton).toBeVisible();
    for (let i = 0; i < po.lines.length; i++) {
      await expect(reviewPage.lineItemInput(i, 0), `row ${i + 1} editable`).toBeEditable();
    }
  });

  test('TC_Review page_027: Verify the cancel button', async ({ reviewPage }) => {
    const po = reviewPo('main');
    await openDoc(reviewPage, 'main');
    await reviewPage.openLineItems();
    await reviewPage.editAllButton.click();
    await reviewPage.lineItemInput(0, 2).fill('99');
    await reviewPage.lineItemInput(0, 1).fill('Changed and cancelled');
    await reviewPage.cancelButton.click();
    // The changes are discarded
    await expect(reviewPage.editAllButton).toBeVisible();
    await expect(reviewPage.lineItemsModal.locator('tbody input')).toHaveCount(0);
    await expect(reviewPage.lineItemCell(0, 2), 'quantity unchanged').toHaveText(String(po.lines[0].qty));
    await expect(reviewPage.lineItemCell(0, 1), 'description unchanged').toHaveText(po.lines[0].description);
  });

  test('TC_Review page_028: Verify the Add row Button.', async ({ reviewPage }) => {
    const po = reviewPo('main');
    await openDoc(reviewPage, 'main');
    await reviewPage.openLineItems();
    await reviewPage.addRowButton.click();
    const row = po.lines.length;
    await expect(reviewPage.lineItemRows).toHaveCount(po.lines.length + 1);
    // The new row's cells are editable
    const values = ['CD-NEW-ROW', 'Row added by automation', '3', '10.00', '30.00'];
    for (const [c, v] of values.entries()) {
      await reviewPage.lineItemInput(row, c).fill(v);
      await expect(reviewPage.lineItemInput(row, c)).toHaveValue(v);
    }
    const newRowEnabled = await reviewPage.newRowButton.isEnabled().catch(() => false);
    test.info().annotations.push({ type: 'note', description: `While the new row is being edited, "+ New row" is ${newRowEnabled ? 'enabled' : 'disabled'}.` });
    await reviewPage.saveChangesButton.click();
    await expect(reviewPage.lineItemRows).toHaveCount(po.lines.length + 1);
    await expect(reviewPage.lineItemCell(row, 0)).toHaveText(values[0]);
    await expect(reviewPage.lineItemCell(row, 1)).toHaveText(values[1]);
    await expect(reviewPage.addRowButton).toBeVisible();
  });

  test('TC_Review page_029: Verify the drag row functionality', async ({ reviewPage }) => {
    const po = reviewPo('main');
    await openDoc(reviewPage, 'main');
    await reviewPage.openLineItems();
    const codes = po.lines.map((l) => l.code);
    // Drag the first row onto the last one: it moves to the end
    await reviewPage.dragRow(0, 2);
    await expect(reviewPage.lineItemRows.locator('td:first-child')).toHaveText([codes[1], codes[2], codes[0]]);
    await expect(reviewPage.lineItemRows.nth(2), 'moved row').toContainText(po.lines[0].description);
  });

  test('TC_Review page_031: Verify that deleting the only existing row removes the data but retains an empty row.', async ({ reviewPage }) => {
    const po = reviewPo('single');
    await openDoc(reviewPage, 'single');
    await reviewPage.openLineItems();
    await expect(reviewPage.lineItemRows).toHaveCount(1);
    await expect(reviewPage.lineItemCell(0, 0)).toHaveText(po.lines[0].code);
    // The only row offers "Clear row" in place of "Delete row"
    await reviewPage.clearRowButton(0).click();
    await expect(reviewPage.lineItemRows, 'the row is kept').toHaveCount(1);
    for (let c = 0; c < 5; c++) await expect(reviewPage.lineItemCell(0, c), `cell ${c + 1} emptied`).toHaveText('');
    await expect(reviewPage.lineItemsRowCount).toHaveText('1 rows');
    await expect(reviewPage.lineItemRows.first()).toBeVisible();
  });

  test('TC_Review page_032: Verify the swap row functionality.', async ({ reviewPage }) => {
    const po = reviewPo('main');
    await openDoc(reviewPage, 'main');
    await reviewPage.openLineItems();
    const codes = po.lines.map((l) => l.code);
    // Drag row 2 onto row 1: the two rows swap places
    await reviewPage.dragRow(1, 0);
    await expect(reviewPage.lineItemRows.locator('td:first-child')).toHaveText([codes[1], codes[0], codes[2]]);
    await expect(reviewPage.lineItemRows.nth(0)).toContainText(po.lines[1].description);
    await expect(reviewPage.lineItemRows.nth(1)).toContainText(po.lines[0].description);
  });

  test('TC_Review page_033: Verify the Citation functionality', async ({ reviewPage }) => {
    const doc = await openDoc(reviewPage, 'main');
    // Each field's "Source: Page N" opens page N of the PDF (starting from the other page every time)
    for (const [key, label] of Object.entries(FIELD_LABELS) as Array<[ReviewFieldKey, string]>) {
      const cited = doc.extractedData[key].citation;
      const pageNo = typeof cited === 'object' && cited ? cited.page : undefined;
      if (!pageNo) continue;
      const other = pageNo === 1 ? 2 : 1;
      await reviewPage.fieldSource(label).scrollIntoViewIfNeeded();
      if ((await reviewPage.pageIndicator.innerText()) !== `Page ${other} / 2`) await reviewPage.goToPage(other === 2 ? 'next' : 'previous');
      await expect(reviewPage.pageIndicator).toHaveText(`Page ${other} / 2`);
      await reviewPage.fieldSource(label).click();
      await reviewPage.waitForPdfScrollSettled();
      await expect(reviewPage.pageIndicator, `${label} -> page ${pageNo}`).toHaveText(`Page ${pageNo} / 2`);
    }
    // Evidence: Total Amount's citation (page 2), from page 1
    const total = FIELD_LABELS.total_amount;
    await reviewPage.fieldCard(total).scrollIntoViewIfNeeded();
    if ((await reviewPage.pageIndicator.innerText()) !== 'Page 1 / 2') await reviewPage.goToPage('previous');
    await reviewPage.fieldSource(total).click();
    await reviewPage.waitForPdfScrollSettled();
    await expect(reviewPage.pageIndicator, `${total} -> page 2`).toHaveText('Page 2 / 2');
    await expect(reviewPage.fieldSource(total)).toHaveText('Source: Page 2');
    await expect(reviewPage.fieldValue(total)).toHaveText(reviewPo('main').total);
  });

  // =========================================================================
  // Complete and Submit to ERP (the "erp" document only)
  // =========================================================================

  test('TC_Review page_006: Verify Complete button functionality', async ({ reviewPage, page }, testInfo) => {
    const doc = await openDoc(reviewPage, 'erp');
    if (doc.status === 'extracted') {
      await expect(reviewPage.statusBadge('Extracted')).toBeVisible();
      await expect(reviewPage.submitToErpButton, 'Submit to ERP waits for the review').toBeDisabled();
      // Evidence: the Complete button (it disappears once the review is completed)
      await reviewPage.completeButton.scrollIntoViewIfNeeded();
      await expect(reviewPage.completeButton, 'Complete button').toBeEnabled();
      await attachEvidence(page, testInfo, '1 - Complete button (before clicking)');
      const saved = page.waitForResponse((r) => r.url().includes('/api/updateDocument') && r.request().method() === 'POST');
      await reviewPage.completeButton.click();
      expect((await saved).status(), 'review saved').toBe(200);
      await expect(reviewPage.toast).toContainText('Document review completed and saved!');
    } else {
      test.info().annotations.push({ type: 'note', description: `The document was already completed earlier in this run (status ${doc.status}).` });
    }
    // Status is updated to Reviewed (Complete) and the document can now be submitted
    const after = await reviewPage.reload();
    expect(after.status, 'status in the backend').toMatch(/^(reviewed|quotation_\w+)$/);
    await expect(reviewPage.completeButton).toHaveCount(0);
    await expect(reviewPage.statusBadge(/^(Reviewed|Success)$/)).toBeVisible();
    if (after.status === 'reviewed') await expect(reviewPage.submitToErpButton).toBeEnabled();
  });

  test('TC_Review page_009: Verify Submit to ERP button functionality', async ({ reviewPage, page }, testInfo) => {
    test.setTimeout(300000);
    let doc = await openDoc(reviewPage, 'erp');
    if (doc.status === 'extracted') {
      // Submit to ERP is available once the document is completed (TC_Review page_006)
      await reviewPage.completeButton.click();
      await expect(reviewPage.toast).toContainText('Document review completed and saved!');
      doc = await reviewPage.reload();
    }
    if (doc.status === 'reviewed') {
      await expect(reviewPage.submitToErpButton, 'Submit to ERP button').toBeEnabled();
      await attachEvidence(page, testInfo, '1 - Submit to ERP button (before clicking)');
      const submitted = page.waitForResponse((r) => r.url().includes('/api/submitToErp'), { timeout: 120000 });
      await reviewPage.submitToErpButton.click();
      const response = await submitted;
      const body = await response.json().catch(() => ({}));
      expect(response.status(), `submitToErp: ${JSON.stringify(body).slice(0, 300)}`).toBe(200);
      test.info().annotations.push({ type: 'note', description: `ERP: ${body?.data?.message ?? ''} ${body?.data?.raw?.name ?? ''}` });
    } else {
      test.info().annotations.push({ type: 'note', description: `The document was already submitted earlier in this run (status ${doc.status}).` });
    }
    // The ERP order number is shown and the document cannot be submitted twice
    await expect(reviewPage.erpOrderMessage, 'ERP order').toContainText(/SAL-ORD-\d{4}-\d+/, { timeout: 60000 });
    await expect(reviewPage.statusBadge('Success')).toBeVisible();
    await expect(reviewPage.submitToErpButton, 'Submit to ERP button (submitted)').toBeDisabled();
  });
});
