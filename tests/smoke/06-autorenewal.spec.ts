import fs from 'fs';
import os from 'os';
import path from 'path';
import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../src/fixtures/test.fixture';
import { LoginPage } from '../../src/pages/login.page';
import { BillingPage, clickWhenSettled } from '../../src/pages/billing.page';
import { OrganizationsPage } from '../../src/pages/settings/organizations.page';
import { OrganizationDetailsPage } from '../../src/pages/settings/organization-details.page';
import { uniqueName } from '../../src/test-data/qa-data';
import { Config } from '../../src/config/environment';
import {
  CARDS,
  PLAN,
  RUN,
  SUBJECTS,
  asSuperAdmin,
  mailLink,
  removeExistingAutomationUser,
  restoreExistingAutomationUser,
  showEmail,
  waitForMail,
} from '../autorenewal/support/autorenewal-data';
import { attachEvidence, readSmokeState, requireMailbox, requires, updateSmokeState } from './support/smoke';

/*
 * Smoke 06: Auto Renewal (TC_SMOKE_035 - TC_SMOKE_041), the last part of the smoke suite. The Super Admin creates a
 * Free Trial organization (AUTO_SmokeRenewal_<date>) and its Admin riverstreamautomation@gmail.com, the Admin sets the
 * password from the email, signs in, subscribes to Growth (Monthly) with the Stripe test card 4242 4242 4242 4242,
 * gets the "plan is active" email, cancels the auto-renewal, and the Super Admin deletes the user and the organization.
 * Before: if riverstreamautomation@gmail.com is already a user (e.g. the riverstonetech user of the email smoke cases),
 * it is deleted; after the run it is added back with the same name, organization and role.
 */

/** Name of the run's organization (saved by TC_SMOKE_035: a worker restarted after a failure must reuse it) */
const orgName = () => readSmokeState().renewalOrgName ?? '';
const ADMIN = { firstName: 'Smoke', lastName: 'Renewal', email: RUN.adminEmail, password: RUN.adminPassword };
const ADMIN_STATE = path.join(os.tmpdir(), `riverstream-smoke-renewal-admin-${process.env.RS_RUN_ID ?? process.ppid}.json`);

/** Signs the page in with the saved session of the new Admin (TC_SMOKE_037) */
async function asAdmin(page: Page): Promise<void> {
  requires(fs.existsSync(ADMIN_STATE), 'the Admin login (TC_SMOKE_037)');
  const saved = JSON.parse(fs.readFileSync(ADMIN_STATE, 'utf8')) as { cookies: Parameters<BrowserContext['addCookies']>[0] };
  await page.context().clearCookies();
  await page.context().addCookies(saved.cookies);
}

test.describe('Smoke 06: Auto Renewal (TC_SMOKE_035 - TC_SMOKE_041)', () => {
  test.describe.configure({ mode: 'default', retries: 0 });
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    await removeExistingAutomationUser(browser);
  });

  test.beforeEach(async () => {
    test.setTimeout(300_000);
  });

  test.afterAll(async ({ browser }) => {
    test.setTimeout(300_000);
    const s = readSmokeState();
    // Safety net once the cleanup step started: delete what is left of the organization
    if (s.renewalOrgId && !s.renewalOrgDeleted && s.renewalCleanupStarted) {
      const context = await browser.newContext({ storageState: Config.adminStorageState });
      try {
        const details = new OrganizationDetailsPage(await context.newPage());
        await details.goto(s.renewalOrgId);
        if (!(await details.notFoundMessage.isVisible().catch(() => false))) await details.deleteWithConfirmation();
        updateSmokeState({ renewalOrgDeleted: true });
      } catch (err) {
        console.warn(`[smoke] cleanup of ${s.renewalOrgId} failed, delete it manually: ${(err as Error).message}`);
      } finally {
        await context.close();
      }
    }
    // The automation user goes back to its organization once the run is over (or when no organization was created)
    if (s.renewalCleanupStarted || !s.renewalOrgId) await restoreExistingAutomationUser(browser);
  });

  test('TC_SMOKE_035: Verify that the Super Admin can create a new organization.', async ({ page }) => {
    await asSuperAdmin(page);
    const orgs = new OrganizationsPage(page);
    await orgs.goto();
    const ORG_NAME = uniqueName('SmokeRenewal');
    const dialog = await orgs.openCreateDialog();
    await dialog.nameInput.fill(ORG_NAME);
    await dialog.domainInput.fill(`${ORG_NAME.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`);
    await dialog.selectPlan('Free Trial');
    const orgId = await dialog.submit();
    expect(orgId, 'createOrganization returned the orgId').toMatch(/^ORG\d+$/);
    updateSmokeState({ renewalOrgId: orgId, renewalOrgName: ORG_NAME, renewalOrgDeleted: false, renewalCleanupStarted: false, renewalPasswordSet: false });
    await orgs.search(ORG_NAME);
    const card = orgs.orgCard(ORG_NAME);
    await expect(card).toHaveCount(1);
    await expect(orgs.cardStatusBadge(card)).toHaveText('Active');
  });

  test('TC_SMOKE_036: Verify that the Super Admin can add the Admin user and the set password email is received.', async ({ page, mailService }) => {
    const { renewalOrgId } = readSmokeState();
    requires(renewalOrgId, 'the organization (TC_SMOKE_035)');
    requireMailbox();
    await asSuperAdmin(page);
    const details = new OrganizationDetailsPage(page);
    await details.goto(renewalOrgId!);
    await details.expectLoaded(orgName());
    await details.addUserButton.click();
    await expect(details.addUserDialog.heading).toBeVisible();
    await details.addUserDialog.fill({ firstName: ADMIN.firstName, lastName: ADMIN.lastName, email: ADMIN.email });
    const addedAt = new Date();
    await details.addUserDialog.submit();
    await expect(details.userRow(ADMIN.email)).toBeVisible({ timeout: 20000 });
    await expect(details.userRowRole(details.userRow(ADMIN.email))).toHaveText(/^admin$/i);
    // Set password email
    const mail = await waitForMail(mailService, SUBJECTS.setPassword, addedAt);
    updateSmokeState({ renewalUserAddedAt: addedAt.toISOString(), renewalSetPasswordLink: mailLink(mail, /\/set-password\?token=/) });
    await showEmail(page, mail);
    await expect(page.locator('#rs-mail-subject')).toHaveText(SUBJECTS.setPassword);
    await expect(page.locator('a[href*="/set-password?token="]')).toBeVisible();
  });

  test('TC_SMOKE_037: Verify that the Admin can set the password and sign in.', async ({ page, dashboardPage }) => {
    const { renewalSetPasswordLink } = readSmokeState();
    requires(renewalSetPasswordLink, 'the set password email (TC_SMOKE_036)');
    await page.goto(renewalSetPasswordLink!);
    await expect(page.getByText('Set your password', { exact: true })).toBeVisible();
    await page.getByPlaceholder('At least 8 characters').fill(ADMIN.password);
    await page.getByPlaceholder('Re-enter your password').fill(ADMIN.password);
    const saved = page.waitForResponse((r) => /\/api\/setPassword\b/.test(r.url()) && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Set Password', exact: true }).click();
    expect((await saved).status(), 'setPassword API status').toBe(200);
    await expect(page.getByText('Password set successfully!', { exact: true })).toBeVisible();
    updateSmokeState({ renewalPasswordSet: true });
    // Sign in as the new Admin
    const login = new LoginPage(page);
    await login.navigate();
    await login.loginAndWaitForDashboard(ADMIN.email, ADMIN.password);
    await dashboardPage.expectLoaded();
    await page.context().storageState({ path: ADMIN_STATE });
    await expect(dashboardPage.kpiTablist).toBeVisible();
  });

  test('TC_SMOKE_038: Verify that the Admin can subscribe to the Growth plan with a valid card.', async ({ page }, testInfo) => {
    requires(readSmokeState().renewalPasswordSet, 'the Admin password (TC_SMOKE_037)');
    await asAdmin(page);
    const billing = new BillingPage(page);
    await billing.goto();
    await billing.startCheckout('Growth', 'Monthly');
    await expect(billing.subscribingTo).toHaveText(`Subscribing to ${PLAN.label}`);
    await billing.paymentElement.selectCard();
    await billing.paymentElement.fillCard(CARDS.success);
    await attachEvidence(page, testInfo, '1 - Stripe card payment (4242 4242 4242 4242)');
    const paidAt = new Date();
    await clickWhenSettled(billing.subscribeButton);
    updateSmokeState({ renewalPaidAt: paidAt.toISOString() });
    // The app applies the payment (Stripe webhook): the subscription becomes Active
    await billing.waitForSubscriptionBadge(/^Active$/, 180_000);
    await expect(billing.subscriptionPlan).toHaveText(PLAN.label);
    await expect(billing.subscriptionStatusText).toHaveText(/^Renews automatically on \d{1,2}\/\d{1,2}\/\d{4}\.$/);
    updateSmokeState({ renewalDate: (await billing.subscriptionStatusText.innerText()).match(/on (\S+)\.$/)![1] });
    await expect(billing.subscriptionBadge).toHaveText('Active');
  });

  test('TC_SMOKE_039: Verify the "Your Growth plan is active" email.', async ({ page, mailService }) => {
    const { renewalPaidAt } = readSmokeState();
    requires(renewalPaidAt, 'the payment (TC_SMOKE_038)');
    requireMailbox();
    const mail = await waitForMail(mailService, SUBJECTS.planActive, new Date(renewalPaidAt!));
    await showEmail(page, mail);
    await expect(page.locator('#rs-mail-subject')).toHaveText(SUBJECTS.planActive);
    await expect(page.getByText(new RegExp(`Growth`)).first()).toBeVisible();
  });

  test('TC_SMOKE_040: Verify that the Admin can cancel the subscription renewal.', async ({ page }) => {
    const { renewalDate } = readSmokeState();
    requires(renewalDate, 'the active subscription (TC_SMOKE_038)');
    await asAdmin(page);
    const billing = new BillingPage(page);
    await billing.goto();
    await billing.cancelSubscriptionButton.click();
    await expect(billing.cancelPrompt).toBeVisible();
    const cancelled = page.waitForResponse((r) => /\/api\/cancelSubscription\b/.test(r.url()) && r.request().method() === 'POST');
    await billing.confirmCancelButton.click();
    const res = await cancelled;
    expect(res.status(), 'cancelSubscription API status').toBe(200);
    expect((await res.json()).cancelAtPeriodEnd, 'auto-renewal is switched off').toBe(true);
    await billing.goto();
    await expect(billing.subscriptionStatusText).toHaveText(`Auto-renewal is off. Your plan stays active until ${renewalDate}.`);
    await expect(billing.subscriptionBadge).toHaveText(/^Cancels on /i);
  });

  test('TC_SMOKE_041: Verify that the Super Admin can delete the Admin user and the organization.', async ({ page }) => {
    const { renewalOrgId } = readSmokeState();
    requires(renewalOrgId, 'the organization (TC_SMOKE_035)');
    updateSmokeState({ renewalCleanupStarted: true });
    await asSuperAdmin(page);
    const details = new OrganizationDetailsPage(page);
    await details.goto(renewalOrgId!);
    await details.expectLoaded(orgName());
    // The Admin user
    const row = details.userRow(ADMIN.email);
    if (await row.isVisible().catch(() => false)) {
      await details.userRowDeleteButton(row).click();
      await expect(details.confirmDeleteDialog.message).toHaveText('Are you sure you want to delete this user?');
      const userDeleted = page.waitForResponse((r) => /\/api\/deleteUser\b/.test(r.url()) && r.request().method() === 'DELETE');
      await details.confirmDeleteDialog.confirmButton.click();
      expect((await userDeleted).status(), 'deleteUser API status').toBe(200);
      await expect(details.userRow(ADMIN.email)).toHaveCount(0);
    }
    // The organization
    await details.deleteButton.click();
    await expect(details.confirmDeleteDialog.message).toHaveText(`Are you sure you want to delete ${orgName()}?`);
    const orgDeleted = page.waitForResponse((r) => /\/api\/deleteOrganization/i.test(r.url()), { timeout: 30000 });
    await details.confirmDeleteDialog.confirmButton.click();
    expect((await orgDeleted).status(), 'deleteOrganization API status').toBe(200);
    updateSmokeState({ renewalOrgDeleted: true });
    await page.waitForURL(/\/organizations$/);
    const orgs = new OrganizationsPage(page);
    await orgs.search(orgName());
    await expect(orgs.orgCard(orgName())).toHaveCount(0);
    await expect(orgs.noOrganizationsMessage).toBeVisible();
  });
});
