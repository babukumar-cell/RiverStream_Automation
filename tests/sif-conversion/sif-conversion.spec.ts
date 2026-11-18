import fs from 'fs';
import path from 'path';
import { Page, TestInfo } from '@playwright/test';
import { test, expect } from '../../src/fixtures/test.fixture';
import { DocumentsPage } from '../../src/pages/documents.page';
import {
  HEADERS,
  REPLY_WAIT_MS,
  attachReply,
  newToken,
  showReply,
  showWaitingForReply,
  waitForResultReply,
} from '../po-quote-request/support/email-scenario';
// plain Playwright expect: waits without highlighting (keeps the evidence focused on the checked element)
import { expect as plainExpect } from '@playwright/test';
import { Config } from '../../src/config/environment';
import { LoginPage } from '../../src/pages/login.page';
import { LeftSidePage } from '../../src/pages/left-side.page';
import { DashboardPage, KpiNames } from '../../src/pages/dashboard.page';
import { OrganizationDetailsPage } from '../../src/pages/settings/organization-details.page';
import { SIF_COLUMNS, SIF_TABS, SifListPage, SifReviewPage, SifTab, SifUploadPage, confirmDialog } from '../../src/pages/sif-conversion.page';
import {
  ORG_USER,
  TOKEN,
  attachEvidence,
  cleanup,
  doc,
  ensureSetup,
  ensureConvertedQuote,
  SifDoc,
  invalidFile,
  outlineBox,
  parseSif,
  pdfFile,
  requires,
  asSuperAdmin,
  ensureSifOn,
  otherOrgsSif,
  setOrgSif,
  sifTemplateNames,
  sifOrgId,
  sifOrgName,
  showSif,
  sifSwitch,
  state,
} from './support/sif-data';

/*
 * Source: Test Cases/Module_Wise_Test_Cases/10_SIF_Conversion.xlsx (TC_SIF_001 - TC_SIF_083).
 * Runs in sheet order as riverstreamautomation@gmail.com in its organization (prepared by sif-user.setup.ts: an
 * organization is created with the user if it does not exist; SIF Conversion switched ON) on the suite's own PDFs
 * (AUTO_SIF_<run>_*, uploaded in beforeAll, deleted after the last case). TC_SIF_079 switches the SIF
 * Conversion setting of the user's organization off and back on.
 */

const PO = doc('PO');
const QR = doc('QR');
const CONV = doc('CONV');
const ACT = doc('ACT');

/** CSS color is red: rgb(r,g,b) with r dominant, or lab()/oklab()/oklch() with a clearly positive red-green axis */
function isRed(color: string): boolean {
  const n = (color.match(/-?[\d.]+/g) ?? []).map(Number);
  if (/^rgba?\(/.test(color)) return n[0] > 120 && n[0] > n[1] * 1.5 && n[0] > n[2] * 1.5;
  if (/^(ok)?lab\(/.test(color)) return n[1] > (color.startsWith('ok') ? 0.1 : 30);
  if (/^oklch\(/.test(color)) return n[1] > 0.1 && (n[2] < 45 || n[2] > 330);
  return false;
}

/** Every loaded row has the status of the tab and their number equals the tab count (or the empty message) */
async function expectTabRows(list: SifListPage, tab: SifTab): Promise<void> {
  await list.openTab(tab);
  const count = await list.tabCount(tab);
  if (count === 0) {
    await expect(list.rows).toHaveCount(0);
    await expect(list.emptyMessage).toBeVisible();
  } else {
    expect(await list.loadAllRows(), `rows listed = "${tab}" count`).toBe(count);
    if (tab !== 'All') {
      for (const status of await list.columnTexts((r) => list.statusBadge(r))) expect(status).toBe(tab);
    }
    await list.rows.first().scrollIntoViewIfNeeded();
    await expect(list.statusBadge(list.rows.first())).toBeVisible();
  }
  await expect(list.tab(tab)).toBeVisible();
}

test.describe('River Stream - SIF Conversion (TC_SIF_001 - TC_SIF_083)', () => {
  // In order on one worker; a step that needs an earlier one checks for its result (requires)
  test.describe.configure({ mode: 'default', retries: 0 });
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  test.beforeAll(async () => {
    test.setTimeout(600_000);
    await ensureSetup();
  });

  test.beforeEach(async () => {
    test.setTimeout(300_000);
  });

  test.afterAll(async () => {
    test.setTimeout(300_000);
    await cleanup();
  });

  // =========================================================================================
  // Access and layout
  // =========================================================================================

  test.describe('Sign-in', () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('TC_SIF_001: Verify that a logged-in organization user can view the SIF Conversion menu.', async ({ page, loginPage }) => {
      await loginPage.navigate();
      await loginPage.loginAndWaitForDashboard(ORG_USER.email, ORG_USER.password);
      // dashboard fully loaded before the evidence (plain expect: these checks are not highlighted)
      const dashboard = new DashboardPage(page);
      await dashboard.expectLoaded();
      for (const name of KpiNames) {
        await plainExpect(dashboard.kpiTab(name), `${name} card count`).toHaveText(new RegExp(`^\\s*${name}\\s*\\d[\\d,]*`), { timeout: 60000 });
      }
      await plainExpect(page.getByText(/^Loading documents/)).toHaveCount(0, { timeout: 60000 });
      // the Pending Review table has finished loading (its rows or its empty message)
      await plainExpect(page.locator('main table tbody tr').first().or(page.getByText('No documents in Pending Review right now.')).first()).toBeVisible({ timeout: 60000 });
      await page.waitForLoadState('networkidle');
      // the checked element, the only highlight in the evidence
      const shell = new LeftSidePage(page);
      await expect(shell.sidebar.getByText('SIF Conversion', { exact: true })).toBeVisible({ timeout: 30000 });
      // settle time so the end-of-test screenshot shows the fully rendered page
      await page.waitForTimeout(4000);
    });
  });

  test('TC_SIF_002: Verify that the SIF Conversion menu is accessible.', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    await new LeftSidePage(page).sidebar.getByText('SIF Conversion', { exact: true }).click();
    await page.waitForURL(/\/sif-conversion$/);
    const list = new SifListPage(page);
    await list.waitForList();
    // the file list has finished loading: rows and the "Showing N of N" footer
    await expect(list.rows.first()).toBeVisible();
    await expect(list.main.getByText(/^Showing \d+ of \d+$/)).toBeVisible({ timeout: 30000 });
    await page.waitForLoadState('networkidle');
    await expect(list.title).toBeVisible();
    // extra settle time so the end-of-test screenshot shows the fully rendered page
    await page.waitForTimeout(5000);
  });

  test('TC_SIF_003: Verify the SIF Conversion list page layout.', async ({ page }) => {
    const list = new SifListPage(page);
    await list.goto();
    await expect(list.title).toBeVisible();
    await expect(list.subtitle).toBeVisible();
    await expect(list.newConversionButton).toBeVisible();
    for (const tab of SIF_TABS) await expect(list.tab(tab)).toBeVisible();
    await expect(list.searchInput).toBeVisible();
    await expect(list.docTypeFilter).toHaveText('All document types');
    await expect(list.templateFilter).toHaveText('All templates');
    await expect(list.uploaderFilter).toHaveText('Anyone');
    await expect(list.headers.filter({ hasText: /\S/ })).toHaveText(SIF_COLUMNS);
  });

  // =========================================================================================
  // Status tabs
  // =========================================================================================

  test('TC_SIF_004: Verify that the "All" tab shows every file.', async ({ page }) => {
    const list = new SifListPage(page);
    await list.goto();
    await expectTabRows(list, 'All');
    const total = await list.tabCount('All');
    const sum = await Promise.all(SIF_TABS.slice(1).map((t) => list.tabCount(t)));
    expect(sum.reduce((a, b) => a + b, 0), 'All = sum of the status tabs').toBe(total);
  });

  test('TC_SIF_005: Verify the "Ready for review" tab filter.', async ({ page }) => {
    const list = new SifListPage(page);
    await list.goto();
    await expectTabRows(list, 'Ready for review');
  });

  test('TC_SIF_006: Verify the "Converted" tab filter.', async ({ page }) => {
    const list = new SifListPage(page);
    await list.goto();
    await expectTabRows(list, 'Converted');
  });

  test('TC_SIF_007: Verify the "Extracting" tab filter.', async ({ page }) => {
    const list = new SifListPage(page);
    await list.goto();
    await expectTabRows(list, 'Extracting');
  });

  test('TC_SIF_008: Verify the "Reviewed" tab filter.', async ({ page }) => {
    const list = new SifListPage(page);
    await list.goto();
    await expectTabRows(list, 'Reviewed');
  });

  // =========================================================================================
  // Search
  // =========================================================================================

  test('TC_SIF_009: Verify search by full file name.', async ({ page }) => {
    const list = new SifListPage(page);
    await list.goto();
    await list.search(PO.fileName);
    await expect(list.rows).toHaveCount(1);
    await expect(list.row(PO.fileName)).toBeVisible();
    await expect(list.searchInput).toHaveValue(PO.fileName);
  });

  test('TC_SIF_010: Verify search by partial file name.', async ({ page }) => {
    const list = new SifListPage(page);
    await list.goto();
    await list.search(TOKEN);
    await list.loadAllRows();
    const names = await list.columnTexts((r) => list.fileCell(r));
    expect(names.length, 'the suite files are found').toBeGreaterThanOrEqual(4);
    for (const n of names) expect(n).toContain(TOKEN);
    await expect(list.row(QR.fileName)).toBeVisible();
    await expect(list.searchInput).toHaveValue(TOKEN);
  });

  test('TC_SIF_011: Verify that search is case-insensitive.', async ({ page }) => {
    const list = new SifListPage(page);
    await list.goto();
    await list.search(TOKEN);
    await list.loadAllRows();
    const upper = (await list.columnTexts((r) => list.fileCell(r))).sort();
    await list.search(TOKEN.toLowerCase());
    await list.loadAllRows();
    expect((await list.columnTexts((r) => list.fileCell(r))).sort(), 'same results as TC_SIF_010').toEqual(upper);
    await expect(list.searchInput).toHaveValue(TOKEN.toLowerCase());
    await expect(list.row(PO.fileName)).toBeVisible();
  });

  test('TC_SIF_012: Verify search with no match.', async ({ page }) => {
    const list = new SifListPage(page);
    await list.goto();
    await list.search('xyz123');
    await expect(list.rows).toHaveCount(0);
    await expect(list.emptyMessage).toBeVisible();
  });

  test('TC_SIF_013: Verify clearing the search.', async ({ page }) => {
    const list = new SifListPage(page);
    await list.goto();
    const all = await list.tabCount('All');
    await list.search(TOKEN);
    await list.search('');
    await expect(list.searchInput).toHaveValue('');
    expect(await list.loadAllRows(), 'full list back').toBe(all);
    await list.rows.first().scrollIntoViewIfNeeded();
    await expect(list.searchInput).toBeVisible();
  });

  // =========================================================================================
  // Filters
  // =========================================================================================

  test('TC_SIF_014: Verify the Document type filter options.', async ({ page }) => {
    const list = new SifListPage(page);
    await list.goto();
    await expect(list.docTypeFilter).toHaveText('All document types');
    const listbox = await list.openFilter(list.docTypeFilter);
    await expect(listbox.getByRole('option')).toHaveText(['All document types', 'Quote Request', 'Purchase Order']);
    await expect(listbox.getByRole('option', { name: 'All document types' })).toHaveAttribute('data-state', 'checked');
  });

  for (const [id, type, code] of [['015', 'Quote Request', 'QR'], ['016', 'Purchase Order', 'PO']] as const) {
    test(`TC_SIF_${id}: Verify the filter by ${type}.`, async ({ page }) => {
      const list = new SifListPage(page);
      await list.goto();
      await list.selectFilter(list.docTypeFilter, type);
      await list.loadAllRows();
      const types = await list.columnTexts((r) => list.typeCell(r));
      expect(types.length).toBeGreaterThan(0);
      for (const t of types) expect(t).toBe(`${code} ${type}`);
      await list.rows.first().scrollIntoViewIfNeeded();
      await expect(list.typeCell(list.rows.first())).toContainText(type);
      await expect(list.docTypeFilter).toHaveText(type);
    });
  }

  test('TC_SIF_017: Verify the Template filter options.', async ({ page }) => {
    // the filter offers the templates available to the user's organization.
    // Files of other organizations (e.g. MBM) can use their own templates, which are not listed.
    const available = await sifTemplateNames();
    const list = new SifListPage(page);
    await list.goto();
    const listbox = await list.openFilter(list.templateFilter);
    await expect(listbox.getByRole('option', { name: 'All templates' })).toHaveAttribute('data-state', 'checked');
    const options = (await listbox.getByRole('option').allInnerTexts()).map((o) => o.trim());
    test.info().annotations.push({ type: 'Templates', description: `filter: ${options.join(', ')} | available to ${sifOrgName()}: ${available.join(', ')}` });
    expect(options.slice(1).sort(), `the filter offers the templates available to ${sifOrgName()}`).toEqual([...available].sort());
    for (const name of available) await expect(listbox.getByRole('option', { name, exact: true })).toBeVisible();
  });

  test('TC_SIF_018: Verify the filter by a template.', async ({ page }) => {
    const list = new SifListPage(page);
    await list.goto();
    await list.selectFilter(list.templateFilter, 'Default QR');
    await list.loadAllRows();
    const templates = await list.columnTexts((r) => list.templateCell(r));
    expect(templates.length).toBeGreaterThan(0);
    for (const t of templates) expect(t).toMatch(/^Default QR/);
    await list.rows.first().scrollIntoViewIfNeeded();
    await expect(list.templateCell(list.rows.first())).toContainText('Default QR');
    await expect(list.templateFilter).toHaveText('Default QR');
  });

  test('TC_SIF_019: Verify the Uploaded by filter options.', async ({ page }) => {
    const list = new SifListPage(page);
    await list.goto();
    await expect(list.uploaderFilter).toHaveText('Anyone');
    const listbox = await list.openFilter(list.uploaderFilter);
    await expect(listbox.getByRole('option')).toHaveText(['Anyone', 'Uploaded by me']);
    await expect(listbox.getByRole('option', { name: 'Anyone' })).toHaveAttribute('data-state', 'checked');
  });

  test.describe('Uploaded by me (own sign-in)', () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('TC_SIF_020: Verify the filter "Uploaded by me".', async ({ page, loginPage }) => {
      await loginPage.navigate();
      await loginPage.loginAndWaitForDashboard(ORG_USER.email, ORG_USER.password);
      await new LeftSidePage(page).sidebar.getByText('SIF Conversion', { exact: true }).click();
      const list = new SifListPage(page);
      await list.waitForList();
      await list.selectFilter(list.uploaderFilter, 'Uploaded by me');
      await list.loadAllRows();
      const uploaders = await list.columnTexts((r) => list.uploadedByCell(r));
      expect(uploaders.length).toBeGreaterThan(0);
      for (const u of uploaders) expect(u).toBe(ORG_USER.name);
      await list.rows.first().scrollIntoViewIfNeeded();
      await expect(list.uploadedByCell(list.rows.first())).toHaveText(ORG_USER.name);
      await expect(list.uploaderFilter).toHaveText('Uploaded by me');
    });
  });

  test('TC_SIF_021: Verify combined filters.', async ({ page }) => {
    const list = new SifListPage(page);
    await list.goto();
    await list.openTab('Converted');
    await list.selectFilter(list.docTypeFilter, 'Quote Request');
    await list.selectFilter(list.uploaderFilter, 'Uploaded by me');
    const n = await list.loadAllRows();
    if (n === 0) {
      await expect(list.emptyMessage).toBeVisible();
    } else {
      for (let i = 0; i < n; i++) {
        const row = list.rows.nth(i);
        await expect(list.statusBadge(row)).toHaveText('Converted');
        await expect(list.typeCell(row)).toContainText('Quote Request');
        await expect(list.uploadedByCell(row)).toHaveText(ORG_USER.name);
      }
    }
    await expect(list.docTypeFilter).toHaveText('Quote Request');
    await expect(list.uploaderFilter).toHaveText('Uploaded by me');
  });

  test('TC_SIF_022: Verify resetting the filters.', async ({ page }) => {
    const list = new SifListPage(page);
    await list.goto();
    const all = await list.tabCount('All');
    await list.selectFilter(list.docTypeFilter, 'Purchase Order');
    await list.selectFilter(list.templateFilter, 'Default PO');
    await list.selectFilter(list.uploaderFilter, 'Uploaded by me');
    await list.selectFilter(list.docTypeFilter, 'All document types');
    await list.selectFilter(list.templateFilter, 'All templates');
    await list.selectFilter(list.uploaderFilter, 'Anyone');
    expect(await list.loadAllRows(), 'full list').toBe(all);
    await list.rows.first().scrollIntoViewIfNeeded();
    await expect(list.docTypeFilter).toHaveText('All document types');
    await expect(list.templateFilter).toHaveText('All templates');
    await expect(list.uploaderFilter).toHaveText('Anyone');
  });

  // =========================================================================================
  // Row actions
  // =========================================================================================

  test('TC_SIF_023: Verify the status badge colors.', async ({ page }) => {
    // the list as it opens (no search): the first file of each status
    const list = new SifListPage(page);
    await list.goto();
    await plainExpect(list.rows.first()).toBeVisible({ timeout: 30000 });
    const firstWith = (status: string) =>
      list.rows.filter({ has: page.locator('span.rounded-full, div.rounded-full', { hasText: new RegExp(`^${status}$`) }) }).first();
    const converted = list.statusBadge(firstWith('Converted'));
    const ready = list.statusBadge(firstWith('Ready for review'));
    const failed = list.statusBadge(firstWith('Failed'));
    await plainExpect(converted, 'a Converted file in the list').toBeVisible({ timeout: 30000 });
    await plainExpect(ready, 'a Ready for review file in the list').toBeVisible({ timeout: 30000 });
    await plainExpect(failed, 'a Failed file in the list').toBeVisible({ timeout: 30000 });
    await expect(converted).toHaveText('Converted');
    await expect(converted).toHaveClass(/bg-green-50/);
    await expect(converted).toHaveClass(/text-green-700/);
    await expect(ready).toHaveText('Ready for review');
    await expect(ready).toHaveClass(/bg-amber-50/);
    await expect(ready).toHaveClass(/text-amber-700/);
    await expect(failed).toHaveText('Failed');
    await expect(failed).toHaveClass(/bg-red-50/);
    await expect(failed).toHaveClass(/text-red-700/);
  });

  test('TC_SIF_024: Verify Download SIF from the list.', async ({ page }, testInfo) => {
    const list = new SifListPage(page);
    await list.goto();
    await list.search(CONV.fileName);
    const row = list.row(CONV.fileName);
    const downloading = page.waitForEvent('download');
    await row.getByRole('button', { name: 'Download SIF' }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe(CONV.fileName.replace(/\.pdf$/, '.sif'));
    const file = testInfo.outputPath(download.suggestedFilename());
    await download.saveAs(file);
    await testInfo.attach(download.suggestedFilename(), { path: file, contentType: 'text/plain' });
    await expect(row.getByRole('button', { name: 'Download SIF' })).toBeVisible();
    await attachEvidence(page, testInfo, '1 - Download SIF button');

    const text = fs.readFileSync(file, 'utf8');
    const sif = parseSif(text);
    expect(sif.find(([k]) => k === 'P1')?.[1], 'P1 = PO number').toBe(CONV.number);
    expect(sif.filter(([k]) => k === 'PN').map(([, v]) => v), 'one PN per line item').toEqual(CONV.lines.map((l) => l.partNumber));
    expect(sif.filter(([k]) => k === 'QT').map(([, v]) => Number(v)), 'quantities').toEqual(CONV.lines.map((l) => l.qty));
    await showSif(page, download.suggestedFilename(), text);
    await expect(page.locator('.sif-line[data-key="P1"]')).toContainText(CONV.number);
    for (const l of CONV.lines) await expect(page.locator('.sif-line[data-key="PN"]').filter({ hasText: l.partNumber })).toBeVisible();
  });

  test('TC_SIF_025: Verify the Review button.', async ({ page }) => {
    const list = new SifListPage(page);
    await list.goto();
    await list.search(QR.fileName);
    await list.row(QR.fileName).getByRole('button', { name: 'Review' }).click();
    await page.waitForURL(/\/sif-conversion\/[^/]+$/);
    const review = new SifReviewPage(page);
    await review.waitForLoaded();
    await expect(review.fileName(QR.fileName)).toBeVisible();
    await expect(review.field('Project')).toContainText(QR.project);
    await expect(review.lineRows.first()).toContainText(QR.lines[0].partNumber);
  });

  test('TC_SIF_026: Verify the kebab (⋮) menu options.', async ({ page }) => {
    const list = new SifListPage(page);
    await list.goto();
    await list.search(QR.fileName);
    await list.openMenu(list.row(QR.fileName));
    await expect(page.getByRole('menuitem')).toHaveText(['Review', 'Re-run extraction', 'Download original PDF', 'Delete']);
    const deleteColor = await list.menuItem('Delete').evaluate((e) => getComputedStyle(e).color);
    test.info().annotations.push({ type: 'Delete color', description: deleteColor });
    expect(isRed(deleteColor), `Delete is shown in red (${deleteColor})`).toBe(true);
    await expect(list.menuItem('Delete')).toBeVisible();
  });

  test('TC_SIF_027: Verify Review from the kebab menu.', async ({ page }) => {
    const list = new SifListPage(page);
    await list.goto();
    await list.search(QR.fileName);
    await list.openMenu(list.row(QR.fileName));
    await list.menuItem('Review').click();
    await page.waitForURL(/\/sif-conversion\/[^/]+$/);
    const review = new SifReviewPage(page);
    await review.waitForLoaded();
    await expect(review.fileName(QR.fileName)).toBeVisible();
  });

  test('TC_SIF_028: Verify Re-run extraction.', async ({ page }) => {
    const list = new SifListPage(page);
    await list.goto();
    const extractingBefore = await list.tabCount('Extracting');
    await list.search(ACT.fileName);
    const row = list.row(ACT.fileName);
    await list.openMenu(row);
    await list.menuItem('Re-run extraction').click();
    const dialog = confirmDialog(page);
    await expect(dialog.getByRole('heading', { name: 'Re-run extraction' }).last()).toBeVisible();
    await expect(dialog).toContainText(`Extract ${ACT.fileName} again?`);
    const rerun = page.waitForResponse((r) => /\/api\/rerunSifExtraction\//.test(r.url()));
    await dialog.getByRole('button', { name: 'Re-run', exact: true }).click();
    expect((await rerun).status(), 'rerunSifExtraction API status').toBe(200);
    await expect(list.statusBadge(row)).toHaveText('Extracting', { timeout: 15000 });
    await expect(list.tab('Extracting')).toHaveText(new RegExp(`Extracting\\s*${extractingBefore + 1}$`), { timeout: 15000 });
    await expect(list.statusBadge(row)).toHaveText(/^(Ready for review|Failed)$/, { timeout: 180000 });
    await expect(list.statusBadge(row)).toHaveText('Ready for review');
  });

  test('TC_SIF_029: Verify Download original PDF.', async ({ page }, testInfo) => {
    requires(!state.actDeleted, 'the file AUTO_SIF_<run>_ACT (deleted by TC_SIF_031)');
    const list = new SifListPage(page);
    await list.goto();
    await list.search(ACT.fileName);
    const row = list.row(ACT.fileName);
    await list.openMenu(row);
    const downloading = page.waitForEvent('download');
    await list.menuItem('Download original PDF').click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe(ACT.fileName);
    const file = testInfo.outputPath(download.suggestedFilename());
    await download.saveAs(file);
    expect(fs.readFileSync(file).equals(fs.readFileSync(await pdfFile('ACT'))), 'same content as the uploaded PDF').toBe(true);
    await testInfo.attach(download.suggestedFilename(), { path: file, contentType: 'application/pdf' });
    await expect(list.fileCell(row)).toContainText(ACT.fileName);
  });

  test('TC_SIF_030: Verify the Delete confirmation.', async ({ page }) => {
    const list = new SifListPage(page);
    await list.goto();
    await list.search(ACT.fileName);
    await list.openMenu(list.row(ACT.fileName));
    await list.menuItem('Delete').click();
    const dialog = confirmDialog(page);
    await expect(dialog.getByRole('heading', { name: 'Delete conversion' }).last()).toBeVisible();
    await expect(dialog.getByText(`Delete ${ACT.fileName}? It will no longer appear in the list.`)).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Delete', exact: true })).toBeVisible();
  });

  test('TC_SIF_031: Verify Delete with confirmation.', async ({ page }) => {
    const list = new SifListPage(page);
    await list.goto();
    const allBefore = await list.tabCount('All');
    await list.search(ACT.fileName);
    await list.openMenu(list.row(ACT.fileName));
    await list.menuItem('Delete').click();
    const deleted = page.waitForResponse((r) => /\/api\/deleteSifConversion\//.test(r.url()));
    await confirmDialog(page).getByRole('button', { name: 'Delete', exact: true }).click();
    expect((await deleted).status(), 'deleteSifConversion API status').toBe(200);
    state.actDeleted = true;
    await expect(page.locator('[data-sonner-toast]').filter({ hasText: `${ACT.fileName} deleted.` })).toBeVisible();
    await expect(list.row(ACT.fileName)).toHaveCount(0);
    await list.search('');
    await expect(list.tab('All')).toHaveText(new RegExp(`All\\s*${allBefore - 1}$`), { timeout: 20000 });
  });

  test('TC_SIF_032: Verify Delete with Cancel.', async ({ page }) => {
    // the file is picked from the list itself (no search), so the evidence shows the full list after Cancel
    const list = new SifListPage(page);
    await list.goto();
    await list.loadAllRows();
    const row = list.row(QR.fileName);
    await row.scrollIntoViewIfNeeded();
    await list.openMenu(row);
    await list.menuItem('Delete').click();
    const dialog = confirmDialog(page);
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(row).toHaveCount(1);
    await expect(list.fileCell(row)).toContainText(QR.fileName);
    await expect(list.statusBadge(row)).toHaveText('Ready for review');
  });

  test('TC_SIF_033: Verify closing the kebab menu.', async ({ page }) => {
    const list = new SifListPage(page);
    await list.goto();
    await list.search(QR.fileName);
    await list.openMenu(list.row(QR.fileName));
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toBeHidden();
    await expect(confirmDialog(page)).toBeHidden();
    await expect(page).toHaveURL(/\/sif-conversion$/);
    await expect(list.kebab(list.row(QR.fileName))).toBeVisible();
  });

  test('TC_SIF_034: Verify the New conversion button.', async ({ page }) => {
    const list = new SifListPage(page);
    await list.goto();
    await list.newConversionButton.click();
    await page.waitForURL(/\/sif-conversion\/upload$/);
    await expect(new SifUploadPage(page).heading).toBeVisible();
  });

  // =========================================================================================
  // New conversion page and Preview fields
  // =========================================================================================

  test('TC_SIF_035: Verify the New conversion page layout.', async ({ page }) => {
    const list = new SifListPage(page);
    await list.goto();
    await list.newConversionButton.click();
    const upload = new SifUploadPage(page);
    await upload.waitForReady();
    await expect(upload.heading).toBeVisible();
    await expect(upload.subtitle).toBeVisible();
    await expect(upload.docTypeSelect).toBeVisible();
    await expect(upload.templateSelect).toBeVisible();
    await expect(upload.previewFieldsButton).toBeVisible();
    await expect(upload.dropZone).toBeVisible();
    await expect(upload.chooseFileButton).toBeVisible();
    await expect(upload.acceptedText).toBeVisible();
  });

  test('TC_SIF_036: Verify the default state of the dropdowns.', async ({ page }) => {
    const upload = new SifUploadPage(page);
    await upload.goto();
    await expect(upload.docTypeSelect).toHaveText('Choose a document type');
    await expect(upload.templateSelect).toHaveText('Choose a document type first');
    await expect(upload.templateSelect).toBeDisabled();
  });

  test('TC_SIF_037: Verify the Document type options.', async ({ page }) => {
    const upload = new SifUploadPage(page);
    await upload.goto();
    await upload.docTypeSelect.click();
    await expect(page.getByRole('option')).toHaveText(['Purchase Order', 'Quote Request']);
  });

  for (const [id, type, template] of [['038', 'Purchase Order', 'Default PO'], ['039', 'Quote Request', 'Default QR']] as const) {
    test(`TC_SIF_${id}: Verify selecting ${type}.`, async ({ page }) => {
      const upload = new SifUploadPage(page);
      await upload.goto();
      await upload.selectDocType(type);
      await expect(upload.docTypeSelect).toHaveText(type);
      await expect(upload.templateSelect).toBeEnabled();
      await expect(upload.templateSelect).toHaveText(template);
    });
  }

  test('TC_SIF_040: Verify the default template for Quote Request.', async ({ page }) => {
    const upload = new SifUploadPage(page);
    await upload.goto();
    await upload.selectDocType('Quote Request');
    // Default QR is selected automatically
    await expect(upload.templateSelect).toHaveText('Default QR');
    const listbox = await upload.openTemplates();
    // the option list: group "Default" with Default QR, which is the selected option
    await expect(listbox).toContainText(/^Default\s*Default QR/);
    const defaultQr = listbox.getByRole('option', { name: 'Default QR', exact: true });
    await expect(defaultQr).toHaveAttribute('aria-selected', 'true');
    await expect(defaultQr).toBeVisible();
  });

  test('TC_SIF_041: Verify the Preview fields data for Default QR.', async ({ page }) => {
    const upload = new SifUploadPage(page);
    await upload.goto();
    await upload.selectDocType('Quote Request');
    await upload.openPreview();
    await expect(upload.previewTitle).toContainText('Default QR');
    await expect(upload.previewDialog.locator('thead th')).toHaveText(['Field', 'SIF key', 'Level', 'Type', 'What is extracted'], { ignoreCase: true });
    const expected: [string, string, string, string][] = [
      ['Project', 'P1', 'Document', 'Text'],
      ['Part Number', 'PN', 'Product line', 'Text'],
      ['Option List Price', 'OL', 'Option / finish', 'Price'],
    ];
    for (const [field, key, level, type] of expected) {
      const cells = upload.previewRow(field).locator('td');
      await expect(cells.nth(1)).toHaveText(key);
      await expect(cells.nth(2)).toHaveText(level, { ignoreCase: true }); // shown capitalized by CSS
      await expect(cells.nth(3)).toHaveText(type, { ignoreCase: true });
    }
  });

  test('TC_SIF_042: Verify that required fields are marked.', async ({ page }) => {
    const upload = new SifUploadPage(page);
    await upload.goto();
    await upload.selectDocType('Quote Request');
    await upload.openPreview();
    for (const field of ['Part Number', 'Description', 'Qty']) {
      const first = upload.previewRow(field).locator('td').first();
      await expect(first).toHaveText(`${field}*`);
      const star = first.locator('*').filter({ hasText: /^\*$/ }).last();
      const color = await star.evaluate((e) => getComputedStyle(e).color);
      expect(isRed(color), `${field}: the asterisk is red (${color})`).toBe(true);
      await expect(star).toBeVisible();
    }
    await expect(upload.previewRow('Project').locator('td').first()).toHaveText('Project');
  });

  test('TC_SIF_043: Verify that the preview is view-only.', async ({ page }) => {
    const upload = new SifUploadPage(page);
    await upload.goto();
    await upload.selectDocType('Quote Request');
    await upload.openPreview();
    await expect(upload.previewDialog.locator('input, textarea, select, [contenteditable="true"]')).toHaveCount(0);
    await upload.previewRow('Project').locator('td').nth(1).click();
    await expect(upload.previewDialog.locator('input, textarea, select, [contenteditable="true"]')).toHaveCount(0);
    await expect(upload.previewDialog.getByText(/\(view only\)/)).toBeVisible();
  });

  test('TC_SIF_044: Verify the preview of Default PO.', async ({ page }) => {
    const upload = new SifUploadPage(page);
    await upload.goto();
    await upload.selectDocType('Purchase Order');
    await upload.openPreview();
    await expect(upload.previewTitle).toContainText('Default PO');
    const po = upload.previewRow('PO Number').locator('td');
    await expect(po.nth(1)).toHaveText('P1');
    await expect(po.nth(2)).toHaveText('Document', { ignoreCase: true });
  });

  test('TC_SIF_045: Verify closing the preview.', async ({ page }) => {
    const upload = new SifUploadPage(page);
    await upload.goto();
    await upload.selectDocType('Quote Request');
    await upload.openPreview();
    await upload.previewDialog.getByRole('button', { name: 'Close' }).first().click();
    await expect(upload.previewDialog).toBeHidden();
    await expect(upload.docTypeSelect).toHaveText('Quote Request');
    await expect(upload.templateSelect).toHaveText('Default QR');
  });

  // =========================================================================================
  // Upload
  // =========================================================================================

  test('TC_SIF_046: Verify uploading a PDF with "Choose File".', async ({ page }, testInfo) => {
    const upload = new SifUploadPage(page);
    await upload.goto();
    await upload.selectDocType('Purchase Order');
    const chooser = page.waitForEvent('filechooser');
    await upload.chooseFileButton.click();
    await (await chooser).setFiles(await pdfFile('UP1'));
    // evidence on the upload page: the chosen file is shown, ready for Upload and Extract
    await expect(upload.main.getByText(doc('UP1').fileName, { exact: true })).toBeVisible();
    await expect(upload.uploadButton).toBeEnabled();
    await attachEvidence(page, testInfo, `1 - Upload page: ${doc('UP1').fileName} chosen`);
    await upload.uploadAndExtract();
    const list = new SifListPage(page);
    await list.waitForList();
    const row = list.row(doc('UP1').fileName);
    await expect(row).toBeVisible();
    await expect(list.statusBadge(row)).toHaveText(/^(Extracting|Ready for review)$/);
    await expect(list.statusBadge(row)).toHaveText('Extracting');
  });

  test('TC_SIF_047: Verify uploading a PDF by drag and drop.', async ({ page }) => {
    const upload = new SifUploadPage(page);
    await upload.goto();
    await upload.selectDocType('Purchase Order');
    const d = doc('DND');
    const bytes = fs.readFileSync(await pdfFile('DND')).toString('base64');
    const transfer = await page.evaluateHandle(({ b64, name }) => {
      const data = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([data], name, { type: 'application/pdf' }));
      return dt;
    }, { b64: bytes, name: d.fileName });
    await expect(upload.dropZone).toHaveClass(/bg-blue-50/);
    await upload.dropZone.dispatchEvent('dragenter', { dataTransfer: transfer });
    await upload.dropZone.dispatchEvent('dragover', { dataTransfer: transfer });
    await expect(upload.dropZone, 'highlighted while dragging').toHaveClass(/bg-blue-100/);
    await upload.dropZone.dispatchEvent('drop', { dataTransfer: transfer });
    await expect(upload.main.getByText(d.fileName, { exact: true })).toBeVisible();
    await expect(upload.removeFileButton).toBeVisible();
    await expect(upload.uploadButton).toBeEnabled();
  });

  test('TC_SIF_048: Verify uploading a file that is not a PDF.', async ({ page }) => {
    const upload = new SifUploadPage(page);
    await upload.goto();
    await upload.selectDocType('Purchase Order');
    for (const kind of ['docx', 'jpg'] as const) {
      await upload.chooseFile(invalidFile(kind));
      await expect(upload.message('Only PDF files can be converted.')).toBeVisible();
      await expect(upload.uploadButton).toHaveCount(0);
      await expect(upload.removeFileButton).toHaveCount(0);
    }
  });

  test('TC_SIF_049: Verify uploading a file larger than 25MB.', async ({ page }) => {
    const upload = new SifUploadPage(page);
    await upload.goto();
    await upload.selectDocType('Purchase Order');
    await upload.chooseFile(invalidFile('30MB'));
    await expect(upload.message('The PDF is larger than 25 MB.')).toBeVisible();
    await expect(upload.uploadButton).toHaveCount(0);
  });

  test('TC_SIF_050: Verify uploading a file of exactly 25MB.', async ({ page }) => {
    test.setTimeout(600_000); // 25 MB go up as ~33 MB of JSON: minutes on a slow connection
    const upload = new SifUploadPage(page);
    await upload.goto();
    await upload.selectDocType('Purchase Order');
    const d = doc('25MB');
    await upload.chooseFile(await pdfFile('25MB'));
    await expect(upload.main.getByText(d.fileName, { exact: true })).toBeVisible();
    await expect(upload.main.getByText('25.00 MB', { exact: true })).toBeVisible();
    await upload.uploadAndExtract(420_000);
    const list = new SifListPage(page);
    await list.waitForList();
    await expect(list.row(d.fileName)).toBeVisible();
  });

  test('TC_SIF_051: Verify uploading an empty PDF.', async ({ page }) => {
    const upload = new SifUploadPage(page);
    await upload.goto();
    await upload.selectDocType('Purchase Order');
    await upload.chooseFile(invalidFile('empty'));
    await expect(upload.message('This file is empty.')).toBeVisible();
    await expect(upload.uploadButton).toHaveCount(0);
  });

  test('TC_SIF_052: Verify Back to SIF Conversion.', async ({ page }) => {
    const list = new SifListPage(page);
    await list.goto();
    const all = await list.tabCount('All');
    const upload = new SifUploadPage(page);
    await list.newConversionButton.click();
    await upload.waitForReady();
    await expect(upload.heading).toBeVisible();
    await upload.backLink.click();
    await page.waitForURL(/\/sif-conversion$/);
    await list.waitForList();
    await expect(list.tab('All')).toHaveText(new RegExp(`All\\s*${all}$`));
  });

  test('TC_SIF_053: Verify that the Remove button appears after choosing a file.', async ({ page }) => {
    const upload = new SifUploadPage(page);
    await upload.goto();
    await upload.selectDocType('Purchase Order');
    await upload.chooseFile(await pdfFile('UP2'));
    await expect(upload.main.getByText(doc('UP2').fileName, { exact: true })).toBeVisible();
    await expect(upload.main.getByText(/^\d+\.\d{2} MB$/)).toBeVisible();
    await expect(upload.removeFileButton).toBeVisible();
  });

  test('TC_SIF_054: Verify removing the chosen file.', async ({ page }) => {
    const upload = new SifUploadPage(page);
    await upload.goto();
    await upload.selectDocType('Purchase Order');
    await upload.chooseFile(await pdfFile('UP2'));
    await upload.removeFileButton.click();
    await expect(upload.main.getByText(doc('UP2').fileName, { exact: true })).toHaveCount(0);
    await expect(upload.uploadButton).toHaveCount(0);
    await expect(upload.main.getByText('Drag and drop your PDF here', { exact: true })).toBeVisible();
    await expect(upload.chooseFileButton).toBeVisible();
  });

  test('TC_SIF_055: Verify choosing a new file after removing one.', async ({ page }) => {
    const upload = new SifUploadPage(page);
    await upload.goto();
    await upload.selectDocType('Purchase Order');
    await upload.chooseFile(await pdfFile('UP2'));
    await upload.removeFileButton.click();
    await upload.chooseFile(await pdfFile('UP1'));
    await expect(upload.main.getByText(doc('UP2').fileName, { exact: true })).toHaveCount(0);
    await expect(upload.main.getByText(doc('UP1').fileName, { exact: true })).toBeVisible();
    await expect(upload.uploadButton).toBeEnabled();
  });

  // =========================================================================================
  // Extraction
  // =========================================================================================

  test('TC_SIF_056: Verify the status Extracting.', async ({ page }) => {
    const list = new SifListPage(page);
    // earlier uploads (TC_SIF_056) finish first, so the count below only changes for this file
    await expect(async () => {
      await list.goto();
      expect(await list.tabCount('Extracting')).toBe(0);
    }).toPass({ timeout: 180000, intervals: [3000, 5000] });
    const before = await list.tabCount('Extracting');
    const upload = new SifUploadPage(page);
    await list.newConversionButton.click();
    await upload.waitForReady();
    await upload.selectDocType('Purchase Order');
    await upload.chooseFile(await pdfFile('UP3'));
    await upload.uploadAndExtract();
    state.up3Uploaded = true;
    await list.waitForList();
    const row = list.row(doc('UP3').fileName);
    await expect(list.statusBadge(row)).toHaveText('Extracting');
    await expect(row.getByText('Processing...')).toBeVisible();
    await expect(list.tab('Extracting')).toHaveText(new RegExp(`Extracting\\s*${before + 1}$`), { timeout: 15000 });
  });

  test('TC_SIF_057: Verify the status Ready for review.', async ({ page }) => {
    requires(state.up3Uploaded, 'the upload of TC_SIF_056');
    const list = new SifListPage(page);
    await list.waitForStatus(doc('UP3').fileName, /^(Ready for review|Failed)$/);
    const row = list.row(doc('UP3').fileName);
    await expect(list.statusBadge(row)).toHaveText('Ready for review');
    await expect(list.lineItemsCell(row)).toHaveText(String(doc('UP3').lines.length));
    await expect(row.getByRole('button', { name: 'Review' })).toBeVisible();
    await expect(list.tab('Ready for review')).toBeVisible();
  });

  test('TC_SIF_058: Verify a failed extraction.', async ({ page }) => {
    const list = new SifListPage(page);
    await list.goto();
    const before = await list.tabCount('Failed');
    await list.newConversionButton.click();
    const upload = new SifUploadPage(page);
    await upload.waitForReady();
    await upload.selectDocType('Quote Request');
    await upload.chooseFile(await pdfFile('BAD'));
    await upload.uploadAndExtract();
    state.badUploaded = true;
    await list.waitForStatus(doc('BAD').fileName, /^(Failed|Ready for review)$/, 120000);
    await list.search('');
    await expect(list.tab('Failed')).toHaveText(new RegExp(`Failed\\s*${before + 1}$`), { timeout: 20000 });
    await list.search(doc('BAD').fileName);
    await expect(list.statusBadge(list.row(doc('BAD').fileName))).toHaveText('Failed');
  });

  // =========================================================================================
  // Review page (suite PO file)
  // =========================================================================================

  async function openPoReview(page: import('@playwright/test').Page): Promise<SifReviewPage> {
    // the row button depends on the status (Review / Download SIF ...): the ⋮ menu always has Review
    const list = new SifListPage(page);
    await list.goto();
    await list.search(PO.fileName);
    await list.openMenu(list.row(PO.fileName));
    await list.menuItem('Review').click();
    await page.waitForURL(/\/sif-conversion\/[^/]+$/);
    const review = new SifReviewPage(page);
    await review.waitForLoaded();
    return review;
  }

  test('TC_SIF_059: Verify that the Review button opens the Review page.', async ({ page }) => {
    const review = await openPoReview(page);
    await expect(page.getByText('PURCHASE ORDER', { exact: true }).first()).toBeVisible(); // PDF (left)
    await expect(review.extractedTab).toBeVisible(); // extracted data (right)
    await expect(review.field('PO Number')).toContainText(PO.number);
  });

  test('TC_SIF_060: Verify the Review page header.', async ({ page }) => {
    const review = await openPoReview(page);
    await expect(review.backButton).toBeVisible();
    await expect(review.fileName(PO.fileName)).toBeVisible();
    await expect(review.subtitle).toHaveText('Purchase Order · Template: Default PO');
    await expect(review.statusBadge('Ready for review')).toBeVisible();
    await expect(review.saveButton).toBeDisabled();
    await expect(review.convertButton).toBeEnabled();
  });

  test('TC_SIF_061: Verify the PDF preview.', async ({ page }) => {
    await openPoReview(page);
    const first = page.getByText('PURCHASE ORDER', { exact: true }).first();
    const last = page.getByText(PO.lines[PO.lines.length - 1].description, { exact: true }).first();
    await expect(first).toBeVisible();
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeVisible();
    await expect(page.getByText(`PO Number: ${PO.number}`).first()).toBeVisible();
  });

  test('TC_SIF_062: Verify that Extracted Data is selected by default.', async ({ page }) => {
    const review = await openPoReview(page);
    await expect(review.extractedTab).toHaveAttribute('aria-selected', 'true');
    await expect(review.panel.getByText('Document', { exact: true })).toBeVisible();
    await expect(review.productLinesTitle).toBeVisible();
  });

  test('TC_SIF_063: Verify the copy icon.', async ({ page }) => {
    const review = await openPoReview(page);
    await review.copyButton('PO Number').click();
    await expect(review.toasts.filter({ hasText: 'Copied to clipboard!' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText()), 'clipboard').toBe(PO.number);
    await expect(review.field('PO Number')).toContainText(PO.number);
  });

  // Execution video attached to the report for these cases (the project records video; the report keeps it for 'video' cases)
  test.describe('Review page edits (video)', { annotation: { type: 'video', description: 'Execution video attached to the report' } }, () => {
    test('TC_SIF_064: Verify editing a document field.', async ({ page }) => {
      const review = await openPoReview(page);
      await review.editField('Project', `Edited Project ${TOKEN}`);
      await expect(review.field('Project')).toContainText(`Edited Project ${TOKEN}`);
    });

    test('TC_SIF_065: Verify that Save is disabled before any edit.', async ({ page }) => {
      const review = await openPoReview(page);
      await expect(review.saveButton).toBeDisabled();
      await page.waitForLoadState('networkidle').catch(() => {});
      // the disabled button is drawn faded: the green box is a separate layer so it shows in the screenshot
      await outlineBox(page, review.saveButton);
    });

    test('TC_SIF_066: Verify that Save becomes enabled after an edit.', async ({ page }) => {
      const review = await openPoReview(page);
      await expect(review.saveButton).toBeDisabled();
      await review.editField('Project', `Edited Project ${TOKEN}`);
      await expect(review.saveButton).toBeEnabled();
    });

    test('TC_SIF_067: Verify saving the changes.', async ({ page }) => {
      const review = await openPoReview(page);
      await review.editField('Project', `Edited Project ${TOKEN}`);
      await review.save();
      state.poSaved = true;
      await expect(review.statusBadge('Reviewed')).toBeVisible();
      await page.reload();
      await review.waitForLoaded();
      await expect(review.field('Project')).toContainText(`Edited Project ${TOKEN}`);
      await expect(review.saveButton).toBeDisabled();
      await expect(review.statusBadge('Reviewed')).toBeVisible();
    });

    test('TC_SIF_068: Verify the edit and delete icons of each row.', async ({ page }) => {
      const review = await openPoReview(page);
      const n = await review.lineRows.count();
      expect(n).toBeGreaterThan(0);
      await review.editRowButton(review.lineRows.first()).scrollIntoViewIfNeeded();
      for (let i = 0; i < n; i++) {
        await expect(review.editRowButton(review.lineRows.nth(i))).toBeVisible();
        await expect(review.deleteRowButton(review.lineRows.nth(i))).toBeVisible();
      }
    });

    test('TC_SIF_069: Verify editing a product line.', async ({ page }) => {
      const review = await openPoReview(page);
      await review.editRowQty(review.lineRows.first(), '5');
      await expect(review.cell(review.lineRows.first(), 2)).toHaveText('5');
      await expect(review.saveButton).toBeEnabled();
    });

    test('TC_SIF_070: Verify deleting a product line.', async ({ page }) => {
      const review = await openPoReview(page);
      const before = await review.rowCount();
      const last = review.lineRows.nth(before - 1);
      const part = (await review.cell(last, 0).innerText()).trim();
      await review.deleteRowButton(last).click();
      await expect(confirmDialog(page)).toBeHidden();
      await expect(review.rowsSummary).toHaveText(`Table with ${before - 1} row${before - 1 === 1 ? '' : 's'}`);
      await expect(review.lineTable.getByText(part, { exact: true })).toHaveCount(0);
      await expect(review.saveButton).toBeEnabled();
    });

    test('TC_SIF_071: Verify that New row creates an empty row.', async ({ page }) => {
      const review = await openPoReview(page);
      const before = await review.lineRows.count();
      await review.newRowButton.click();
      await expect(review.editingRow).toHaveCount(1);
      await expect(review.lineRows).toHaveCount(before + 1);
      for (const value of await review.editingRow.locator('input').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))) expect(value).toBe('');
      await expect(review.newRowButton).toBeDisabled();
      await expect(review.saveButton).toBeDisabled();
      await expect(review.convertButton).toBeDisabled();
      await expect(review.editingRow.locator('input').first()).toBeVisible();
    });

    test('TC_SIF_072: Verify confirming a new row with the tick icon.', async ({ page }) => {
      const review = await openPoReview(page);
      const before = await review.rowCount();
      await review.addRow(`CD-NEW-${TOKEN}`, 'Automation New Row', '4');
      await expect(review.rowsSummary).toHaveText(`Table with ${before + 1} rows`);
      await expect(review.lineTable.getByText(`CD-NEW-${TOKEN}`, { exact: true })).toBeVisible();
      await expect(review.newRowButton).toBeEnabled();
      await expect(review.saveButton).toBeEnabled();
    });

    test('TC_SIF_073: Verify adding another row.', async ({ page }) => {
      const review = await openPoReview(page);
      await review.addRow(`CD-NEW-${TOKEN}`, 'Automation New Row', '4');
      const before = await review.lineRows.count();
      await review.newRowButton.click();
      await expect(review.lineRows).toHaveCount(before + 1);
      await expect(review.editingRow).toHaveCount(1);
      await expect(review.lineRows.last().locator('input').first()).toBeVisible();
    });

    test('TC_SIF_074: Verify collapsing and expanding Product Lines.', async ({ page }) => {
      const review = await openPoReview(page);
      await review.productLinesTitle.click();
      await expect(review.lineTable).toBeHidden();
      await review.productLinesTitle.click();
      await expect(review.lineTable).toBeVisible();
      await expect(review.productLinesTitle).toBeVisible();
    });
  });

  test('TC_SIF_075: Verify the JSON View.', async ({ page }) => {
    const review = await openPoReview(page);
    const parts: string[] = [];
    for (let i = 0; i < (await review.lineRows.count()); i++) parts.push((await review.cell(review.lineRows.nth(i), 0).innerText()).trim());
    const project = (await review.field('Project').innerText()).split('\n').map((s) => s.trim()).find((s) => s && s !== 'Project' && !s.startsWith('Source')) ?? '';
    await review.jsonTab.click();
    await expect(review.jsonTab).toHaveAttribute('aria-selected', 'true');
    const json = JSON.parse(await review.jsonBlock.innerText());
    expect(json.header.poNumber, 'PO number').toBe(PO.number);
    expect(json.header.projectName, 'project').toBe(project);
    expect(json.lineItems.map((l: { partNumber: string }) => l.partNumber), 'line items').toEqual(parts);
    await expect(review.jsonBlock).toContainText(`"poNumber": "${PO.number}"`);
  });

  // =========================================================================================
  // Convert and download
  // =========================================================================================

  test('TC_SIF_076: Verify Convert to SIF.', async ({ page }, testInfo) => {
    const review = await openPoReview(page);
    // the reviewed data: Project (TC_SIF_067), Qty of row 1, last row deleted, one new row
    await review.editRowQty(review.lineRows.first(), '5');
    await review.deleteRowButton(review.lineRows.nth((await review.lineRows.count()) - 1)).click();
    await review.addRow(`CD-NEW-${TOKEN}`, 'Automation New Row', '4');
    await review.save();
    const downloading = page.waitForEvent('download');
    const converted = page.waitForResponse((r) => /\/api\/convertToSif\//.test(r.url()));
    await review.convertButton.click();
    expect((await converted).status(), 'convertToSif API status').toBe(200);
    const download = await downloading;
    expect(download.suggestedFilename()).toBe(PO.fileName.replace(/\.pdf$/, '.sif'));
    const file = testInfo.outputPath(download.suggestedFilename());
    await download.saveAs(file);
    await testInfo.attach(download.suggestedFilename(), { path: file, contentType: 'text/plain' });
    state.poConverted = true;
    state.poSif = fs.readFileSync(file, 'utf8');
    await expect(review.statusBadge('Converted')).toBeVisible();
    await review.waitForPdf(); // the page reloads the PDF after converting
    await expect(review.toasts.filter({ hasText: `${download.suggestedFilename()} downloaded.` })).toBeVisible();
  });

  test('TC_SIF_077: Verify Download SIF of the converted file.', async ({ page }, testInfo) => {
    requires(state.poConverted, 'the converted file (TC_SIF_076)');
    const list = new SifListPage(page);
    await list.goto();
    await list.search(PO.fileName);
    const row = list.row(PO.fileName);
    await expect(list.statusBadge(row)).toHaveText('Converted');
    const downloading = page.waitForEvent('download');
    await row.getByRole('button', { name: 'Download SIF' }).click();
    const download = await downloading;
    const file = testInfo.outputPath(download.suggestedFilename());
    await download.saveAs(file);
    await testInfo.attach(download.suggestedFilename(), { path: file, contentType: 'text/plain' });
    await attachEvidence(page, testInfo, '1 - Download SIF button');

    const text = fs.readFileSync(file, 'utf8');
    const sif = parseSif(text);
    const get = (k: string) => sif.filter(([key]) => key === k).map(([, v]) => v);
    expect(get('P1')).toEqual([PO.number]);
    expect(get('P2'), 'edited Project').toEqual([`Edited Project ${TOKEN}`]);
    expect(get('PN'), 'line items after the edits').toEqual([PO.lines[0].partNumber, PO.lines[1].partNumber, `CD-NEW-${TOKEN}`]);
    expect(get('QT').map(Number), 'edited Qty').toEqual([5, PO.lines[1].qty, 4]);
    expect(get('PN'), 'deleted line is not in the SIF').not.toContain(PO.lines[2].partNumber);
    expect(text, 'same SIF as downloaded by Convert to SIF').toBe(state.poSif);
    await showSif(page, download.suggestedFilename(), text);
    await expect(page.locator('.sif-line[data-key="P2"]')).toContainText(`Edited Project ${TOKEN}`);
    await expect(page.locator('.sif-line[data-key="QT"]').first()).toContainText('5');
    await expect(page.locator('.sif-line[data-key="PN"]').filter({ hasText: `CD-NEW-${TOKEN}` })).toBeVisible();
  });

  // Execution video attached to the report
  test.describe('Back button (video)', { annotation: { type: 'video', description: 'Execution video attached to the report' } }, () => {
    test('TC_SIF_078: Verify the Back button.', async ({ page }) => {
      const review = await openPoReview(page);
      await review.backButton.click();
      await page.waitForURL(/\/sif-conversion$/);
      const list = new SifListPage(page);
      await list.waitForList();
      await expect(list.title).toBeVisible();
    });
  });

  // =========================================================================================
  // Organization setting
  // =========================================================================================

  // Only the two evidence images: the report leaves out the automatic end-of-test screenshot
  test.describe('Organization setting (evidence images only)', { annotation: { type: 'no-final-screenshot', description: 'Only the two evidence images are reported' } }, () => {
    test('TC_SIF_079: Verify that turning off the SIF Conversion toggle disables the feature for the organization.', async ({ page }, testInfo) => {
      // the Super Admin switches the setting of the user's organization
      await asSuperAdmin(page);
      // opened by the orgId of the user's organization
      const details = new OrganizationDetailsPage(page);
      await details.goto(sifOrgId());
      // the heading capitalises the name ("Riverstonetech"): the Organization Name field holds it as saved
      await plainExpect(details.nameInput).toHaveValue(sifOrgName(), { timeout: 30000 });
      state.orgUrl = page.url();
      await expect(sifSwitch(page)).toHaveAttribute('aria-checked', 'true');
      // other organizations: their setting before the change (compared after it)
      const others = await otherOrgsSif();
      try {
        state.orgToggledOff = true;
        await setOrgSif(page, state.orgUrl!, false);
        await sifSwitch(page).scrollIntoViewIfNeeded();
        await expect(sifSwitch(page)).toHaveAttribute('aria-checked', 'false');
        await expect(page.getByRole('button', { name: 'Edit', exact: true }).first()).toBeVisible(); // saved: back to view mode
        await attachEvidence(page, testInfo, `1 - ${sifOrgName()}: SIF Conversion OFF saved`);

        // Other organizations are not affected: their SIF Conversion setting is unchanged
        expect(await otherOrgsSif(), 'other organizations keep their SIF Conversion setting').toEqual(others);
        test.info().annotations.push({ type: 'Other organizations', description: JSON.stringify(others) });
        await page.goto('/dashboard');
        const shell = new LeftSidePage(page);
        await expect(shell.navButton('Dashboard')).toBeVisible({ timeout: 30000 });

        // A user of the organization
        await shell.clickLogout();
        await new LoginPage(page).loginAndWaitForDashboard(ORG_USER.email, ORG_USER.password);
        // dashboard fully loaded before the evidence: card counts ("..." while loading) and the document list
        const dashboard = new DashboardPage(page);
        await dashboard.expectLoaded();
        for (const name of KpiNames) {
          await expect(dashboard.kpiTab(name), `${name} card count`).toHaveText(new RegExp(`^\\s*${name}\\s*\\d[\\d,]*`), { timeout: 60000 });
        }
        await expect(page.getByText(/^Loading documents/)).toHaveCount(0, { timeout: 60000 });
        await expect(shell.navButton('Dashboard')).toBeVisible();
        await expect(shell.navButton('Documents')).toBeVisible();
        await expect(shell.sidebar.getByText('SIF Conversion', { exact: true })).toHaveCount(0);
        await attachEvidence(page, testInfo, `2 - ${ORG_USER.email}: no SIF Conversion menu`);
        await page.goto('/sif-conversion');
        const list = new SifListPage(page);
        await expect(list.notEnabledMessage).toBeVisible({ timeout: 30000 });
        await expect(list.rows).toHaveCount(0);
        test.info().annotations.push({ type: 'Observation', description: `"New conversion" button visible while SIF Conversion is off: ${await list.newConversionButton.isVisible()}` });
      } finally {
        // clean-up step 9: the setting is turned ON again (through the API: the evidence stays on the user's page)
        await ensureSifOn();
        state.orgToggledOff = false;
      }
    });
  });

  // =========================================================================================
  // Failed files (added)
  // =========================================================================================

  test('TC_SIF_080: Verify the "Failed" tab filter.', async ({ page }) => {
    requires(state.badUploaded, 'the failed upload of TC_SIF_058');
    const list = new SifListPage(page);
    await list.goto();
    await expectTabRows(list, 'Failed');
    await expect(list.row(doc('BAD').fileName)).toBeVisible();
  });

  test('TC_SIF_081: Verify the reason and Retry button of a failed file.', async ({ page }) => {
    state.finishing = true; // last case: afterAll deletes the suite's files
    requires(state.badUploaded, 'the failed upload of TC_SIF_058');
    const list = new SifListPage(page);
    await list.goto();
    await list.search(doc('BAD').fileName);
    const row = list.row(doc('BAD').fileName);
    await expect(list.statusBadge(row)).toHaveText('Failed');
    await expect(row.locator(`[title^="This PDF could not be read."]`)).toHaveAttribute(
      'title',
      'This PDF could not be read. It may be password-protected, damaged, or too large (max 100 pages).',
    );
    await list.statusBadge(row).hover();
    await expect(row.getByRole('button', { name: 'Retry' })).toBeVisible();
  });

  // =========================================================================================
  // Downloaded SIF file uploaded to RiverStream (website and email)
  // =========================================================================================

  /** Customer entered on the review page of the uploaded SIF before Submit to ERP (a customer of the ERP) */
  const SIF_ERP_CUSTOMER = 'Corp Design';

  /** Downloads the SIF of a converted file from the list (Download SIF button); returns the saved file */
  async function downloadSif(page: Page, testInfo: TestInfo, d: SifDoc): Promise<string> {
    const list = new SifListPage(page);
    await list.goto();
    await list.search(d.fileName);
    const row = list.row(d.fileName);
    await expect(list.statusBadge(row)).toHaveText('Converted');
    const downloading = page.waitForEvent('download');
    await row.getByRole('button', { name: 'Download SIF' }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe(d.fileName.replace(/\.pdf$/, '.sif'));
    const file = testInfo.outputPath(download.suggestedFilename());
    await download.saveAs(file);
    await testInfo.attach(download.suggestedFilename(), { path: file, contentType: 'text/plain' });
    await expect(row.getByRole('button', { name: 'Download SIF' })).toBeVisible();
    await attachEvidence(page, testInfo, '1 - Download SIF of the converted file');
    // the SIF holds the converted file's line items (one PN per line)
    const sif = parseSif(fs.readFileSync(file, 'utf8'));
    expect(sif.filter(([k]) => k === 'PN').map(([, v]) => v), 'one PN per line item').toEqual(d.lines.map((l) => l.partNumber));
    return file;
  }

  test('TC_SIF_082: Verify that a downloaded SIF file uploaded through the website is submitted to the ERP.', async ({ page, uploadPage, reviewPage }, testInfo) => {
    test.setTimeout(20 * 60_000);
    // 1. A quote request converted to SIF, downloaded from the SIF Conversion list
    const d = await ensureConvertedQuote('QRW');
    const sifFile = await downloadSif(page, testInfo, d);
    const sifName = path.basename(sifFile);

    // 2. Upload New File: the SIF file as a Quote Request (Client Name is required for SIF files)
    await page.goto('/dashboard');
    await page.getByRole('button', { name: 'Upload New File', exact: true }).click();
    await page.waitForURL(/\/upload\?from=dashboard/);
    await uploadPage.waitForReady();
    await uploadPage.selectDocumentType('Quote Request');
    await uploadPage.attachFile(sifFile);
    await expect(uploadPage.selectedFileName(sifName)).toBeVisible();
    const client = await uploadPage.selectClient('Riverstone Corp');
    const upload = await uploadPage.submitUpload();
    expect(upload.status, `uploadDocument: ${JSON.stringify(upload.body).slice(0, 300)}`).toBe(202);
    expect(upload.requestBody.selectedDocType).toBe('QUOTE_REQUEST');
    testInfo.annotations.push({ type: 'note', description: `Uploaded ${sifName} (Quote Request, client ${client})` });

    // 3. Documents library: the file once processed, then Review
    const documents = new DocumentsPage(page);
    const row = documents.rowByName(sifName);
    await expect(async () => {
      await documents.navigate();
      await documents.searchDocument(sifName);
      await plainExpect(documents.statusBadge(row)).toHaveText(/^(Extracted|Reviewed|Success|Partially Success|Failed)$/i, { timeout: 5000 });
    }).toPass({ timeout: 300_000, intervals: [10_000, 15_000, 20_000] });
    const listed = (await documents.statusBadge(row).innerText()).trim();
    testInfo.annotations.push({ type: 'note', description: `Status after the upload: ${listed}` });
    await documents.reviewButton(row).click();
    await page.waitForURL(/\/review\//);
    await reviewPage.waitForReviewLoaded();
    await expect(reviewPage.fileHeading(sifName)).toBeVisible();

    // 4. Customer Name: Corp Design, a customer of the ERP (the only SIF client, "Riverstone Corp", is not an ERP customer:
    //    "Customer 'Riverstone Corp' not found in ERP."), then Complete and Submit to ERP
    let doc = await reviewPage.reload();
    if (doc.status === 'extracted') {
      await reviewPage.fieldEditButton('Customer Name').click();
      await reviewPage.fieldInput('Customer Name').fill(SIF_ERP_CUSTOMER);
      await reviewPage.fieldSaveButton('Customer Name').click();
      await expect(reviewPage.fieldCard('Customer Name')).toContainText(SIF_ERP_CUSTOMER);
      const saved = page.waitForResponse((r) => r.url().includes('/api/updateDocument') && r.request().method() === 'POST');
      await reviewPage.completeButton.click();
      expect((await saved).status(), 'review saved').toBe(200);
      await expect(reviewPage.toast).toContainText('Document review completed and saved!');
      doc = await reviewPage.reload();
    }
    if (doc.status === 'reviewed') {
      await expect(reviewPage.submitToErpButton).toBeEnabled();
      const submitted = page.waitForResponse((r) => r.url().includes('/api/submitToErp'), { timeout: 120_000 });
      await reviewPage.submitToErpButton.click();
      const response = await submitted;
      const body = await response.json().catch(() => ({}));
      testInfo.annotations.push({ type: 'note', description: `submitToErp HTTP ${response.status()}: ${JSON.stringify(body).slice(0, 300)}` });
      expect(response.status(), `submitToErp: ${JSON.stringify(body).slice(0, 300)}`).toBe(200);
      doc = await reviewPage.reload();
    }
    testInfo.annotations.push({ type: 'note', description: `Document status: ${doc.status}` });

    // 5. Submitted to the ERP: status Success, the ERP number shown, Submit to ERP no longer available
    await expect(page.getByText(/SAL-(QTN|ORD)-\d{4}-\d+/).first(), 'ERP number').toBeVisible({ timeout: 60_000 });
    await expect(reviewPage.statusBadge('Success')).toBeVisible();
    await expect(reviewPage.submitToErpButton).toBeDisabled();
  });

  test(
    'TC_SIF_083: Verify that a downloaded SIF file sent by email is submitted to the ERP.',
    { annotation: { type: 'issue', description: 'Known bug: a SIF file sent by email is not submitted to the ERP.' } },
    async ({ page, mailService }, testInfo) => {
      state.finishing = true; // last case: afterAll deletes the suite's files
      test.setTimeout(30 * 60_000);
      // 1. A quote request converted to SIF, downloaded from the SIF Conversion list
      const d = await ensureConvertedQuote('QRE');
      const sifFile = await downloadSif(page, testInfo, d);
      const sifName = path.basename(sifFile);

      // 2. Email it to RiverStream as a quotation (sender: the suite's user, riverstreamautomation@gmail.com)
      const token = newToken('SIFE');
      const sent = await mailService.sendEmail({
        subject: `Quotation/Estimation ${token}`,
        text: 'Type: Quotation/Estimation',
        attachments: [{ filename: sifName, path: sifFile, contentType: 'application/octet-stream' }],
      });
      await showWaitingForReply(page, [sent]);
      const reply = await waitForResultReply(mailService, { token, since: sent.sentAt, timeoutMs: REPLY_WAIT_MS });
      await attachReply(testInfo, 'reply', reply);
      testInfo.annotations.push({
        type: 'note',
        description: `Reply: ${reply.fields.header ?? reply.subject} | status ${reply.fields.status ?? '-'} | ${reply.fields.message ?? ''}`,
      });

      // 3. The reply: the file was processed and the quotation created in the ERP
      await showReply(page, reply);
      expect(reply.fields.fileName, 'File in the reply').toBe(sifName);
      expect(reply.fields.header, 'the SIF is submitted to the ERP (quotation created)').toMatch(/ERP Quotation Processing Summary/i);
      await expect(page.getByRole('heading', { name: HEADERS.quoteSummary })).toBeVisible();
      await expect(page.getByText(/created successfully in ERP/i).first()).toBeVisible();
    },
  );
});
