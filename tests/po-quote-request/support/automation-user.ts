import fs from 'fs';
import { Browser, Page, expect } from '@playwright/test';
import { Config } from '../../../src/config/environment';
import { OrganizationDetailsPage } from '../../../src/pages/settings/organization-details.page';
import { UserDetailsPage } from '../../../src/pages/settings/user-details.page';
import { UsersPage } from '../../../src/pages/settings/users.page';

/*
 * Precondition of the PO/Quote Request suite (automation-user.setup.ts), done by the Super Admin:
 *   1. The automation mailbox user (riverstreamautomation@gmail.com) is a user of the Riverstone organization
 *      (the Super Admin's own organization, riverstonetech): emails it sends are processed for that organization.
 *      If the user does not exist it is created there (Admin). A user that exists in another organization is not
 *      moved or re-created: the setup stops and says so.
 *   2. The organization's "Direct Estimate Creation" setting is ON (switched on if it is off).
 */

export const AUTOMATION_USER = {
  email: process.env.AUTOMATION_USER_EMAIL || 'riverstreamautomation@gmail.com',
  firstName: 'Automation',
  password: process.env.AUTOMATION_USER_PASSWORD || 'Test@123',
  role: 'Admin' as const,
};

/** The Riverstone organization: the Super Admin's own organization (from the saved session) */
export function riverstoneOrgId(): string {
  const saved = JSON.parse(fs.readFileSync(Config.adminStorageState, 'utf8')) as { cookies: { name: string; value: string }[] };
  const info = saved.cookies.find((c) => c.name === 'userInfo');
  const orgId = info ? (JSON.parse(decodeURIComponent(info.value)).orgId as string | undefined) : undefined;
  if (!orgId) throw new Error(`No organization in the Super Admin session (${Config.adminStorageState})`);
  return orgId;
}

async function withSuperAdmin<T>(browser: Browser, fn: (page: Page) => Promise<T>): Promise<T> {
  const context = await browser.newContext({ storageState: Config.adminStorageState, baseURL: Config.baseUrl, viewport: { width: 1600, height: 900 } });
  try {
    return await fn(await context.newPage());
  } finally {
    await context.close();
  }
}

/** Organization id of the automation user (Users > the user's details), or undefined if the user does not exist */
async function automationUserOrgId(page: Page): Promise<string | undefined> {
  const users = new UsersPage(page);
  await users.goto();
  await users.search(AUTOMATION_USER.email);
  const card = users.userCard(AUTOMATION_USER.email);
  if ((await card.count()) === 0) return undefined;
  await expect(card).toHaveCount(1);
  await users.viewButton(card).click();
  await page.waitForURL(/\/users\/[^/]+$/);
  const details = new UserDetailsPage(page);
  await details.waitForUser(AUTOMATION_USER.email);
  await expect(details.organizationIdInput).not.toHaveValue('', { timeout: 30000 });
  return (await details.organizationIdInput.inputValue()).trim();
}

export interface AutomationUserResult {
  orgId: string;
  orgName: string;
  userCreated: boolean;
  directEstimateSwitchedOn: boolean;
}

export async function ensureAutomationUserAndDirectEstimate(browser: Browser): Promise<AutomationUserResult> {
  const orgId = riverstoneOrgId();
  return withSuperAdmin(browser, async (page) => {
    const org = new OrganizationDetailsPage(page);
    await org.goto(orgId);
    await expect(org.nameInput).not.toHaveValue('', { timeout: 30000 });
    const orgName = (await org.nameInput.inputValue()).trim();
    expect(orgName, `the Super Admin's organization (${orgId}) is the Riverstone organization`).toMatch(/riverstone/i);

    // 1. The automation user in the Riverstone organization
    let userCreated = false;
    const userOrg = await automationUserOrgId(page);
    if (userOrg === undefined) {
      const users = new UsersPage(page);
      await users.goto();
      const dialog = await users.openCreateUserDialog();
      await dialog.fill({ firstName: AUTOMATION_USER.firstName, email: AUTOMATION_USER.email, password: AUTOMATION_USER.password, organization: orgName, role: AUTOMATION_USER.role });
      await dialog.submit();
      expect(await automationUserOrgId(page), `${AUTOMATION_USER.email} created in ${orgName}`).toBe(orgId);
      userCreated = true;
    } else if (userOrg !== orgId) {
      throw new Error(
        `${AUTOMATION_USER.email} is a user of another organization (${userOrg}), not ${orgName} (${orgId}). ` +
          `Move it to ${orgName} (or delete it so the suite creates it there) and run again.`,
      );
    }

    // 2. Direct Estimate Creation ON
    await org.goto(orgId);
    await expect(org.directEstimateSwitch).toBeVisible({ timeout: 30000 });
    let directEstimateSwitchedOn = false;
    if ((await org.directEstimateSwitch.getAttribute('aria-checked')) !== 'true') {
      await org.startEdit();
      await org.directEstimateSwitch.click();
      await expect(org.directEstimateSwitch).toHaveAttribute('aria-checked', 'true');
      await org.save();
      directEstimateSwitchedOn = true;
    }
    await org.goto(orgId);
    await expect(org.directEstimateSwitch, `${orgName}: Direct Estimate Creation ON`).toHaveAttribute('aria-checked', 'true', { timeout: 30000 });
    return { orgId, orgName, userCreated, directEstimateSwitchedOn };
  });
}
