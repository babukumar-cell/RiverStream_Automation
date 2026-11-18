import { test, expect } from '../../../src/fixtures/test.fixture';
import { Config } from '../../../src/config/environment';
import { DocumentsPage } from '../../../src/pages/documents.page';
import { createNamedCopy } from '../../../src/utils/file-utils';
import {
  AUTOMATION_USER,
  RUN,
  SIF_SOURCE,
  SuiteState,
  addAutomationUser,
  attachEvidence,
  deleteAutomationUser,
  emailField,
  emailFieldValue,
  reasonText,
  requires,
  showEmail,
  superAdminOrgId,
  waitForFailureEmail,
} from './support/erp-fail-data';

/*
 * River Stream - ERP fail (TC_ERP_001 - TC_ERP_002)
 *
 * The Super Admin uploads a valid SIF file (Quote Request), opens it with the Review button, replaces the Customer
 * Name with a customer that is not in the ERP, clicks Complete and Submit to ERP. The ERP rejects the quotation:
 *   TC_ERP_001 - the "ERP Insertion Failed" popup is shown and the alert email is received (Inbox or Spam folder)
 *   TC_ERP_002 - the alert email shows the user, organization, file, upload date and time and the failure reason
 * The automation mailbox is added as an Admin of the organization before the tests (the alert goes to the
 * organization's admins) and deleted after them if this run created it (an existing automation user is kept).
 */

const CUSTOMER = 'Customer Name';
const state: SuiteState = {};

test.describe('River Stream - ERP fail (TC_ERP_001 - TC_ERP_002)', () => {
  // One flow, in order; retries would upload and submit again
  test.describe.configure({ mode: 'serial', retries: 0 });

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    state.orgId = superAdminOrgId();
    const { orgName, created } = await addAutomationUser(browser, state.orgId);
    state.orgName = orgName;
    state.userCreated = created;
    state.userAdded = true;
  });

  test.afterAll(async ({ browser }) => {
    test.setTimeout(180_000);
    // Only a user this run created is deleted (an existing user of the organization is kept)
    if (state.orgId && state.userCreated) await deleteAutomationUser(browser, state.orgId);
  });

  test('TC_ERP_001: Validate ERP Estimate Insertion Failed.', async ({ page, dashboardPage, uploadPage, reviewPage, mailService }, testInfo) => {
    test.setTimeout(25 * 60_000);
    requires(state.userAdded, `the automation user ${AUTOMATION_USER.email} in the organization`);

    // 1-3. New upload: a valid SIF file as a Quote Request (the Super Admin session of the project)
    await page.goto('/dashboard');
    await page.getByRole('button', { name: 'Upload New File', exact: true }).click();
    await page.waitForURL(/\/upload\?from=dashboard/);
    await uploadPage.waitForReady();
    const file = createNamedCopy(SIF_SOURCE, RUN.fileName, testInfo.outputPath());
    await uploadPage.selectDocumentType('Quote Request');
    await uploadPage.attachFile(file);
    await expect(uploadPage.selectedFileName(RUN.fileName)).toBeVisible();
    const client = await uploadPage.selectClient(process.env.ERP_FAIL_CLIENT);
    testInfo.annotations.push({ type: 'note', description: `File ${RUN.fileName}, client ${client}, organization ${state.orgName}` });
    state.uploadedAt = new Date();
    const upload = await uploadPage.submitUpload();
    expect(upload.status, `uploadDocument: ${JSON.stringify(upload.body).slice(0, 300)}`).toBe(202);
    expect(upload.requestBody.selectedDocType).toBe('QUOTE_REQUEST');

    // 4. Review button of the file in the Documents library (once the extraction has finished)
    const documents = new DocumentsPage(page);
    const row = documents.rowByName(RUN.fileName);
    await expect(async () => {
      await documents.navigate();
      await documents.searchDocument(RUN.fileName);
      await expect(documents.statusBadge(row)).toHaveText(/^Extracted$/i, { timeout: 5000 });
    }).toPass({ timeout: 300_000, intervals: [10_000, 15_000, 20_000] });
    await documents.reviewButton(row).click();
    await page.waitForURL(/\/review\//);
    await reviewPage.waitForReviewLoaded();
    await expect(reviewPage.fileHeading(RUN.fileName)).toBeVisible();

    // 5. Customer Name: edit icon, a customer that is not in the ERP
    await reviewPage.fieldEditButton(CUSTOMER).click();
    await reviewPage.fieldInput(CUSTOMER).fill(RUN.invalidCustomer);
    await reviewPage.fieldSaveButton(CUSTOMER).click();
    await expect(reviewPage.fieldCard(CUSTOMER)).toContainText(RUN.invalidCustomer);
    await attachEvidence(page, testInfo, '1 - Customer Name changed to a customer that is not in the ERP');

    // 6. Complete
    const saved = page.waitForResponse((r) => r.url().includes('/api/updateDocument') && r.request().method() === 'POST');
    await reviewPage.completeButton.click();
    expect((await saved).status(), 'review saved').toBe(200);
    await expect(reviewPage.toast).toContainText('Document review completed and saved!');
    await expect(reviewPage.statusBadge('Reviewed')).toBeVisible();

    // 7. Submit to ERP: the ERP rejects the quotation
    await expect(reviewPage.submitToErpButton).toBeEnabled();
    const submitted = page.waitForResponse((r) => r.url().includes('/api/submitToErp'), { timeout: 120_000 });
    state.submittedAt = new Date();
    await reviewPage.submitToErpButton.click();
    const response = await submitted;
    testInfo.annotations.push({ type: 'note', description: `submitToErp HTTP ${response.status()}: ${(await response.text().catch(() => '')).slice(0, 300)}` });
    await expect(reviewPage.erpErrorDialog).toBeVisible({ timeout: 60_000 });
    // the visible heading (the dialog also has a hidden title for screen readers with the same text)
    await expect(reviewPage.erpErrorDialog.locator('h2:not([data-slot="dialog-title"])', { hasText: /^ERP Insertion Failed$/ })).toBeVisible();
    await expect(reviewPage.erpErrorDialog.getByText(reasonText(), { exact: true })).toBeVisible();
    state.failurePopupShown = true;
    await attachEvidence(page, testInfo, '2 - ERP Insertion Failed popup');
    await reviewPage.erpErrorDialog.getByRole('button', { name: 'Close' }).first().click();
    await expect(reviewPage.statusBadge('Failed')).toBeVisible();

    // 8-9. The alert email reaches the organization's admins: both folders are checked (Inbox first, then Spam)
    state.reply = await waitForFailureEmail(mailService, state.submittedAt);
    testInfo.annotations.push({ type: 'note', description: `Alert email received in the ${state.reply.mailbox} folder` });
    await showEmail(page, state.reply);
    await expect(page.locator('#rs-mail-subject')).toContainText(RUN.fileName);
    await expect(page.locator('#rs-mail-to')).toContainText(AUTOMATION_USER.email);
    await expect(page.locator('#rs-mail-folder'), 'the email is in the Inbox or the Spam folder').toHaveText(/^(INBOX|.*Spam)$/i);
  });

  test('TC_ERP_002: Verify ERP Estimate Insertion Failed reply.', async ({ page }) => {
    requires(state.reply, 'the ERP Insertion Failed email (TC_ERP_001)');
    const reply = state.reply!;
    await showEmail(page, reply);
    await expect(page.locator('#rs-mail-subject')).toHaveText(new RegExp(`^RiverStream Alert: ERP \\w+ Insertion Failed \\(.+\\) — ${state.orgName} — ${RUN.fileName.replace(/\./g, '\\.')}$`));
    await expect(page.getByRole('heading', { name: /^ERP \w+ Insertion Failed \(.+\)$/ })).toBeVisible();

    // User name, organization name, file name, upload date and time, failure reason
    await expect(emailField(page, 'User')).toHaveText(`User: ${Config.adminEmail}`);
    await expect(emailField(page, 'Organization')).toHaveText(`Organization: ${state.orgName}`);
    await expect(emailField(page, 'File')).toHaveText(`File: ${RUN.fileName}`);
    const uploadedAt = new Date(await emailFieldValue(page, 'Uploaded at'));
    expect(Number.isNaN(uploadedAt.getTime()), 'Uploaded at is a date and time').toBe(false);
    expect(Math.abs(uploadedAt.getTime() - state.uploadedAt!.getTime()), `Uploaded at ${uploadedAt.toISOString()} is the upload time`).toBeLessThan(5 * 60_000);
    await expect(emailField(page, 'Uploaded at')).toBeVisible();
    await expect(emailField(page, 'Reason')).toContainText(reasonText());
  });
});

