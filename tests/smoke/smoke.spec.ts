import fs from 'fs';
import path from 'path';
import { test, expect, Page } from '@playwright/test';
import { Config } from '../../src/config/environment';
import { QaData, uniqueName } from '../../src/test-data/qa-data';
import { MailService } from '../../src/utils/mail.service';
import { buildPurchaseOrderPdf, closeRenderer, newToken } from '../email/support/email-scenario';

/*
 * Smoke suite: one happy-path check per major feature, mapped to the module test case sheets
 * (Test Cases/Module_Wise_Test_Cases). It answers "are the core flows of RiverStream working?"
 * and is meant to run before the full regression (npm run test:smoke).
 *
 * Data it creates (all AUTO_-prefixed): one uploaded PO per run, which it completes itself,
 * PO/ACK uploads into a single reusable recon project, and one emailed PO.
 */

const PO_PDF = path.resolve('Test Cases/PO ACK files/CRI Files/New files/Purchase_Order_13583.pdf');
const RECON_PO = path.resolve('Test Cases/PO ACK files/CRI Files/SIT-53758-113541-DIRO.pdf');
const RECON_ACK = path.resolve('Test Cases/PO ACK files/CRI Files/53758-113541-SIT-ACKS.pdf');
const SMOKE_RECON_PROJECT = `${QaData.testPrefix}_Smoke_Recon`;

const LOGGED_OUT = { cookies: [], origins: [] };

/** Collects uncaught page errors and 5xx responses for the lifetime of the page. */
function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', err => errors.push(`pageerror: ${err.message}`));
  page.on('response', res => {
    if (res.status() >= 500) errors.push(`HTTP ${res.status()} ${res.request().method()} ${res.url()}`);
  });
  return errors;
}

async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
}

/** Waits until list/table loading placeholders are gone. */
async function waitForLoaded(page: Page): Promise<void> {
  await expect(page.getByText(/^Loading\.{0,3}$/i)).toHaveCount(0, { timeout: 30000 });
}

/** Copies a sample file to the test output folder under a unique name (avoids duplicate detection). */
function uniqueCopy(source: string, label: string): string {
  const target = test.info().outputPath(`${uniqueName(label)}${path.extname(source)}`);
  fs.copyFileSync(source, target);
  return target;
}

test.describe('Smoke: authentication', () => {
  test.use({ storageState: LOGGED_OUT });

  test('TC_AUTH_001: Sign in with valid credentials opens the dashboard', async ({ page }) => {
    await login(page, Config.adminEmail, Config.adminPassword);
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 30000 });
    await expect(page.locator('aside').getByRole('button', { name: 'Dashboard', exact: true })).toBeVisible();
  });

  test('TC_AUTH_002: Sign in with a wrong password shows an error and stays on the login page', async ({ page }) => {
    await login(page, Config.adminEmail, `${Config.adminPassword}-wrong`);
    await expect(page.getByText('Invalid username or password')).toBeVisible();
    await expect(page).not.toHaveURL(/\/dashboard/);
  });

  test('TC_DASH_002: Logout ends the session and protects the app', async ({ page }) => {
    await login(page, Config.adminEmail, Config.adminPassword);
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 30000 });

    await page.locator('aside').getByTitle('Logout').click();
    await expect(page.locator('#email')).toBeVisible();

    await page.goto('/dashboard');
    await expect(page.locator('#email'), 'protected page redirects to login after logout').toBeVisible({ timeout: 20000 });
  });
});

test.describe('Smoke: dashboard and navigation', () => {
  test('TC_DASH_020: Dashboard loads KPI cards and the document table without errors', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/dashboard');
    await waitForLoaded(page);

    for (const kpi of ['Total Documents', 'Pending Review', 'Processing', 'Reviewed']) {
      const card = page.getByRole('button').filter({ hasText: kpi }).first();
      await expect(card, `${kpi} card`).toBeVisible();
      await expect(card, `${kpi} card shows a number`).toHaveText(/\d/);
    }
    await expect(page.getByRole('columnheader', { name: /Document Name/i })).toBeVisible();
    await expect(page.getByRole('row').nth(1), 'at least one document row').toBeVisible();
    expect(errors, 'no uncaught errors or 5xx responses').toEqual([]);
  });

  test('TC_DASH_005: Selecting an organization filters the dashboard', async ({ page }) => {
    await page.goto('/dashboard');
    await waitForLoaded(page);
    const orgDropdown = page.getByRole('combobox').first();
    await orgDropdown.click();
    const option = page.getByRole('option', { name: QaData.defaultOrg, exact: true });
    await expect(option).toBeVisible();
    await option.click();
    await expect(orgDropdown).toContainText(QaData.defaultOrg);
    await waitForLoaded(page);
    await expect(page.getByRole('button').filter({ hasText: 'Total Documents' }).first()).toHaveText(/\d/);
  });

  const modules: { id: string; nav: string[]; url: RegExp; ready: (p: Page) => ReturnType<Page['getByText']> }[] = [
    { id: 'TC_DOCU_021', nav: ['Documents'], url: /\/documents/, ready: p => p.getByPlaceholder('Search documents...') },
    { id: 'TC_RECON_001', nav: ['PO-ACK Recon'], url: /\/po-ack-recon$/, ready: p => p.getByRole('button', { name: 'New Project' }) },
    { id: 'TC_CLIE_044', nav: ['Clients'], url: /\/clients/, ready: p => p.getByRole('button', { name: /Add Client/i }) },
    { id: 'TC_ANAL_063', nav: ['Analytics'], url: /\/analytics/, ready: p => p.getByText('Performance Analytics') },
    { id: 'TC_SETT_069', nav: ['Settings', 'Users'], url: /\/users/, ready: p => p.getByRole('button', { name: /Add User/i }) },
    { id: 'TC_SETT_116', nav: ['Settings', 'Organizations'], url: /\/organizations/, ready: p => p.getByRole('button', { name: /Add Organization/i }) },
  ];

  for (const m of modules) {
    test(`${m.id}: ${m.nav.join(' > ')} page opens from the sidebar`, async ({ page }) => {
      const errors = trackErrors(page);
      await page.goto('/dashboard');
      for (const item of m.nav) await page.locator('aside').getByRole('button', { name: item, exact: true }).click();
      await expect(page).toHaveURL(m.url);
      await expect(m.ready(page)).toBeVisible({ timeout: 20000 });
      await waitForLoaded(page);
      expect(errors, 'no uncaught errors or 5xx responses').toEqual([]);
    });
  }
});

test.describe('Smoke: upload, documents and review', () => {
  test.describe.configure({ mode: 'serial' });

  let fileName = '';
  let reviewUrl = '';

  test('TC_UP_006: Upload a Purchase Order PDF', async ({ page }) => {
    const file = uniqueCopy(PO_PDF, 'SmokePO');
    fileName = path.basename(file);

    await page.goto('/upload?from=documents');
    await expect(page.locator('input[type="file"]')).toHaveAttribute('accept', /\.pdf/, { timeout: 20000 });
    await page.getByLabel('Document type').click();
    await page.getByRole('option', { name: 'Purchase Order', exact: true }).click();
    await page.locator('input[type="file"]').setInputFiles(file);

    const upload = page.waitForResponse(r => /\/api\/uploadDocument/i.test(r.url()) && r.request().method() === 'POST', { timeout: 60000 });
    await page.getByRole('button', { name: 'Upload and Process', exact: true }).click();
    expect((await upload).status(), 'upload API accepted the file').toBeLessThan(300);
    await expect(page, 'returns to the Documents page').toHaveURL(/\/documents/, { timeout: 30000 });
  });

  test('TC_UP_032: Uploaded document appears in the library and finishes extraction', async ({ page }) => {
    test.skip(!fileName, 'Upload step did not run');
    test.setTimeout(360000);
    await page.goto('/documents');
    const row = page.getByRole('row').filter({ hasText: fileName });

    await expect(async () => {
      await page.reload();
      await page.getByPlaceholder('Search documents...').fill(fileName);
      await expect(row).toBeVisible({ timeout: 15000 });
      await expect(row, 'extraction finished').not.toContainText(/Processing/i, { timeout: 1000 });
    }).toPass({ timeout: 300000, intervals: [10000, 20000, 30000] });

    await expect(row, 'extraction succeeded').not.toContainText(/Failed/i);
    await expect(row.getByRole('button', { name: 'Review' })).toBeVisible();
  });

  test('TC_REV_009: Review page shows the PDF and the extracted fields', async ({ page }) => {
    test.skip(!fileName, 'Upload step did not run');
    await page.goto('/documents');
    await page.getByPlaceholder('Search documents...').fill(fileName);
    await page.getByRole('row').filter({ hasText: fileName }).getByRole('button', { name: 'Review' }).click();
    await expect(page).toHaveURL(/\/review\/[^/]+/, { timeout: 30000 });
    reviewUrl = page.url();

    await expect(page.getByText(/Page \d+ \/ \d+/), 'PDF viewer rendered').toBeVisible({ timeout: 30000 });
    await expect(page.getByText('Basic Information'), 'extracted field section').toBeVisible();
    await expect(page.getByText(/Source: Page \d+/).first(), 'fields carry a source citation').toBeVisible();
    await expect(page.getByText(/Order Line Items/i)).toBeVisible();

    await page.getByRole('tab', { name: 'JSON View' }).or(page.getByRole('button', { name: 'JSON View' })).click();
    await expect(page.getByRole('button', { name: /Copy JSON/i })).toBeVisible();
  });

  test('TC_REV_005: Complete marks the reviewed document as Reviewed', async ({ page }) => {
    test.skip(!reviewUrl, 'Review step did not run');
    await page.goto(reviewUrl);
    const complete = page.getByRole('button', { name: 'Complete', exact: true });
    await expect(complete).toBeEnabled({ timeout: 30000 });
    await complete.click();

    await page.goto('/documents');
    const row = page.getByRole('row').filter({ hasText: fileName });
    await expect(async () => {
      await page.reload();
      await page.getByPlaceholder('Search documents...').fill(fileName);
      await expect(row).toContainText('Reviewed', { timeout: 10000 });
    }).toPass({ timeout: 60000 });
  });
});

test.describe('Smoke: PO-ACK Recon', () => {
  test.describe.configure({ mode: 'serial' });

  test('TC_RECON_045: Reference project opens a recon review with PO data, ACK data and discrepancies', async ({ page }) => {
    await page.goto('/po-ack-recon');
    await page.getByPlaceholder('Search projects...').fill(QaData.reconProject);
    await page.getByRole('row').filter({ hasText: QaData.reconProject }).first().click();
    await expect(page).toHaveURL(/\/po-ack-recon\/[^/]+$/);
    await waitForLoaded(page);

    const reviewable = page.getByRole('row').filter({ hasNotText: 'Awaiting ACK' }).filter({ has: page.getByRole('button', { name: 'Review' }) });
    await expect(reviewable.first(), 'project has a reviewable PO/ACK pair').toBeVisible();
    await reviewable.first().getByRole('button', { name: 'Review' }).click();

    await expect(page).toHaveURL(/\/po-ack-recon\/review\//);
    await expect(page.getByText('PO Data', { exact: true })).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(/ACK \d+ Data/)).toBeVisible();
    await expect(page.getByText(/discrepanc(y|ies) against PO/i)).toBeVisible();
  });

  test('TC_RECON_033: Upload a PO and ACK pair and get it ready for review', async ({ page }) => {
    test.setTimeout(420000);
    await page.goto('/po-ack-recon');
    const search = page.getByPlaceholder('Search projects...');
    await search.fill(SMOKE_RECON_PROJECT);
    await waitForLoaded(page);
    const projectRow = page.getByRole('row').filter({ hasText: SMOKE_RECON_PROJECT }).first();

    if ((await projectRow.count()) === 0) {
      // One reusable smoke project: projects cannot be deleted from the UI.
      await page.getByRole('button', { name: 'New Project' }).click();
      await page.getByPlaceholder('Enter project name...').fill(SMOKE_RECON_PROJECT);
      await page.getByRole('button', { name: 'Create', exact: true }).click();
      await expect(page).toHaveURL(/\/po-ack-recon\/[^/]+$/, { timeout: 30000 });
    } else {
      await projectRow.click();
      await expect(page).toHaveURL(/\/po-ack-recon\/[^/]+$/);
    }

    const po = uniqueCopy(RECON_PO, 'SmokeReconPO');
    const ack = uniqueCopy(RECON_ACK, 'SmokeReconACK');
    await page.getByRole('button', { name: /Upload Documents/i }).first().click();
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible();
    const inputs = modal.locator('input[type="file"]');
    await inputs.first().setInputFiles(po);
    await inputs.nth(1).setInputFiles(ack);

    const upload = page.waitForResponse(r => r.request().method() === 'POST' && /upload/i.test(r.url()), { timeout: 60000 });
    await modal.getByRole('button', { name: 'Upload Files', exact: true }).click();
    expect((await upload).status(), 'recon upload accepted').toBeLessThan(300);
    await expect(modal).toBeHidden({ timeout: 30000 });

    const poNumber = '53758-113541';
    const row = page.getByRole('row').filter({ hasText: poNumber }).first();
    await expect(async () => {
      await page.reload();
      await waitForLoaded(page);
      await expect(row).toBeVisible({ timeout: 10000 });
      await expect(row, 'recon processing finished').not.toContainText(/Processing|Awaiting ACK/i, { timeout: 1000 });
    }).toPass({ timeout: 360000, intervals: [15000, 30000] });
    await expect(row.getByRole('button', { name: 'Review' })).toBeVisible();
  });
});

test.describe('Smoke: settings', () => {
  test('TC_SETT_072: User details open from the Users list', async ({ page }) => {
    await page.goto('/users');
    await waitForLoaded(page);
    await page.getByRole('main').getByRole('button', { name: /view/i }).first().click();
    await expect(page).toHaveURL(/\/users\/.+/);
    await expect(page.getByText('Basic Information')).toBeVisible();
    await expect(page.getByText('Organization Information')).toBeVisible();
  });

  test('TC_SETT_119: Organization details open from the Organizations list', async ({ page }) => {
    await page.goto('/organizations');
    await waitForLoaded(page);
    await page.getByRole('main').getByRole('button', { name: /view/i }).first().click();
    await expect(page).toHaveURL(/\/organizations\/ORG/i);
    await expect(page.getByText('Subscription', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Document Limit')).toBeVisible();
  });
});

test.describe('Smoke: email ingestion', () => {
  test.afterAll(async () => {
    await closeRenderer();
  });

  test('TC_RS_EM_011: Emailed purchase order gets a processing reply and shows up in Documents', async ({ page }, testInfo) => {
    test.skip(!Config.email.senderEmail || !Config.email.senderAppPassword, 'SENDER_EMAIL / SENDER_APP_PASSWORD not configured');
    test.setTimeout(480000);
    const mail = new MailService();
    const token = newToken('SMOKE');
    const po = await buildPurchaseOrderPdf(testInfo, token);

    const sent = await mail.sendEmail({
      subject: `Smoke ${token}`,
      text: 'Automated smoke test. Please process the attached purchase order.',
      attachments: [{ filename: po.fileName, path: po.path, contentType: 'application/pdf' }],
    });
    expect(sent.rejected, 'ingestion address accepted the email').toEqual([]);

    const reply = await mail.waitForReply({ token, since: sent.sentAt, timeoutMs: 360000 });
    expect(reply.subject).toMatch(new RegExp(`^RE:.*${token}`, 'i'));
    expect(reply.fields.header, 'reply reports a processing summary').toMatch(/Processing Summary/i);
    expect(reply.fields.fileName).toBe(po.fileName);

    await page.goto('/documents');
    await page.getByPlaceholder('Search documents...').fill(po.fileName);
    await expect(page.getByRole('row').filter({ hasText: po.fileName })).toBeVisible({ timeout: 30000 });
  });
});
