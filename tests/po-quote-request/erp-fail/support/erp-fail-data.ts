import fs from 'fs';
import path from 'path';
import { Browser, Locator, Page, TestInfo, expect, test } from '@playwright/test';
import { Config } from '../../../../src/config/environment';
import { OrganizationDetailsPage } from '../../../../src/pages/settings/organization-details.page';
import { MailService, RetrievedEmail } from '../../../../src/utils/mail.service';

/*
 * Test data for the ERP fail suite (TC_ERP_001 - TC_ERP_002).
 *
 * The Super Admin uploads a valid SIF file as a Quote Request in its own organization, changes the Customer Name to a
 * customer that does not exist in the ERP, completes the review and submits it to the ERP. The ERP rejects it: the
 * review page shows "ERP Insertion Failed" and RiverStream emails the organization's admins
 * ("RiverStream Alert: ERP Quotation Insertion Failed (<ERP>) — <organization> — <file>").
 *
 * To read that email, the suite adds the automation mailbox as an Admin of the organization before the tests and
 * deletes it afterwards (an automation user that already existed in the organization is kept). The Auto Renewal suite uses the same mailbox as a user: do not run both at the same time.
 */

const runId = () => process.env.RS_RUN_ID ?? String(Date.now());
const token = runId().slice(-10);

export const RUN = {
  /** Uploaded file (unique per run) */
  fileName: `AUTO_ERPFAIL_${token}.sif`,
  /** Customer Name entered on the review page: not a customer of the ERP */
  invalidCustomer: `AUTO Invalid Customer ERPFAIL ${token}`,
} as const;

/** Valid SIF file uploaded by the suite (a copy named RUN.fileName is uploaded) */
export const SIF_SOURCE = path.resolve(__dirname, '../../../../Riverstone test SIF Files/CDF_Carolina OS_Young Conway Furniture_SIF_260520_QA8.sif');

/** Admin added to the organization for the run, so the failure email reaches a mailbox the suite can read */
export const AUTOMATION_USER = {
  firstName: 'ERP',
  lastName: 'Automation',
  email: process.env.ERP_FAIL_USER_EMAIL || 'riverstreamautomation@gmail.com',
  role: 'Admin' as const,
};

export const MAIL_FROM = 'azurecomm.net';
/** Words of the failure email's subject used to find it (the rest of the subject names the ERP, organization and file) */
export const SUBJECT_TOKEN = 'Insertion Failed';
/** The failure email can take several minutes */
export const MAIL_WAIT_MS = 10 * 60_000;

export const reasonText = () => `Customer '${RUN.invalidCustomer}' not found in ERP.`;

export interface SuiteState {
  orgId?: string;
  orgName?: string;
  userAdded?: boolean;
  /** The automation user was created by this run (and is deleted at the end) */
  userCreated?: boolean;
  uploadedAt?: Date;
  submittedAt?: Date;
  failurePopupShown?: boolean;
  reply?: RetrievedEmail;
}

/** Organization of the Super Admin (its uploads go there), from the saved session */
export function superAdminOrgId(): string {
  const saved = JSON.parse(fs.readFileSync(Config.adminStorageState, 'utf8')) as { cookies: Array<{ name: string; value: string }> };
  const info = saved.cookies.find((c) => c.name === 'userInfo');
  const orgId = info ? (JSON.parse(decodeURIComponent(info.value)).orgId as string | undefined) : undefined;
  if (!orgId) throw new Error(`No organization in the Super Admin session (${Config.adminStorageState})`);
  return orgId;
}

async function withSuperAdmin<T>(browser: Browser, fn: (page: Page) => Promise<T>): Promise<T> {
  const context = await browser.newContext({ storageState: Config.adminStorageState, viewport: { width: 1600, height: 900 } });
  try {
    return await fn(await context.newPage());
  } finally {
    await context.close();
  }
}

/**
 * Makes AUTOMATION_USER an Admin of the organization: added if it is not there yet. Returns the organization name and
 * whether the user was created by this run (only then is it deleted afterwards: an existing user, e.g. the
 * riverstonetech user of the PO-ACK email flow, is kept).
 */
export async function addAutomationUser(browser: Browser, orgId: string): Promise<{ orgName: string; created: boolean }> {
  return withSuperAdmin(browser, async (page) => {
    const details = new OrganizationDetailsPage(page);
    await details.goto(orgId);
    await expect(details.nameInput).not.toHaveValue('', { timeout: 30000 });
    const orgName = await details.nameInput.inputValue();
    await expect(details.addUserButton).toBeVisible();
    await page.waitForLoadState('networkidle').catch(() => {});
    const created = !(await details.userRow(AUTOMATION_USER.email).isVisible());
    if (created) await details.addUser(AUTOMATION_USER);
    await expect(details.userRowRole(details.userRow(AUTOMATION_USER.email))).toHaveText(/^admin$/i);
    return { orgName, created };
  });
}

/** Deletes AUTOMATION_USER from the organization (exact email only) */
export async function deleteAutomationUser(browser: Browser, orgId: string): Promise<void> {
  await withSuperAdmin(browser, async (page) => {
    const details = new OrganizationDetailsPage(page);
    await details.goto(orgId);
    await expect(details.addUserButton).toBeVisible({ timeout: 30000 });
    const row = details.userRow(AUTOMATION_USER.email);
    if (!(await row.isVisible())) return;
    await expect(row).toHaveCount(1);
    await details.userRowDeleteButton(row).click();
    await expect(details.confirmDeleteDialog.message).toHaveText('Are you sure you want to delete this user?');
    const deleted = page.waitForResponse((r) => /\/api\/deleteUser\b/.test(r.url()) && r.request().method() === 'DELETE');
    await details.confirmDeleteDialog.confirmButton.click();
    expect((await deleted).status(), 'deleteUser API status').toBe(200);
    await expect(details.userRow(AUTOMATION_USER.email)).toHaveCount(0);
  });
}

/** Waits for the failure email about RUN.fileName sent to AUTOMATION_USER (INBOX first, then Spam) */
export function waitForFailureEmail(mail: MailService, since: Date): Promise<RetrievedEmail> {
  return mail.waitForReply({
    token: SUBJECT_TOKEN,
    from: MAIL_FROM,
    to: AUTOMATION_USER.email,
    bodyIncludes: RUN.fileName,
    since: new Date(since.getTime() - 60_000),
    timeoutMs: MAIL_WAIT_MS,
  });
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Shows the email in the page with a Folder / From / To / Subject strip, so the screenshot shows the checked parts */
export async function showEmail(page: Page, mail: RetrievedEmail): Promise<void> {
  await page.setContent(mail.html || `<pre style="white-space:pre-wrap;font:13px Arial">${escapeHtml(mail.text)}</pre>`, { waitUntil: 'domcontentloaded' });
  const meta =
    `<div id="rs-mail-meta" style="font:13px Arial,sans-serif;background:#f3f4f6;border-bottom:1px solid #d1d5db;padding:10px 16px;line-height:1.6">` +
    `<div><b>Folder:</b> <span id="rs-mail-folder">${escapeHtml(mail.mailbox)}</span></div>` +
    `<div><b>From:</b> ${escapeHtml(mail.from)}</div>` +
    `<div><b>To:</b> <span id="rs-mail-to">${escapeHtml(mail.to.join(', '))}</span></div>` +
    `<div><b>Received:</b> ${mail.receivedAt.toISOString()}</div>` +
    `<div><b>Subject:</b> <span id="rs-mail-subject">${escapeHtml(mail.subject)}</span></div></div>`;
  await page.evaluate((html) => document.body.insertAdjacentHTML('afterbegin', html), meta);
}

/** Paragraph "<b>Label:</b> value" of the failure email */
export function emailField(page: Page, label: string): Locator {
  return page.locator('p').filter({ has: page.locator('b', { hasText: new RegExp(`^${label}:$`) }) });
}

/** Value of an email field (text after "Label:") */
export async function emailFieldValue(page: Page, label: string): Promise<string> {
  return (await emailField(page, label).innerText()).replace(new RegExp(`^\\s*${label}:\\s*`), '').trim();
}

export async function attachEvidence(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const file = testInfo.outputPath(`${name.replace(/[^\w-]+/g, '_')}.png`);
  await page.screenshot({ path: file, fullPage: true });
  await testInfo.attach(name, { path: file, contentType: 'image/png' });
}

/** Skips the test (with the reason) when an earlier step of the run did not produce `value` */
export function requires<T>(value: T | undefined, what: string): asserts value is T {
  test.skip(value === undefined || value === null || value === false, `Needs ${what}, which did not complete in this run`);
}
