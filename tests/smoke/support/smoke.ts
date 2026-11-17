import fs from 'fs';
import os from 'os';
import path from 'path';
import { Page, TestInfo, expect, test } from '@playwright/test';
import { Config } from '../../../src/config/environment';
import { DashboardPage } from '../../../src/pages/dashboard.page';
import { UploadPage, UploadDocumentType } from '../../../src/pages/upload.page';
import { uniqueName } from '../../../src/test-data/qa-data';

/*
 * Shared helpers of the smoke suite (Test Cases/Module_Wise_Test_Cases/11_Smoke_Test.xlsx). The suite runs in the
 * `smoke` project (`npm run test:smoke`) as the Super Admin of riverstonetech, file by file in this order:
 *   01 Dashboard, Documents and the left side menu   02 Web upload   03 Email PO & Quote (and negative replies)
 *   04 PO-ACK Recon (cards, web upload, email flow, comparison report)   05 SIF Conversion   06 Auto Renewal (last)
 */

/** Records uncaught page errors and server errors (HTTP 5xx) while a page is used */
export function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`HTTP ${res.status()} ${res.request().method()} ${res.url()}`);
  });
  return errors;
}

/** Copy of `source` named AUTO_<label>_<date>_<n><ext> in the test's output folder (RiverStream rejects a name it already has) */
export function uniqueCopy(source: string, label: string): string {
  const target = test.info().outputPath(`${uniqueName(label)}${path.extname(source)}`);
  fs.copyFileSync(source, target);
  return target;
}

/** Organization of the Super Admin, from the saved session */
export function superAdminOrgId(): string {
  const saved = JSON.parse(fs.readFileSync(Config.adminStorageState, 'utf8')) as { cookies: Array<{ name: string; value: string }> };
  const info = saved.cookies.find((c) => c.name === 'userInfo');
  const orgId = info ? (JSON.parse(decodeURIComponent(info.value)).orgId as string | undefined) : undefined;
  if (!orgId) throw new Error(`No organization in the Super Admin session (${Config.adminStorageState})`);
  return orgId;
}

/** Full-page screenshot attached to the report under `name` (evidence of an intermediate step) */
export async function attachEvidence(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const file = testInfo.outputPath(`${name.replace(/[^\w-]+/g, '_')}.png`);
  await page.screenshot({ path: file, fullPage: true });
  await testInfo.attach(name, { path: file, contentType: 'image/png' });
}

/** Dashboard fully loaded: KPI cards, list heading and documents, network idle */
export async function waitForDashboardLoaded(page: Page): Promise<void> {
  await page.waitForURL(/\/dashboard(\?|$)/, { timeout: 30000 });
  await new DashboardPage(page).expectLoaded();
  await page.waitForLoadState('networkidle').catch(() => {});
}

/** "File uploaded successfully" notification for the file */
export const successToast = (page: Page, fileName: string) =>
  page.locator('[data-sonner-toast]').filter({ hasText: 'File uploaded successfully' }).filter({ hasText: fileName });

/** Client chosen for SIF uploads (Client Name is required for SIF files) */
export const UPLOAD_CLIENT = process.env.UPLOAD_CLIENT || 'Riverstone Corp';

/**
 * Dashboard > Upload New File: document type, file (Choose File), client for SIF files, Upload and Process. The app
 * returns to the Dashboard (checked fully loaded). Returns the file name; the caller checks the notification.
 */
export async function uploadFromDashboard(page: Page, file: string, type: UploadDocumentType): Promise<string> {
  const fileName = path.basename(file);
  const dashboard = new DashboardPage(page);
  const upload = new UploadPage(page);
  await dashboard.navigate();
  await dashboard.uploadNewFileButton.click();
  await upload.waitForReady();
  await upload.selectDocumentType(type);
  await upload.chooseFileViaDialog(file);
  await expect(upload.selectedFileName(fileName)).toBeVisible();
  if (path.extname(file).toLowerCase() === '.sif') await upload.selectClient(UPLOAD_CLIENT);
  const result = await upload.submitUpload();
  expect(result.status, `uploadDocument: ${JSON.stringify(result.body).slice(0, 300)}`).toBe(202);
  await waitForDashboardLoaded(page);
  return fileName;
}

// ---------------------------------------------------------------------------------------------
// Values shared by the steps of one run (kept in a file: a failed test restarts the worker)
// ---------------------------------------------------------------------------------------------

export interface SmokeState {
  /** 02: PO uploaded from the Dashboard, and its review page */
  poFileName?: string;
  reviewUrl?: string;
  /** 03: Review in Stream link of the emailed PO's reply */
  poReviewInStreamUrl?: string;
  poEmailFile?: string;
  /** 04: email flow project and thread */
  emailProjectName?: string;
  emailProjectId?: string;
  emailToken?: string;
  emailSubject?: string;
  emailPoFile?: string;
  emailPoMessageId?: string;
  emailPoAckMessageId?: string;
  emailPoSentAt?: string;
  ackMessageId?: string;
  ackSentAt?: string;
  reportMessageId?: string;
  reportReceivedAt?: string;
  /** 05: SIF Conversion file */
  sifUploaded?: boolean;
  sifReady?: boolean;
  sifSaved?: boolean;
  sifConverted?: boolean;
  sifText?: string;
  /** 06: Auto Renewal organization and Admin */
  renewalOrgId?: string;
  renewalOrgName?: string;
  renewalOrgDeleted?: boolean;
  renewalUserAddedAt?: string;
  renewalSetPasswordLink?: string;
  renewalPasswordSet?: boolean;
  renewalPaidAt?: string;
  renewalDate?: string;
  renewalCleanupStarted?: boolean;
}

const stateFile = () => path.join(os.tmpdir(), `riverstream-smoke-${process.env.RS_RUN_ID ?? process.ppid}.json`);

export function readSmokeState(): SmokeState {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), 'utf8')) as SmokeState;
  } catch {
    return {};
  }
}

export function updateSmokeState(update: Partial<SmokeState>): SmokeState {
  const next = { ...readSmokeState(), ...update };
  fs.writeFileSync(stateFile(), JSON.stringify(next, null, 2));
  return next;
}

/** Skips the test (with the reason) when an earlier smoke step did not produce `value` */
export function requires(value: unknown, what: string): void {
  test.skip(!value, `Needs ${what}, which did not complete in this run`);
}

/** Skips the email cases when the .env mailbox is not set */
export function requireMailbox(): void {
  test.skip(!Config.email.senderEmail || !Config.email.senderAppPassword, 'SENDER_EMAIL / SENDER_APP_PASSWORD are not set in .env');
}
