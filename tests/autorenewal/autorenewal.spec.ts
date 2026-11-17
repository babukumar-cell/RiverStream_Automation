import fs from 'fs';
import { expect as plainExpect } from '@playwright/test';
import { test, expect } from '../../src/fixtures/test.fixture';
import { Config } from '../../src/config/environment';
import { LoginPage } from '../../src/pages/login.page';
import { LeftSidePage } from '../../src/pages/left-side.page';
import { KpiNames } from '../../src/pages/dashboard.page';
import { OrganizationsPage } from '../../src/pages/settings/organizations.page';
import { OrganizationDetailsPage } from '../../src/pages/settings/organization-details.page';
import { BillingPage, PlanPicker, StripeInvoicePage, clickWhenSettled } from '../../src/pages/billing.page';
import {
  ADMIN_STATE,
  CARDS,
  MONTHLY_PLANS,
  PLAN,
  RUN,
  SUBJECTS,
  addMonth,
  appDate,
  asAdmin,
  asSuperAdmin,
  attachEvidence,
  deleteRunOrganization,
  removeExistingAutomationUser,
  requires,
  restoreExistingAutomationUser,
  mailDate,
  mailField,
  mailLink,
  paymentDays,
  pdfText,
  shortDate,
  showEmail,
  showPdf,
  state,
  waitForMail,
} from './support/autorenewal-data';

/*
 * Source: Test Cases/Module_Wise_Test_Cases/09_Auto_Renewal.xlsx (TC_BILL_001 - TC_BILL_034).
 *
 * Precondition: if riverstreamautomation@gmail.com is already a user (e.g. the Riverstonetech user of the PO-ACK email
 * suite), the Super Admin deletes it before the run and adds it back to its organization after the run.
 *
 * One end-to-end lifecycle, run in order (serial): the Super Admin creates an organization and its Admin user,
 * the Admin subscribes to Growth (Monthly) on Settings > Billing (Stripe test mode): the 4000 0000 0000 0002 card
 * is declined, the "Pay Now" button of the Payment Failed email is paid with 4242 4242 4242 4242, then the
 * subscription, emails, invoice and cancellation of auto-renewal are verified, and the user and organization
 * are deleted. A step that needs the result of a failed step is skipped with the reason; the cleanup steps always
 * run. Retries are off: payments cannot be repeated on the same organization.
 */

const ESC = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Cases whose execution video is attached to the report (the project records every case; the report keeps these) */
const VIDEO = { annotation: { type: 'video', description: 'Execution video attached to the report' } };

/** Known bug: RiverStream emails are not delivered (Azure email service), so the cases that wait for an email fail */
const EMAIL_BUG = {
  type: 'issue',
  description: 'Known bug: RiverStream emails are not delivered (Azure email service issue); this step waits for a RiverStream email.',
};

test.describe('River Stream - Auto Renewal (TC_BILL_001 - TC_BILL_034)', () => {
  // In order, one worker. Not 'serial': a failed step must not skip the later independent steps and the cleanup.
  // Each step that needs an earlier one checks for its result (requires) and is skipped with the reason if missing.
  test.describe.configure({ mode: 'default', retries: 0 });
  // Each test signs in explicitly (Super Admin / the run's Admin), as the steps switch users
  test.use({ storageState: { cookies: [], origins: [] } });

  // Precondition of TC_BILL_001: the run's Admin email must not be a RiverStream user yet (deleted here, once per run)
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    await removeExistingAutomationUser(browser);
  });

  test.beforeEach(async () => {
    test.setTimeout(300_000);
  });

  test.afterAll(async ({ browser }) => {
    test.setTimeout(300_000);
    await deleteRunOrganization(browser);
    // The user deleted by the precondition goes back to its organization once the run is over
    await restoreExistingAutomationUser(browser);
  });

  // =========================================================================================
  // Organization and Admin user (Super Admin)
  // =========================================================================================

  test('TC_BILL_001: Verify that the Super Admin can create a new organization.', async ({ page }) => {
    await asSuperAdmin(page);
    const orgs = new OrganizationsPage(page);
    await orgs.goto();
    const dialog = await orgs.openCreateDialog();
    await dialog.nameInput.fill(RUN.orgName);
    await dialog.domainInput.fill(RUN.domain);
    await dialog.selectPlan('Free Trial');
    state.orgId = await dialog.submit();
    expect(state.orgId, 'createOrganization returned the orgId').toMatch(/^ORG\d+$/);

    await orgs.search(RUN.orgName);
    const card = orgs.orgCard(RUN.orgName);
    await expect(card).toHaveCount(1);
    await expect(card.getByRole('heading', { name: RUN.orgName, exact: true })).toBeVisible();
    await expect(orgs.cardDomain(card)).toHaveText(RUN.domain);
    await expect(orgs.cardStatusBadge(card)).toHaveText('Active');
  });

  test('TC_BILL_002: Verify that the Super Admin can add an Admin user to the new organization.', async ({ page }) => {
    requires(state.orgId, 'the organization (TC_BILL_001)');
    await asSuperAdmin(page);
    const details = new OrganizationDetailsPage(page);
    await details.goto(state.orgId!);
    await details.expectLoaded(RUN.orgName);
    await details.addUserButton.click();
    await expect(details.addUserDialog.heading).toBeVisible();
    // The first user of a Free Trial organization is always an Admin
    await expect(details.addUserDialog.root.getByText('The first user of a Free Trial organization is always an Admin.')).toBeVisible();
    await details.addUserDialog.fill({ firstName: RUN.adminFirstName, lastName: RUN.adminLastName, email: RUN.adminEmail });
    state.userAddedAt = new Date();
    await details.addUserDialog.submit();

    const row = details.userRow(RUN.adminEmail);
    await expect(row).toBeVisible({ timeout: 20000 });
    await expect(row).toContainText(`${RUN.adminFirstName} ${RUN.adminLastName}`);
    await expect(details.userRowRole(row)).toHaveText(/^admin$/i);
  });

  test('TC_BILL_003: Verify that the new Admin user receives the set password email.', { annotation: EMAIL_BUG }, async ({ page, mailService }) => {
    requires(state.userAddedAt, 'the Admin user (TC_BILL_002)');
    const mail = await waitForMail(mailService, SUBJECTS.setPassword, state.userAddedAt!);
    state.setPasswordLink = mailLink(mail, /\/set-password\?token=/);
    await showEmail(page, mail);
    await expect(page.locator('#rs-mail-subject')).toHaveText(SUBJECTS.setPassword);
    await expect(page.getByText(/Your RiverStream account has been created\./)).toBeVisible();
    await expect(page.locator('a[href*="/set-password?token="]')).toBeVisible();
  });

  test('TC_BILL_004: Verify that the Admin user can set the password from the email link.', async ({ page }) => {
    requires(state.setPasswordLink, 'the set password email (TC_BILL_003)');
    await page.goto(state.setPasswordLink!);
    await expect(page.getByText('Set your password', { exact: true })).toBeVisible();
    await page.getByPlaceholder('At least 8 characters').fill(RUN.adminPassword);
    await page.getByPlaceholder('Re-enter your password').fill(RUN.adminPassword);
    const saved = page.waitForResponse((r) => /\/api\/setPassword\b/.test(r.url()) && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Set Password', exact: true }).click();
    expect((await saved).status(), 'setPassword API status').toBe(200);
    await expect(page.getByText('Password set successfully!', { exact: true })).toBeVisible();
    state.passwordSet = true;
  });

  test('TC_BILL_005: Verify that the Admin user can log in to the new organization.', async ({ page, dashboardPage }) => {
    requires(state.passwordSet, 'the Admin password (TC_BILL_004)');
    const login = new LoginPage(page);
    await login.navigate();
    await login.loginAndWaitForDashboard(RUN.adminEmail, RUN.adminPassword);
    // Dashboard fully loaded: card counts ("..." while loading) and the document list (empty organization)
    await dashboardPage.expectLoaded();
    for (const name of KpiNames) {
      await expect(dashboardPage.kpiTab(name), `${name} card count`).toHaveText(new RegExp(`^\\s*${name}\\s*\\d[\\d,]*`), { timeout: 60000 });
    }
    await expect(page.getByText(/^Loading documents/)).toHaveCount(0, { timeout: 60000 });
    const shell = new LeftSidePage(page);
    await expect(shell.headerUserName(`${RUN.adminFirstName} ${RUN.adminLastName}`)).toBeVisible();
    await expect(shell.planName).toHaveText('Free trial Plan');
    // The next steps reuse this session
    await page.context().storageState({ path: ADMIN_STATE });
  });

  // =========================================================================================
  // Billing page and plans (Admin)
  // =========================================================================================

  test('TC_BILL_006: Verify that the Billing page opens from Settings.', async ({ page }) => {
    await asAdmin(page);
    await page.goto('/dashboard');
    const billing = new BillingPage(page);
    await billing.openFromSidebar();
    await expect(billing.heading).toBeVisible();
    await expect(billing.subtitle).toBeVisible();
    await expect(billing.tab('Overview')).toHaveAttribute('aria-selected', 'true');
    await expect(billing.tab('Billing History')).toBeVisible();
  });

  test('TC_BILL_007: Verify the Subscription period options on the Billing page.', async ({ page }) => {
    await asAdmin(page);
    const billing = new BillingPage(page);
    await billing.goto();
    await expect(billing.plans.periodLabel).toBeVisible();
    await expect(page.getByText('Monthly', { exact: true })).toBeVisible();
    await expect(page.getByText('Yearly (save 9%)', { exact: true })).toBeVisible();
    await billing.plans.selectPeriod('Monthly');
    await expect(billing.plans.periodRadio('Monthly')).toBeChecked();
    await expect(billing.plans.periodRadio('Yearly')).not.toBeChecked();
  });

  test('TC_BILL_008: Verify the plan details displayed for the Monthly subscription period.', async ({ page }) => {
    await asAdmin(page);
    const billing = new BillingPage(page);
    await billing.goto();
    await billing.plans.selectPeriod('Monthly');
    for (const [plan, data] of Object.entries(MONTHLY_PLANS) as [keyof typeof MONTHLY_PLANS, (typeof MONTHLY_PLANS)[keyof typeof MONTHLY_PLANS]][]) {
      const card = billing.plans.card(plan);
      await expect(card.getByText(data.tagline, { exact: true })).toBeVisible();
      await expect(billing.plans.price(plan)).toHaveText(data.price);
      await expect(card.getByText('/ month', { exact: true })).toBeVisible();
      await expect(card.getByText('Save 9% with annual billing', { exact: true })).toBeVisible();
      await expect(billing.plans.features(plan)).toHaveText([...data.features]);
      await expect(billing.plans.cta(plan)).toHaveText('Get Started');
    }
  });

  test('TC_BILL_009: Verify that a plan can be selected.', async ({ page }) => {
    await asAdmin(page);
    const billing = new BillingPage(page);
    await billing.goto();
    await billing.plans.selectPeriod('Monthly');
    await billing.plans.selectPlan('Starter');
    await billing.plans.selectPlan('Growth');
    // checked without highlighting: only the selected plan (Growth) is highlighted in the evidence
    await plainExpect(billing.plans.card('Starter')).toHaveAttribute('aria-pressed', 'false');
    await expect(billing.selectedPlanValue).toHaveText('Growth');
    await expect(billing.plans.card('Growth')).toHaveAttribute('aria-pressed', 'true');
  });

  test('TC_BILL_010: Verify that the Get Started button redirects to the Stripe payment page.', async ({ page }) => {
    await asAdmin(page);
    const billing = new BillingPage(page);
    await billing.goto();
    await billing.startCheckout('Growth', 'Monthly');
    await expect(billing.subscribingTo).toHaveText(`Subscribing to ${PLAN.label}`);
    await expect(billing.subscribingAmount).toHaveText(/^\$449\.00\s*\/\s*month$/);
    await expect(billing.chargeNote).toHaveText('Your card will be charged automatically every month until you cancel.');
    await expect(billing.subscribeButton).toHaveText(`Subscribe for ${PLAN.amount}`);
    await expect(billing.paymentElement.cardTab).toBeVisible();
  });

  // =========================================================================================
  // Failed payment
  // =========================================================================================

  test('TC_BILL_011: Verify the Card payment method on the Stripe payment page.', async ({ page }) => {
    await asAdmin(page);
    const billing = new BillingPage(page);
    await billing.goto();
    await billing.startCheckout('Growth', 'Monthly');
    await billing.paymentElement.selectCard();
    await expect(billing.paymentElement.cardNumber).toBeVisible();
    await expect(billing.paymentElement.expiry).toBeVisible();
    await expect(billing.paymentElement.cvc).toBeVisible();
  });

  test('TC_BILL_012: Verify that the payment fails with a declined card.', async ({ page }) => {
    await asAdmin(page);
    const billing = new BillingPage(page);
    await billing.goto();
    await billing.startCheckout('Growth', 'Monthly');
    await billing.paymentElement.selectCard();
    await billing.paymentElement.fillCard(CARDS.declined);
    const confirm = page.waitForResponse((r) => /api\.stripe\.com\/v1\/payment_intents\/[^/]+\/confirm/.test(r.url()), { timeout: 90000 });
    state.failedAt = new Date();
    await clickWhenSettled(billing.subscribeButton);
    expect((await confirm).status(), 'Stripe declines the payment (HTTP 402)').toBe(402);
    await expect(billing.paymentError).toHaveText('Your card has been declined.', { timeout: 30000 });
    await expect(billing.subscribeButton).toHaveText(`Subscribe for ${PLAN.amount}`);
  });

  test('TC_BILL_013: Verify that the plan is not active after the failed payment.', async ({ page }) => {
    await asAdmin(page);
    const billing = new BillingPage(page);
    await billing.goto();
    await expect(billing.subscriptionCard).toHaveCount(0);
    await billing.plans.selectPeriod('Monthly');
    await expect(billing.plans.card('Growth').getByText('Current Plan', { exact: true })).toHaveCount(0);
    await expect(billing.plans.cta('Growth')).toHaveText('Get Started');
    await expect(new LeftSidePage(page).planName).toHaveText('Free trial Plan');
  });

  test('TC_BILL_014: Verify the Payment Failed email.', { annotation: EMAIL_BUG }, async ({ page, mailService }) => {
    requires(state.failedAt, 'the declined payment (TC_BILL_012)');
    const mail = await waitForMail(mailService, SUBJECTS.paymentFailed, state.failedAt!);
    state.payNowLink = mailLink(mail, /^https:\/\/invoice\.stripe\.com\//);
    await showEmail(page, mail);
    await expect(page.locator('#rs-mail-subject')).toHaveText(SUBJECTS.paymentFailed);
    await expect(page.getByText('Payment Failed', { exact: true })).toBeVisible();
    await expect(
      page.getByText(`Your payment for ${RUN.orgName}'s RiverStream ${PLAN.label} plan could not be processed, so the plan is not active yet.`),
    ).toBeVisible();
    await expect(mailField(page, 'Plan')).toHaveText(PLAN.label);
    await expect(mailField(page, 'Amount due')).toHaveText(PLAN.usd);
    await expect(mailField(page, 'Card')).toHaveText('Visa ending 0002');
    await expect(mailField(page, 'Reason')).toHaveText('Your card was declined');
    await expect(page.getByRole('link', { name: 'Pay Now', exact: true })).toBeVisible();
  });

  test('TC_BILL_015: Verify that the Pay Now button in the Payment Failed email redirects to the Stripe payment page.', { annotation: EMAIL_BUG }, async ({ page, mailService }) => {
    requires(state.failedAt, 'the declined payment (TC_BILL_012)');
    const mail = await waitForMail(mailService, SUBJECTS.paymentFailed, state.failedAt!);
    await showEmail(page, mail);
    await page.getByRole('link', { name: 'Pay Now', exact: true }).click();
    await page.waitForURL(/^https:\/\/invoice\.stripe\.com\//);
    const invoice = new StripeInvoicePage(page);
    await invoice.waitForLoaded();
    await expect(invoice.amount).toHaveText(PLAN.amount);
    await expect(invoice.invoiceTo).toHaveText(RUN.orgName);
    await expect(invoice.invoiceNumber).toHaveText(/^#\S+$/);
    state.stripeInvoiceNo = (await invoice.invoiceNumber.innerText()).replace('#', '').trim();
    await expect(invoice.paymentElement.cardTab).toBeVisible();
  });

  // =========================================================================================
  // Successful payment
  // =========================================================================================

  test('TC_BILL_016: Verify that the payment succeeds with a valid card.', async ({ page }, testInfo) => {
    requires(state.payNowLink, 'the Pay Now link of the Payment Failed email (TC_BILL_014)');
    await page.goto(state.payNowLink!);
    const invoice = new StripeInvoicePage(page);
    await invoice.waitForLoaded();
    await invoice.chooseUsd();
    await invoice.paymentElement.selectCard();
    await invoice.paymentElement.fillCard(CARDS.success);
    state.paidAt = new Date();
    await clickWhenSettled(invoice.payButton);
    await expect(invoice.paidHeading).toBeVisible({ timeout: 90000 });
    await expect(page.getByText(PLAN.amount, { exact: true }).first()).toBeVisible();
    await expect(invoice.paymentMethod).toHaveText(/Visa\s*•+\s*4242/);
    await attachEvidence(page, testInfo, '1 - Stripe: Invoice paid');

    // The app applies the payment (Stripe webhook): the subscription becomes Active
    const billing = new BillingPage(page);
    await asAdmin(page);
    await billing.waitForSubscriptionBadge(/^Active$/);
    await expect(billing.subscriptionBadge).toHaveText('Active');
  });

  test('TC_BILL_017: Verify the Billing Overview after the successful payment.', async ({ page }) => {
    requires(state.paidAt, 'the successful payment (TC_BILL_016)');
    await asAdmin(page);
    const billing = new BillingPage(page);
    await billing.goto();
    await expect(billing.tab('Overview')).toHaveAttribute('aria-selected', 'true');
    await expect(billing.subscriptionPlan).toHaveText(PLAN.label);
    await expect(billing.subscriptionBadge).toHaveText('Active');
    const renewal = appDate(addMonth(paymentDays(state.paidAt!)[0]));
    await expect(billing.subscriptionStatusText).toHaveText(/^Renews automatically on \d{1,2}\/\d{1,2}\/\d{4}\.$/);
    state.renewalDate = (await billing.subscriptionStatusText.innerText()).match(/on (\S+)\.$/)![1];
    expect([renewal, appDate(addMonth(paymentDays(state.paidAt!).slice(-1)[0]))], 'renewal date is one month after the payment').toContain(state.renewalDate);
    await expect(billing.switchPlansNote).toBeVisible();
  });

  test('TC_BILL_018: Verify the "Your Growth plan is active" email.', { annotation: EMAIL_BUG }, async ({ page, mailService }) => {
    requires(state.paidAt, 'the successful payment (TC_BILL_016)');
    const mail = await waitForMail(mailService, SUBJECTS.planActive, state.paidAt!);
    await showEmail(page, mail);
    await expect(page.locator('#rs-mail-subject')).toHaveText(SUBJECTS.planActive);
    await expect(page.getByText('Purchase Successful', { exact: true })).toBeVisible();
    await expect(page.getByText(`Thank you for subscribing. ${RUN.orgName}'s RiverStream ${PLAN.label} plan is now active.`)).toBeVisible();
    await expect(mailField(page, 'Plan')).toHaveText(PLAN.label);
    await expect(mailField(page, 'Invoice')).toHaveText(/^\S+-\d+$/);
    state.invoiceNo = (await mailField(page, 'Invoice').innerText()).trim();
    if (state.stripeInvoiceNo) expect(state.invoiceNo, 'same invoice as the Stripe page').toBe(state.stripeInvoiceNo);
    await expect(mailField(page, 'Amount paid')).toHaveText(PLAN.usd);

    const paidOn = (await mailField(page, 'Paid on').innerText()).trim();
    expect(paymentDays(state.paidAt!).map(mailDate), 'Paid on is the payment date').toContain(paidOn);
    const paidDay = new Date(paidOn);
    const renewal = mailDate(addMonth(paidDay));
    await expect(mailField(page, 'Paid on')).toHaveText(paidOn);
    await expect(mailField(page, 'Service period')).toHaveText(`${paidOn} - ${renewal}`);
    await expect(mailField(page, 'Next renewal')).toHaveText(renewal);
    await expect(mailField(page, 'Paid with')).toHaveText('Visa ending in 4242');
    await expect(page.locator('#rs-mail-attachments')).toHaveText(`Invoice-${state.invoiceNo}.pdf`);
    await expect(page.getByRole('link', { name: 'View Billing', exact: true })).toBeVisible();
  });

  test('TC_BILL_019: Verify that the View Billing button in the email redirects to the application Billing page.', { annotation: [VIDEO.annotation, EMAIL_BUG] }, async ({ page, mailService }) => {
    requires(state.paidAt, 'the successful payment (TC_BILL_016)');
    const mail = await waitForMail(mailService, SUBJECTS.planActive, state.paidAt!);
    await asAdmin(page);
    await showEmail(page, mail);
    await page.getByRole('link', { name: 'View Billing', exact: true }).click();
    await page.waitForURL(/\/settings\/billing$/);
    const billing = new BillingPage(page);
    await billing.waitForBillingLoaded();
    await expect(billing.heading).toBeVisible();
    await expect(billing.subscriptionPlan).toHaveText(PLAN.label);
  });

  test('TC_BILL_020: Verify that the subscribed plan is badged as Current Plan.', async ({ page }) => {
    requires(state.paidAt, 'the successful payment (TC_BILL_016)');
    await asAdmin(page);
    const billing = new BillingPage(page);
    await billing.goto();
    await expect(billing.plans.periodRadio('Monthly')).toBeChecked();
    await expect(billing.plans.card('Growth')).toHaveClass(/border-dashed/);
    await expect(billing.plans.cta('Growth')).toHaveText('Current Plan');
    await expect(billing.plans.cta('Growth')).toBeDisabled();
    await billing.plans.currentPlanBadge('Growth').scrollIntoViewIfNeeded();
    await expect(billing.plans.currentPlanBadge('Growth')).toBeVisible();
  });

  test('TC_BILL_021: Verify that switching plans is blocked while the subscription renews automatically.', VIDEO, async ({ page }) => {
    requires(state.paidAt, 'the successful payment (TC_BILL_016)');
    await asAdmin(page);
    const billing = new BillingPage(page);
    await billing.goto();
    await expect(billing.switchPlansNote).toBeVisible();
    for (const plan of ['Starter', 'Pro'] as const) {
      await expect(billing.plans.cta(plan)).toHaveText('Contact Sales');
      await expect(billing.plans.cta(plan)).toBeDisabled();
    }
    await billing.plans.cta('Pro').scrollIntoViewIfNeeded();
    await expect(billing.plans.cta('Starter')).toBeVisible();
    await expect(billing.plans.cta('Pro')).toBeVisible();
  });

  // =========================================================================================
  // Super Admin view
  // =========================================================================================

  test('TC_BILL_022: Verify that the Super Admin can see the current plan of the new organization.', async ({ page }) => {
    requires(state.paidAt, 'the successful payment (TC_BILL_016)');
    await asAdmin(page);
    await page.goto('/dashboard');
    await new LeftSidePage(page).clickLogout();
    await new LoginPage(page).loginAndWaitForDashboard(Config.adminEmail, Config.adminPassword);

    const orgs = new OrganizationsPage(page);
    await orgs.goto();
    await orgs.openDetails(RUN.orgName);
    const details = new OrganizationDetailsPage(page);
    await details.expectLoaded(RUN.orgName);
    await expect(details.planInput).toHaveValue(/^Growth \(monthly\)$/i);
    await details.payNowButton.click();
    const picker = new PlanPicker(page, page.locator('main'));
    await expect(picker.card('Growth')).toBeVisible();
    await expect(picker.cta('Growth')).toHaveText('Current Plan');
    await picker.currentPlanBadge('Growth').scrollIntoViewIfNeeded();
    await expect(picker.currentPlanBadge('Growth')).toBeVisible();
  });

  // =========================================================================================
  // Billing history and invoice
  // =========================================================================================

  test('TC_BILL_023: Verify the Billing History tab.', async ({ page }) => {
    requires(state.paidAt, 'the successful payment (TC_BILL_016)');
    await asSuperAdmin(page);
    await page.goto('/dashboard');
    await new LeftSidePage(page).clickLogout();
    await new LoginPage(page).loginAndWaitForDashboard(RUN.adminEmail, RUN.adminPassword);
    const billing = new BillingPage(page);
    await billing.openFromSidebar();
    await billing.openTab('Billing History');

    await expect(billing.historyHeaders).toHaveText(['Invoice', 'Paid on', 'Plan', 'Type', 'Service period', 'Card', 'Amount', 'Invoice PDF']);
    await expect(billing.historyRows).toHaveCount(1);
    const row = billing.historyRows.first();
    await expect(billing.historyCell(row, 'Invoice')).toHaveText(state.invoiceNo ?? /\S+-\d+/);
    await expect(billing.historyCell(row, 'Paid on')).toHaveText(/^\d{1,2}\/\d{1,2}\/\d{4}, /);
    await expect(billing.historyCell(row, 'Plan')).toHaveText(PLAN.label);
    await expect(billing.historyCell(row, 'Type')).toHaveText('New subscription');
    await expect(billing.historyCell(row, 'Service period')).toHaveText(/^\d{1,2}\/\d{1,2}\/\d{4} - \d{1,2}\/\d{1,2}\/\d{4}$/);
    await expect(billing.historyCell(row, 'Card')).toHaveText(/Visa\s*•+\s*4242/);
    await expect(billing.historyCell(row, 'Amount')).toHaveText(PLAN.usd);
    await expect(billing.downloadButton(row)).toBeEnabled();
    state.invoiceNo ??= (await billing.historyCell(row, 'Invoice').innerText()).trim();
  });

  test('TC_BILL_024: Verify that the invoice can be downloaded.', async ({ page }, testInfo) => {
    requires(state.invoiceNo, 'the invoice number (TC_BILL_018 / 023)');
    await asAdmin(page);
    const billing = new BillingPage(page);
    await billing.goto();
    await billing.openTab('Billing History');
    const row = billing.historyRows.first();
    const downloading = page.waitForEvent('download');
    await billing.downloadButton(row).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe(`Invoice-${state.invoiceNo}.pdf`);
    state.invoicePdf = testInfo.outputPath(download.suggestedFilename());
    await download.saveAs(state.invoicePdf);
    expect(fs.readFileSync(state.invoicePdf).subarray(0, 5).toString(), 'the downloaded file is a PDF').toBe('%PDF-');
    await testInfo.attach(download.suggestedFilename(), { path: state.invoicePdf, contentType: 'application/pdf' });
    await expect(billing.downloadButton(row)).toHaveText('Download');
  });

  test('TC_BILL_025: Verify the details in the downloaded invoice.', async ({ page }) => {
    requires(state.invoicePdf, 'the downloaded invoice (TC_BILL_024)');
    const texts = await showPdf(page, state.invoicePdf!);
    test.info().annotations.push({ type: 'Invoice text', description: texts.join(' | ').slice(0, 1500) });
    const issued = paymentDays(state.paidAt!).map(mailDate);
    const date = new RegExp(`^(${issued.map(ESC).join('|')})$`);
    const period = new RegExp(`^(${paymentDays(state.paidAt!).map((d) => ESC(`${shortDate(d)} - ${shortDate(addMonth(d))}`)).join('|')})$`);

    await expect(pdfText(page, /^\s*P\s*A\s*I\s*D\s*$/)).toBeVisible(); // invoice status badge (letter-spaced: "PA I D")
    await expect(pdfText(page, 'Invoice No.')).toBeVisible();
    await expect(pdfText(page, state.invoiceNo!)).toBeVisible();
    await expect(pdfText(page, 'Issue Date')).toBeVisible();
    await expect(pdfText(page, date).first()).toBeVisible();
    await expect(pdfText(page, RUN.orgName)).toBeVisible();
    await expect(pdfText(page, 'Plan')).toBeVisible();
    await expect(pdfText(page, PLAN.label)).toBeVisible();
    await expect(pdfText(page, 'Service Period')).toBeVisible();
    await expect(pdfText(page, period).first()).toBeVisible();
    await expect(pdfText(page, 'AMOUNT PAID')).toBeVisible();
    await expect(pdfText(page, PLAN.amount).first()).toBeVisible();
    await expect(pdfText(page, /Visa .*4242$/)).toBeVisible(); // payment details
    await expect(pdfText(page, 'Balance Due')).toBeVisible();
    await expect(pdfText(page, '$0.00')).toBeVisible();
  });

  // =========================================================================================
  // Cancel subscription
  // =========================================================================================

  test('TC_BILL_026: Verify navigating back to the Overview tab.', async ({ page }) => {
    requires(state.paidAt, 'the successful payment (TC_BILL_016)');
    await asAdmin(page);
    const billing = new BillingPage(page);
    await billing.goto();
    await billing.openTab('Billing History');
    await billing.openTab('Overview');
    await expect(billing.subscriptionPlan).toHaveText(PLAN.label);
    await expect(billing.cancelSubscriptionButton).toBeVisible();
  });

  test('TC_BILL_027: Verify the Cancel Subscription confirmation popup.', async ({ page }) => {
    requires(state.paidAt, 'the successful payment (TC_BILL_016)');
    await asAdmin(page);
    const billing = new BillingPage(page);
    await billing.goto();
    await billing.cancelSubscriptionButton.click();
    await expect(billing.cancelPrompt).toBeVisible();
    await expect(billing.confirmCancelButton).toHaveText('Yes, cancel');
    await expect(billing.keepSubscriptionButton).toBeVisible();
  });

  test('TC_BILL_028: Verify that the Keep button does not cancel the subscription renewal.', async ({ page }) => {
    requires(state.renewalDate, 'the active subscription (TC_BILL_017)');
    await asAdmin(page);
    const billing = new BillingPage(page);
    await billing.goto();
    await billing.cancelSubscriptionButton.click();
    await expect(billing.cancelPrompt).toBeVisible();
    await billing.keepSubscriptionButton.click();
    await expect(billing.cancelPrompt).toHaveCount(0);
    await billing.goto();
    await expect(billing.subscriptionBadge).toHaveText('Active');
    await expect(billing.subscriptionStatusText).toHaveText(`Renews automatically on ${state.renewalDate}.`);
    await expect(billing.cancelSubscriptionButton).toBeVisible();
  });

  test('TC_BILL_029: Verify that the Yes, cancel button cancels the subscription renewal.', { annotation: EMAIL_BUG }, async ({ page, mailService }) => {
    test.setTimeout(900_000);
    requires(state.renewalDate, 'the active subscription (TC_BILL_017)');
    await asAdmin(page);
    const billing = new BillingPage(page);
    await billing.goto();
    await billing.cancelSubscriptionButton.click();
    const cancelled = page.waitForResponse((r) => /\/api\/cancelSubscription\b/.test(r.url()) && r.request().method() === 'POST');
    const clickedAt = new Date();
    await billing.confirmCancelButton.click();
    const res = await cancelled;
    expect(res.status(), 'cancelSubscription API status').toBe(200);
    expect((await res.json()).cancelAtPeriodEnd, 'auto-renewal is switched off').toBe(true);
    state.cancelledAt = clickedAt;

    // Status on the Billing page
    await billing.goto();
    await expect(billing.subscriptionBadge).toHaveText(new RegExp(`^Cancels on ${ESC(state.renewalDate!)}$`, 'i'));
    await expect(billing.subscriptionStatusText).toHaveText(`Auto-renewal is off. Your plan stays active until ${state.renewalDate}.`);
    await expect(billing.cancelSubscriptionButton).toHaveCount(0);

    // Notification: the "Auto-renewal cancelled" email (shown in a second tab, also in the report)
    // observed 4.5-5.6 min after the click (2026-11-16): waits up to 10 min
    const mail = await waitForMail(mailService, SUBJECTS.renewalCancelled, clickedAt, 600_000);
    const mailPage = await page.context().newPage();
    await showEmail(mailPage, mail);
    await expect(mailPage.locator('#rs-mail-subject')).toHaveText(SUBJECTS.renewalCancelled);
    await expect(mailPage.getByText(`Auto-renewal has been cancelled for ${RUN.orgName}'s RiverStream ${PLAN.label} plan. You will not be charged again.`)).toBeVisible();
    await expect(mailField(mailPage, 'Plan')).toHaveText(PLAN.label);
    await expect(mailField(mailPage, 'Active until')).toHaveText(mailDate(new Date(state.renewalDate!)));
  });

  test('TC_BILL_030: Verify that the plans are inactive during the cancellation period.', VIDEO, async ({ page }) => {
    requires(state.cancelledAt, 'the cancelled renewal (TC_BILL_029)');
    await asAdmin(page);
    const billing = new BillingPage(page);
    await billing.goto();
    await expect(billing.subscriptionBadge).toHaveText(/^Cancels on /i);
    await expect(billing.plans.cta('Growth')).toHaveText('Current Plan');
    await expect(billing.plans.cta('Growth')).toBeDisabled();
    for (const plan of ['Starter', 'Pro'] as const) await expect(billing.plans.cta(plan)).toBeDisabled();
    await billing.plans.cta('Pro').scrollIntoViewIfNeeded();
    await expect(billing.plans.currentPlanBadge('Growth')).toBeVisible();
    await expect(billing.plans.cta('Starter')).toHaveText('Contact Sales');
    await expect(billing.plans.cta('Pro')).toHaveText('Contact Sales');
  });

  test('TC_BILL_031: Verify that the Super Admin cannot change the plan during the cancellation period.', async ({ page }) => {
    requires(state.cancelledAt, 'the cancelled renewal (TC_BILL_029)');
    await asAdmin(page);
    await page.goto('/dashboard');
    await new LeftSidePage(page).clickLogout();
    await new LoginPage(page).loginAndWaitForDashboard(Config.adminEmail, Config.adminPassword);

    const orgs = new OrganizationsPage(page);
    await orgs.goto();
    await orgs.openDetails(RUN.orgName);
    const details = new OrganizationDetailsPage(page);
    await details.expectLoaded(RUN.orgName);
    await expect(page.getByText(`Auto-renewal is off. Your plan stays active until ${state.renewalDate}.`)).toBeVisible();
    await details.payNowButton.click();
    const picker = new PlanPicker(page, page.locator('main'));
    await picker.selectPeriod('Monthly');
    await picker.selectPlan('Starter');
    await picker.cta('Starter').click();
    await expect(picker.switchBlockedMessage).toBeVisible();
    await expect(picker.currentPlanBadge('Growth')).toBeVisible();
    await picker.switchBlockedMessage.scrollIntoViewIfNeeded();
  });

  // =========================================================================================
  // Expiry
  // =========================================================================================

  test('TC_BILL_032: Verify that the subscription expiry email is received before the subscription expires.', async () => {
    test.fixme(
      true,
      'Manual: the expiry reminder is sent shortly before the "Cancels On" date (one month after the payment) and cannot be ' +
        'triggered on demand; this run deletes its organization at the end (TC_BILL_034).',
    );
  });

  // =========================================================================================
  // Cleanup
  // =========================================================================================

  test('TC_BILL_033: Verify that the Super Admin can delete the Admin user of the new organization.', VIDEO, async ({ page }) => {
    requires(state.orgId, 'the organization (TC_BILL_001)');
    await asSuperAdmin(page);
    const details = new OrganizationDetailsPage(page);
    await details.goto(state.orgId!);
    await details.expectLoaded(RUN.orgName);
    const row = details.userRow(RUN.adminEmail);
    await expect(row).toBeVisible();
    await details.userRowDeleteButton(row).click();
    await expect(details.confirmDeleteDialog.message).toHaveText('Are you sure you want to delete this user?');
    const deleted = page.waitForResponse((r) => /\/api\/deleteUser\b/.test(r.url()) && r.request().method() === 'DELETE');
    await details.confirmDeleteDialog.confirmButton.click();
    expect((await deleted).status(), 'deleteUser API status').toBe(200);
    await expect(details.userRow(RUN.adminEmail)).toHaveCount(0);
    await expect(details.noUsersMessage).toBeVisible();
  });

  test('TC_BILL_034: Verify that the Super Admin can delete the new organization.', VIDEO, async ({ page }) => {
    requires(state.orgId, 'the organization (TC_BILL_001)');
    // Last step: if it fails, afterAll deletes what is left (before this step, afterAll never deletes anything)
    state.cleanupStarted = true;
    await asSuperAdmin(page);
    const details = new OrganizationDetailsPage(page);
    await details.goto(state.orgId!);
    await details.expectLoaded(RUN.orgName);
    await details.deleteButton.click();
    await expect(details.confirmDeleteDialog.message).toHaveText(`Are you sure you want to delete ${RUN.orgName}?`);
    const deleted = page.waitForResponse((r) => /\/api\/deleteOrganization/i.test(r.url()), { timeout: 30000 });
    await details.confirmDeleteDialog.confirmButton.click();
    expect((await deleted).status(), 'deleteOrganization API status').toBe(200);
    state.orgDeleted = true;
    await page.waitForURL(/\/organizations$/);

    const orgs = new OrganizationsPage(page);
    await orgs.search(RUN.orgName);
    await expect(orgs.orgCard(RUN.orgName)).toHaveCount(0);
    await expect(orgs.noOrganizationsMessage).toBeVisible();
  });
});
