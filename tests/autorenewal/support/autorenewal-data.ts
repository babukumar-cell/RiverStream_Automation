import fs from 'fs';
import os from 'os';
import path from 'path';
import { Browser, BrowserContext, Page, TestInfo } from '@playwright/test';
import { test, expect } from '../../../src/fixtures/test.fixture';
import { Config } from '../../../src/config/environment';
import { MailService, RetrievedEmail } from '../../../src/utils/mail.service';
import { TestCard } from '../../../src/pages/billing.page';
import { OrganizationDetailsPage } from '../../../src/pages/settings/organization-details.page';

/*
 * Test data and helpers for the Auto Renewal suite (Test Cases/Module_Wise_Test_Cases/09_Auto_Renewal.xlsx).
 *
 * Every run creates its own organization and the Admin user riverstreamautomation@gmail.com, and deletes both at
 * the end (TC_BILL_033 / 034, with an afterAll safety net). That address must not exist as a RiverStream user
 * before the run (an email can only be registered once). The suite reads the RiverStream emails in its mailbox.
 */

const runId = (process.env.RS_RUN_ID ?? String(Date.now())).slice(-8);

const yy = String(new Date().getFullYear()).slice(-2);

export const RUN = {
  orgName: `AutoRenewal_${runId}`,
  domain: `autorenewal${runId}.com`,
  adminFirstName: 'AutoRenewal',
  adminLastName: 'Admin',
  adminEmail: process.env.AUTORENEWAL_ADMIN_EMAIL || 'riverstreamautomation@gmail.com',
  adminPassword: process.env.AUTORENEWAL_ADMIN_PASSWORD || 'Test@123',
};

/** Expiry used for the Stripe test cards: December of the current year ("12/26" in 2026), always in the future */
const EXPIRY = `12/${yy}`;
export const CARDS: Record<'declined' | 'success', TestCard> = {
  declined: { number: '4000 0000 0000 0002', expiry: EXPIRY, cvc: '123' },
  success: { number: '4242 4242 4242 4242', expiry: EXPIRY, cvc: '123' },
};

export const PLAN = { name: 'Growth', label: 'Growth (Monthly)', price: '$449', amount: '$449.00', usd: 'USD 449.00' } as const;

export const MONTHLY_PLANS = {
  Starter: {
    price: '$249',
    tagline: 'For small teams getting started',
    features: ['3 Users', '150 Documents /month', '30 Days Document History Retention'],
  },
  Growth: {
    price: '$449',
    tagline: 'For growing teams',
    features: ['5 Users', '400 Documents /month', '60 Days Document History Retention'],
  },
  Pro: {
    price: '$649',
    tagline: 'For enterprise-scale operations',
    features: ['10 Users', '1,000 Documents /month', '90 Days Document History Retention'],
  },
} as const;

interface RunState {
  orgId?: string;
  orgDeleted?: boolean;
  cleanupStarted?: boolean;
  userAddedAt?: Date;
  setPasswordLink?: string;
  passwordSet?: boolean;
  failedAt?: Date;
  payNowLink?: string;
  paidAt?: Date;
  stripeInvoiceNo?: string;
  invoiceNo?: string;
  renewalDate?: string;
  invoicePdf?: string;
  cancelledAt?: Date;
}

/*
 * Values collected by the steps of this run. Kept in a file (not in memory) because Playwright starts a new
 * worker after a failed test: the following steps still find what the earlier steps produced.
 */
const STATE_FILE = path.join(os.tmpdir(), `riverstream-autorenewal-${runId}.json`);
const readState = (): Record<string, unknown> => {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
};

export const state = new Proxy({} as RunState, {
  get: (_target, key: string) => {
    const value = readState()[key];
    return typeof value === 'string' && key.endsWith('At') ? new Date(value) : value;
  },
  set: (_target, key: string, value) => {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ ...readState(), [key]: value }, null, 2));
    return true;
  },
});

/** Skips the step when an earlier step of the run did not produce what it needs */
export function requires(value: unknown, what: string): void {
  test.skip(!value, `Not run: needs ${what}, which did not complete in this run.`);
}

// ---------------------------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------------------------

/** Session of the new Admin user, saved by TC_BILL_005 after the first login */
export const ADMIN_STATE = path.join(os.tmpdir(), `riverstream-autorenewal-admin-${runId}.json`);

async function useSession(page: Page, file: string): Promise<void> {
  // RiverStream keeps the session in cookies (userToken, userInfo)
  const saved = JSON.parse(fs.readFileSync(file, 'utf8')) as { cookies: Parameters<BrowserContext['addCookies']>[0] };
  await page.context().clearCookies();
  await page.context().addCookies(saved.cookies);
}

/** Signs the page in as the Super Admin (session saved by tests/auth.setup.ts) */
export async function asSuperAdmin(page: Page): Promise<void> {
  await useSession(page, Config.adminStorageState);
}

/** Signs the page in as the new organization's Admin user */
export async function asAdmin(page: Page): Promise<void> {
  requires(fs.existsSync(ADMIN_STATE), 'the Admin login (TC_BILL_005)');
  await useSession(page, ADMIN_STATE);
}

// ---------------------------------------------------------------------------------------------
// Emails (sent by RiverStream to the Admin's +alias)
// ---------------------------------------------------------------------------------------------

const MAIL_FROM = 'azurecomm.net';

export const SUBJECTS = {
  setPassword: 'Set up your RiverStream password',
  paymentFailed: `RiverStream: Payment failed for your ${PLAN.name} plan`,
  planActive: `RiverStream: Your ${PLAN.name} plan is active`,
  renewalCancelled: `RiverStream: Auto-renewal cancelled for your ${PLAN.name} plan`,
} as const;

/** Waits for the RiverStream email with this subject sent to the run's Admin after `since` */
/** Waits for the email (default 4 min; the "Auto-renewal cancelled" email can take 5-6 min to arrive) */
export async function waitForMail(mail: MailService, subject: string, since: Date, timeoutMs = 240_000): Promise<RetrievedEmail> {
  return mail.waitForReply({ token: subject, from: MAIL_FROM, to: RUN.adminEmail, since: new Date(since.getTime() - 60_000), timeoutMs });
}

/** First link in the email whose URL matches `pattern` */
export function mailLink(mail: RetrievedEmail, pattern: RegExp): string {
  const hrefs = [...mail.html.matchAll(/href=["']([^"']+)["']/g)].map((m) => m[1].replace(/&amp;/g, '&'));
  const link = hrefs.find((h) => pattern.test(h));
  expect(link, `link matching ${pattern} in "${mail.subject}"`).toBeTruthy();
  return link!;
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Shows the email in the page (with a From / To / Subject strip) so the screenshot shows the highlighted content */
export async function showEmail(page: Page, mail: RetrievedEmail): Promise<void> {
  await page.setContent(mail.html || `<pre style="white-space:pre-wrap;font:13px Arial">${escapeHtml(mail.text)}</pre>`, { waitUntil: 'domcontentloaded' });
  const meta =
    `<div id="rs-mail-meta" style="font:13px Arial,sans-serif;background:#f3f4f6;border-bottom:1px solid #d1d5db;padding:10px 16px;line-height:1.6">` +
    `<div><b>From:</b> ${escapeHtml(mail.from)} &nbsp; <b>To:</b> ${escapeHtml(mail.to.join(', '))} &nbsp; <b>Received:</b> ${mail.receivedAt.toISOString()}</div>` +
    `<div><b>Subject:</b> <span id="rs-mail-subject">${escapeHtml(mail.subject)}</span></div>` +
    (mail.attachments.length ? `<div><b>Attachments:</b> <span id="rs-mail-attachments">${mail.attachments.map((a) => escapeHtml(a.filename)).join(', ')}</span></div>` : '') +
    `</div>`;
  await page.evaluate((html) => document.body.insertAdjacentHTML('afterbegin', html), meta);
}

/** Value cell next to a label cell in a RiverStream email table ("Plan" -> "Growth (Monthly)") */
export function mailField(page: Page, label: string) {
  return page.locator('td').filter({ hasText: new RegExp(`^\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) }).locator('xpath=following-sibling::td[1]');
}

export async function attachEvidence(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const file = testInfo.outputPath(`${name.replace(/[^\w-]+/g, '_')}.png`);
  await page.screenshot({ path: file, fullPage: true });
  await testInfo.attach(name, { path: file, contentType: 'image/png' });
}

// ---------------------------------------------------------------------------------------------
// Dates as shown by RiverStream
// ---------------------------------------------------------------------------------------------

/** "Nov 12, 2026" (emails, invoice) */
export const mailDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
/** "11/12/2026" (Billing page) */
export const appDate = (d: Date) => d.toLocaleDateString('en-US');
/** "11/12/26" (invoice service period) */
export const shortDate = (d: Date) => d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' });

export function addMonth(d: Date): Date {
  const next = new Date(d);
  next.setMonth(next.getMonth() + 1);
  return next;
}

/** Dates the payment can carry: today here and today in UTC (they differ around midnight) */
export function paymentDays(at: Date): Date[] {
  const local = new Date(at.getFullYear(), at.getMonth(), at.getDate());
  const utc = new Date(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
  return local.getTime() === utc.getTime() ? [local] : [local, utc];
}

// ---------------------------------------------------------------------------------------------
// Invoice PDF: rendered with pdf.js; every text run gets an overlay span so assertions highlight it
// ---------------------------------------------------------------------------------------------

const PDFJS = path.resolve(__dirname, '../../../node_modules/pdfjs-dist/legacy/build');
const PDF_ORIGIN = 'https://rs-invoice.local';

export async function showPdf(page: Page, file: string, scale = 1.4): Promise<string[]> {
  await page.route(`${PDF_ORIGIN}/**`, async (route) => {
    const name = new URL(route.request().url()).pathname.slice(1);
    if (name === 'invoice.pdf') return route.fulfill({ path: file, contentType: 'application/pdf' });
    if (name === 'index.html') {
      return route.fulfill({
        contentType: 'text/html',
        body:
          `<!doctype html><html><body style="margin:0;background:#525659"><div id="sheet" style="position:relative;margin:16px auto;width:fit-content;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.4)">` +
          `<canvas id="pdf"></canvas><div id="text" style="position:absolute;inset:0"></div></div></body></html>`,
      });
    }
    return route.fulfill({ path: path.join(PDFJS, name), contentType: 'text/javascript' });
  });
  await page.goto(`${PDF_ORIGIN}/index.html`);
  const texts = await page.evaluate(async ({ origin, scale }) => {
    const pdfjs: any = await import(`${origin}/pdf.mjs`);
    pdfjs.GlobalWorkerOptions.workerSrc = `${origin}/pdf.worker.mjs`;
    const doc = await pdfjs.getDocument(`${origin}/invoice.pdf`).promise;
    const pdfPage = await doc.getPage(1);
    const viewport = pdfPage.getViewport({ scale });
    const canvas = document.getElementById('pdf') as HTMLCanvasElement;
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    const layer = document.getElementById('text')!;
    const content = await pdfPage.getTextContent();
    const out: string[] = [];
    for (const item of content.items as any[]) {
      if (!item.str || !item.str.trim()) continue;
      const tx = pdfjs.Util.transform(viewport.transform, item.transform);
      const height = Math.hypot(tx[2], tx[3]);
      const span = document.createElement('span');
      span.className = 'rs-pdf-text';
      span.textContent = item.str;
      Object.assign(span.style, {
        position: 'absolute', left: `${tx[4]}px`, top: `${tx[5] - height}px`, width: `${item.width * scale}px`,
        height: `${height * 1.15}px`, color: 'transparent', whiteSpace: 'pre', overflow: 'hidden', fontSize: `${height}px`,
      });
      layer.appendChild(span);
      out.push(item.str);
    }
    return out;
  }, { origin: PDF_ORIGIN, scale });
  return texts;
}

/** Text run of the rendered PDF (exact text or pattern) */
export function pdfText(page: Page, text: string | RegExp) {
  return page.locator('.rs-pdf-text').filter({ hasText: typeof text === 'string' ? new RegExp(`^\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) : text });
}

// ---------------------------------------------------------------------------------------------
// Cleanup safety net (TC_BILL_033 / 034 do it through the UI when the suite gets that far)
// ---------------------------------------------------------------------------------------------

/**
 * Deletes the run's user and organization when the last step (TC_BILL_034) started but did not finish. Runs from
 * afterAll, which Playwright also calls when a worker ends after a failed test: before TC_BILL_034 nothing is deleted.
 */
export async function deleteRunOrganization(browser: Browser): Promise<void> {
  if (!state.orgId || state.orgDeleted || !state.cleanupStarted) return;
  const context = await browser.newContext({ storageState: Config.adminStorageState, baseURL: Config.baseUrl });
  const page = await context.newPage();
  try {
    const details = new OrganizationDetailsPage(page);
    await details.goto(state.orgId);
    if (await details.notFoundMessage.isVisible().catch(() => false)) return;
    const row = details.userRow(RUN.adminEmail);
    if (await row.isVisible().catch(() => false)) {
      await details.userRowDeleteButton(row).click();
      await details.confirmDeleteDialog.confirmButton.click();
      await expect(details.noUsersMessage).toBeVisible({ timeout: 20000 });
    }
    await details.deleteWithConfirmation();
    state.orgDeleted = true;
    console.log(`[autorenewal] cleanup: deleted ${RUN.orgName} (${state.orgId})`);
  } catch (err) {
    console.warn(`[autorenewal] cleanup of ${RUN.orgName} (${state.orgId}) failed, delete it manually: ${(err as Error).message}`);
  } finally {
    await context.close();
  }
}
