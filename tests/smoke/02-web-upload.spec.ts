import path from 'path';
import { test, expect } from '../../src/fixtures/test.fixture';
import { DocumentsPage } from '../../src/pages/documents.page';
import { buildPurchaseOrderPdf, newToken } from '../po-quote-request/support/email-scenario';
import { readSmokeState, requires, successToast, uniqueCopy, updateSmokeState, uploadFromDashboard } from './support/smoke';

/*
 * Smoke 02: Web upload (TC_SMOKE_013 - TC_SMOKE_017). Upload New File from the Dashboard: a generated PO PDF (extracted,
 * reviewed and completed), a SIF as a Quote Request (client Riverstone Corp) and an XLSX Purchase Order.
 * Files keep unique AUTO_* names; the Documents library has no delete.
 */

const SIF = path.resolve(__dirname, '../../Riverstone test SIF Files/CDF_Carolina OS_Young Conway Furniture_SIF_260520_QA8.sif');
const XLSX = path.resolve(__dirname, '../../src/test-data/files/sample-po.xlsx');

test.describe('Smoke 02: Web upload (TC_SMOKE_013 - TC_SMOKE_017)', () => {
  test.describe.configure({ retries: 0 });

  test('TC_SMOKE_013: Verify that a Purchase Order PDF can be uploaded.', async ({ page }, testInfo) => {
    const po = await buildPurchaseOrderPdf(testInfo, newToken('SMK'));
    const fileName = await uploadFromDashboard(page, po.path, 'Purchase Order');
    updateSmokeState({ poFileName: fileName, reviewUrl: undefined });
    await expect(successToast(page, fileName)).toBeVisible({ timeout: 15000 });
  });

  test('TC_SMOKE_014: Verify that the uploaded document finishes extraction.', async ({ page }) => {
    const { poFileName } = readSmokeState();
    requires(poFileName, 'the PO uploaded by TC_SMOKE_013');
    test.setTimeout(420_000);
    const documents = new DocumentsPage(page);
    const row = documents.rowByName(poFileName!);
    await expect(async () => {
      await documents.navigate();
      await documents.searchDocument(poFileName!);
      await expect(documents.statusBadge(row)).toHaveText(/^Extracted$/i, { timeout: 5000 });
    }).toPass({ timeout: 360_000, intervals: [10_000, 15_000, 20_000] });
    await expect(documents.nameCell(row)).toContainText(poFileName!);
    await expect(documents.reviewButton(row)).toBeVisible();
  });

  test('TC_SMOKE_015: Verify that the uploaded document can be reviewed and completed.', async ({ page, reviewPage }, testInfo) => {
    const { poFileName } = readSmokeState();
    requires(poFileName, 'the PO uploaded by TC_SMOKE_013');
    const documents = new DocumentsPage(page);
    await documents.navigate();
    await documents.searchDocument(poFileName!);
    await documents.reviewButton(documents.rowByName(poFileName!)).click();
    await page.waitForURL(/\/review\//);
    await reviewPage.waitForReviewLoaded();
    updateSmokeState({ reviewUrl: page.url() });
    await expect(reviewPage.fileHeading(poFileName!)).toBeVisible();
    await expect(reviewPage.pageIndicator, 'the PDF is shown').toBeVisible();
    await expect(reviewPage.fieldCard('Customer Name')).toBeVisible();
    await expect(reviewPage.fieldCard('Purchase Order')).toBeVisible();
    await testInfo.attach('1 - Review page', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    // Complete
    const saved = page.waitForResponse((r) => r.url().includes('/api/updateDocument') && r.request().method() === 'POST');
    await reviewPage.completeButton.click();
    expect((await saved).status(), 'review saved').toBe(200);
    await expect(reviewPage.toast).toContainText('Document review completed and saved!');
    await expect(reviewPage.statusBadge('Reviewed')).toBeVisible();
  });

  test('TC_SMOKE_016: Verify that a SIF file can be uploaded as a Quote Request.', async ({ page }) => {
    const fileName = await uploadFromDashboard(page, uniqueCopy(SIF, 'SMOKE_SIF'), 'Quote Request');
    await expect(successToast(page, fileName)).toBeVisible({ timeout: 15000 });
  });

  test('TC_SMOKE_017: Verify that an XLSX Purchase Order can be uploaded.', async ({ page }) => {
    const fileName = await uploadFromDashboard(page, uniqueCopy(XLSX, 'SMOKE_XLSX'), 'Purchase Order');
    await expect(successToast(page, fileName)).toBeVisible({ timeout: 15000 });
  });
});
