import fs from 'fs';
import { test, expect } from '../../src/fixtures/test.fixture';
import { SifListPage, SifReviewPage, SifUploadPage, confirmDialog } from '../../src/pages/sif-conversion.page';
import { TOKEN, doc, parseSif, pdfFile, showSif } from '../sif-conversion/support/sif-data';
import { attachEvidence, readSmokeState, requires, trackErrors, updateSmokeState } from './support/smoke';

/*
 * Smoke 05: SIF Conversion, full flow (TC_SMOKE_030 - TC_SMOKE_034), as the Super Admin in its organization
 * riverstonetech (SIF Conversion enabled): list page, upload + extraction, review with an edit + Save, Convert to SIF
 * (the downloaded SIF holds the PO number and the edited Project), Download SIF, and Delete (the run's file).
 * The PO PDF is generated with known values (PO number, project, 3 lines): AUTO_SIF_<run>_SMK.pdf.
 */

const SMK = doc('SMK');
const EDITED_PROJECT = `Smoke Project ${TOKEN}`;

/** Opens the run's file on the review page through the ⋮ menu (its row button depends on the status) */
async function openReview(page: import('@playwright/test').Page): Promise<SifReviewPage> {
  const list = new SifListPage(page);
  await list.goto();
  await list.search(SMK.fileName);
  await list.openMenu(list.row(SMK.fileName));
  await list.menuItem('Review').click();
  await page.waitForURL(/\/sif-conversion\/[^/]+$/);
  const review = new SifReviewPage(page);
  await review.waitForLoaded();
  return review;
}

test.describe('Smoke 05: SIF Conversion (TC_SMOKE_030 - TC_SMOKE_034)', () => {
  test.describe.configure({ retries: 0 });

  test('TC_SMOKE_030: Verify that the SIF Conversion list page loads.', async ({ page }) => {
    const errors = trackErrors(page);
    const list = new SifListPage(page);
    await list.goto();
    await expect(list.title).toBeVisible();
    await expect(list.tab('All')).toBeVisible();
    await expect(list.tab('Ready for review')).toBeVisible();
    await expect(list.newConversionButton).toBeVisible();
    await expect(list.rows.first().or(list.emptyMessage).first()).toBeVisible();
    expect(errors, 'no page errors or server errors (5xx)').toEqual([]);
  });

  test('TC_SMOKE_031: Verify that a PO PDF can be uploaded and is extracted.', async ({ page }, testInfo) => {
    test.setTimeout(420_000);
    const upload = new SifUploadPage(page);
    await upload.goto();
    await upload.selectDocType('Purchase Order');
    await upload.chooseFile(await pdfFile('SMK'));
    await expect(upload.main.getByText(SMK.fileName, { exact: true })).toBeVisible();
    await expect(upload.uploadButton).toBeEnabled();
    await attachEvidence(page, testInfo, `1 - Upload page: ${SMK.fileName} chosen`);
    await upload.uploadAndExtract();
    updateSmokeState({ sifUploaded: true, sifReady: false, sifSaved: false, sifConverted: false });
    const list = new SifListPage(page);
    await list.waitForStatus(SMK.fileName, /^(Ready for review|Failed)$/, 300_000);
    const row = list.row(SMK.fileName);
    await expect(list.statusBadge(row)).toHaveText('Ready for review');
    await expect(list.lineItemsCell(row)).toHaveText(String(SMK.lines.length));
    updateSmokeState({ sifReady: true });
  });

  test('TC_SMOKE_032: Verify that the extracted data can be edited and saved on the review page.', async ({ page }) => {
    requires(readSmokeState().sifReady, 'the extracted file (TC_SMOKE_031)');
    const review = await openReview(page);
    await expect(review.fileName(SMK.fileName)).toBeVisible();
    await expect(review.field('PO Number')).toContainText(SMK.number);
    await expect(review.lineRows).toHaveCount(SMK.lines.length);
    await review.editField('Project', EDITED_PROJECT);
    await expect(review.saveButton).toBeEnabled();
    await review.save();
    updateSmokeState({ sifSaved: true });
    await expect(review.statusBadge('Reviewed')).toBeVisible();
    await expect(review.field('Project')).toContainText(EDITED_PROJECT);
  });

  test('TC_SMOKE_033: Verify that Convert to SIF downloads the SIF file with the reviewed data.', async ({ page }, testInfo) => {
    requires(readSmokeState().sifReady, 'the extracted file (TC_SMOKE_031)');
    const review = await openReview(page);
    const downloading = page.waitForEvent('download');
    const converted = page.waitForResponse((r) => /\/api\/convertToSif\//.test(r.url()));
    await review.convertButton.click();
    expect((await converted).status(), 'convertToSif API status').toBe(200);
    const download = await downloading;
    expect(download.suggestedFilename()).toBe(SMK.fileName.replace(/\.pdf$/, '.sif'));
    const file = testInfo.outputPath(download.suggestedFilename());
    await download.saveAs(file);
    await testInfo.attach(download.suggestedFilename(), { path: file, contentType: 'text/plain' });
    updateSmokeState({ sifConverted: true });
    await expect(review.statusBadge('Converted')).toBeVisible();
    // The SIF holds the PO number, the edited Project and the 3 lines
    const text = fs.readFileSync(file, 'utf8');
    const sif = parseSif(text);
    const get = (k: string) => sif.filter(([key]) => key === k).map(([, v]) => v);
    expect(get('P1'), 'PO number').toEqual([SMK.number]);
    if (readSmokeState().sifSaved) expect(get('P2'), 'edited Project').toEqual([EDITED_PROJECT]);
    expect(get('PN'), 'line items').toEqual(SMK.lines.map((l) => l.partNumber));
    await showSif(page, download.suggestedFilename(), text);
    await expect(page.locator('.sif-line[data-key="P1"]')).toContainText(SMK.number);
    await expect(page.locator('.sif-line[data-key="PN"]').first()).toContainText(SMK.lines[0].partNumber);
  });

  test('TC_SMOKE_034: Verify Download SIF from the list and Delete of the converted file.', async ({ page }, testInfo) => {
    requires(readSmokeState().sifConverted, 'the converted file (TC_SMOKE_033)');
    const list = new SifListPage(page);
    await list.goto();
    await list.search(SMK.fileName);
    const row = list.row(SMK.fileName);
    await expect(list.statusBadge(row)).toHaveText('Converted');
    const downloading = page.waitForEvent('download');
    await row.getByRole('button', { name: 'Download SIF' }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe(SMK.fileName.replace(/\.pdf$/, '.sif'));
    await attachEvidence(page, testInfo, '1 - Download SIF from the list');
    // Delete the run's file (confirmation dialog)
    await list.openMenu(row);
    await list.menuItem('Delete').click();
    const deleted = page.waitForResponse((r) => /\/api\/deleteSifConversion\//.test(r.url()));
    await confirmDialog(page).getByRole('button', { name: 'Delete', exact: true }).click();
    expect((await deleted).status(), 'deleteSifConversion API status').toBe(200);
    await expect(page.locator('[data-sonner-toast]').filter({ hasText: `${SMK.fileName} deleted.` })).toBeVisible();
    await expect(list.row(SMK.fileName)).toHaveCount(0);
  });
});
