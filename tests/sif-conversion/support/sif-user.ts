import fs from 'fs';
import path from 'path';
import { Browser, Page, expect } from '@playwright/test';
import { Config } from '../../../src/config/environment';
import { LoginPage } from '../../../src/pages/login.page';
import { OrganizationDetailsPage } from '../../../src/pages/settings/organization-details.page';
import { UserDetailsPage } from '../../../src/pages/settings/user-details.page';
import { UsersPage } from '../../../src/pages/settings/users.page';
import { MailService } from '../../../src/utils/mail.service';
import { ORG_USER, SIF_ORG_FILE, SIF_USER_STATE, SifOrg, setOrgSif, sifSwitch } from './sif-data';

/*
 * Before the SIF Conversion suite (sif-user.setup.ts): prepares the suite's user ORG_USER
 * (riverstreamautomation@gmail.com) and its organization.
 *   - The user exists: the suite uses its organization and signs in with ORG_USER.password (nothing is re-created).
 *   - The user does not exist: the Super Admin creates it as an Admin of an existing organization (SIF_USER_ORG_ID,
 *     default the Super Admin's own organization, riverstonetech) with ORG_USER.password. If the new user still has
 *     to set its password, the "Set up your RiverStream password" email (Inbox or Spam) is used to set it. The user is
 *     kept for later runs. No organization is created.
 *   - The organization's SIF Conversion setting is switched ON if it is off (toggle validation).
 * Saves the user's session (SIF_USER_STATE) and the organization (SIF_ORG_FILE) for the suite.
 */

export const NEW_USER = { firstName: 'Automation', lastName: '' } as const;

/** Organization a missing user is created in: SIF_USER_ORG_ID, or the Super Admin's own organization */
function targetOrgId(): string {
  if (process.env.SIF_USER_ORG_ID) return process.env.SIF_USER_ORG_ID;
  const saved = JSON.parse(fs.readFileSync(Config.adminStorageState, 'utf8')) as { cookies: { name: string; value: string }[] };
  const info = saved.cookies.find((c) => c.name === 'userInfo');
  const orgId = info ? (JSON.parse(decodeURIComponent(info.value)).orgId as string | undefined) : undefined;
  if (!orgId) throw new Error(`No organization in the Super Admin session (${Config.adminStorageState}); set SIF_USER_ORG_ID`);
  return orgId;
}

const SET_PASSWORD_SUBJECT = 'Set up your RiverStream password';
const MAIL_FROM = 'azurecomm.net';
const SET_PASSWORD_WAIT_MS = 20 * 60_000;

async function withSuperAdmin<T>(browser: Browser, fn: (page: Page) => Promise<T>): Promise<T> {
  const context = await browser.newContext({ storageState: Config.adminStorageState, baseURL: Config.baseUrl, viewport: { width: 1600, height: 900 } });
  try {
    return await fn(await context.newPage());
  } finally {
    await context.close();
  }
}

/** Signs ORG_USER in on a new context and saves the session to SIF_USER_STATE; returns the sign-in error, if any */
async function signIn(browser: Browser): Promise<string | undefined> {
  const context = await browser.newContext({ baseURL: Config.baseUrl });
  try {
    const page = await context.newPage();
    const login = new LoginPage(page);
    await login.navigate();
    await login.login(ORG_USER.email, ORG_USER.password);
    const error = login.signInForm.getByText(/incomplete|invalid|incorrect|not found|locked|disabled/i).first();
    const result = await Promise.race([
      page.waitForURL(/\/dashboard/, { timeout: 45000 }).then(() => 'ok'),
      error.waitFor({ timeout: 45000 }).then(async () => (await error.innerText()).trim()),
    ]).catch(() => `no dashboard after sign-in (${page.url()})`);
    if (result !== 'ok') return result;
    fs.mkdirSync(path.dirname(SIF_USER_STATE), { recursive: true });
    const tmp = `${SIF_USER_STATE}.${process.pid}.tmp`;
    await context.storageState({ path: tmp });
    fs.renameSync(tmp, SIF_USER_STATE);
    return undefined;
  } finally {
    await context.close();
  }
}

interface FoundUser {
  orgId: string;
  orgName: string;
  userName: string;
  /** When the user was created (its set-password email is sent after it) */
  createdAt: Date;
}

/** The user's organization and details (Users page > the user's details), or undefined if the user does not exist */
async function findUser(browser: Browser): Promise<FoundUser | undefined> {
  return withSuperAdmin(browser, async (page) => {
    const users = new UsersPage(page);
    await users.goto();
    await users.search(ORG_USER.email);
    const card = users.userCard(ORG_USER.email);
    if ((await card.count()) === 0) return undefined;
    await expect(card).toHaveCount(1);
    // the card's eye button (searching the same text again sends no new request)
    await users.viewButton(card).click();
    await page.waitForURL(/\/users\/[^/]+$/);
    const details = new UserDetailsPage(page);
    await details.waitForUser(ORG_USER.email);
    await expect(details.organizationIdInput).not.toHaveValue('', { timeout: 30000 });
    const orgId = (await details.organizationIdInput.inputValue()).trim();
    const userName = `${(await details.firstNameInput.inputValue()).trim()} ${(await details.lastNameInput.inputValue()).trim()}`.trim();
    const created = new Date((await details.createdAtInput.inputValue().catch(() => '')).trim());
    const createdAt = Number.isNaN(created.getTime()) ? new Date(Date.now() - 2 * 86400_000) : created;
    const org = new OrganizationDetailsPage(page);
    await org.goto(orgId);
    await expect(org.nameInput).not.toHaveValue('', { timeout: 30000 });
    return { orgId, orgName: (await org.nameInput.inputValue()).trim(), userName, createdAt };
  });
}

/** Signs the user in; if its password is not set yet ("Account setup incomplete"), sets it from the set-password email */
async function signInOrSetPassword(browser: Browser, createdAt: Date): Promise<void> {
  let error = await signIn(browser);
  if (!error) return;
  if (!/incomplete/i.test(error)) {
    throw new Error(`${ORG_USER.email} cannot sign in: "${error}". Set its password in SIF_USER_PASSWORD (.env / GitHub secret) and run again.`);
  }
  console.log(`[sif-setup] sign-in: "${error}"; setting the password from the set-password email (Inbox or Spam)`);
  await setPasswordFromEmail(browser, createdAt);
  error = await signIn(browser);
  if (error) throw new Error(`${ORG_USER.email} cannot sign in after setting its password: "${error}"`);
}

/** ORG_USER as an Admin of the existing organization (Settings > Users > Create User, with the password); returns its name */
async function createUserInOrg(browser: Browser, orgId: string): Promise<string> {
  return withSuperAdmin(browser, async (page) => {
    const org = new OrganizationDetailsPage(page);
    await org.goto(orgId);
    await expect(org.nameInput).not.toHaveValue('', { timeout: 30000 });
    const orgName = (await org.nameInput.inputValue()).trim();
    const users = new UsersPage(page);
    await users.goto();
    const create = await users.openCreateUserDialog();
    await create.fill({ firstName: NEW_USER.firstName, email: ORG_USER.email, password: ORG_USER.password, organization: orgName, role: 'Admin' });
    await create.submit();
    // the card shows the name, email and role (the organization is checked by findUser on the details page)
    await users.search(ORG_USER.email);
    await expect(users.userCard(ORG_USER.email)).toContainText(/admin/i);
    return orgName;
  });
}

/** Sets ORG_USER.password from the "Set up your RiverStream password" email (Inbox or Spam) */
async function setPasswordFromEmail(browser: Browser, since: Date): Promise<void> {
  const mail = await new MailService().waitForReply({
    token: SET_PASSWORD_SUBJECT,
    from: MAIL_FROM,
    to: ORG_USER.email,
    since: new Date(since.getTime() - 60_000),
    timeoutMs: SET_PASSWORD_WAIT_MS,
  });
  const link = [...mail.html.matchAll(/href=["']([^"']+)["']/g)].map((m) => m[1].replace(/&amp;/g, '&')).find((h) => /\/set-password\?token=/.test(h));
  expect(link, `set-password link in "${mail.subject}" (${mail.mailbox})`).toBeTruthy();
  const context = await browser.newContext({ baseURL: Config.baseUrl });
  try {
    const page = await context.newPage();
    await page.goto(link!);
    await expect(page.getByText('Set your password', { exact: true })).toBeVisible({ timeout: 30000 });
    await page.getByPlaceholder('At least 8 characters').fill(ORG_USER.password);
    await page.getByPlaceholder('Re-enter your password').fill(ORG_USER.password);
    const saved = page.waitForResponse((r) => /\/api\/setPassword\b/.test(r.url()) && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Set Password', exact: true }).click();
    expect((await saved).status(), 'setPassword API status').toBe(200);
    await expect(page.getByText('Password set successfully!', { exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
}

/** Organization's SIF Conversion setting ON (switched on by the Super Admin if it is off); returns whether it was switched */
async function ensureOrgSifOn(browser: Browser, orgId: string): Promise<boolean> {
  return withSuperAdmin(browser, async (page) => {
    const url = `/organizations/${orgId}`;
    await page.goto(url);
    await expect(sifSwitch(page)).toBeVisible({ timeout: 30000 });
    const wasOn = (await sifSwitch(page).getAttribute('aria-checked')) === 'true';
    if (!wasOn) await setOrgSif(page, url, true);
    await expect(sifSwitch(page)).toHaveAttribute('aria-checked', 'true');
    return !wasOn;
  });
}

export async function prepareSifUser(browser: Browser): Promise<SifOrg> {
  let org: SifOrg;
  let found = await findUser(browser);
  let userSetup: SifOrg['userSetup'] = 'existing';
  if (found) {
    console.log(`[sif-setup] ${ORG_USER.email} exists in ${found.orgName} (${found.orgId})`);
  } else {
    const orgId = targetOrgId();
    const orgName = await createUserInOrg(browser, orgId);
    console.log(`[sif-setup] ${ORG_USER.email} did not exist: created it as an Admin of ${orgName} (${orgId})`);
    found = await findUser(browser);
    if (!found || found.orgId !== orgId) throw new Error(`${ORG_USER.email} was created but is not listed in ${orgName} (${orgId})`);
    userSetup = 'created';
  }
  await signInOrSetPassword(browser, found.createdAt);
  org = { orgId: found.orgId, orgName: found.orgName, userName: found.userName, userSetup, sifTurnedOn: false };
  org.sifTurnedOn = await ensureOrgSifOn(browser, org.orgId);
  console.log(`[sif-setup] SIF Conversion of ${org.orgName}: ${org.sifTurnedOn ? 'was OFF, switched ON' : 'already ON'}`);
  fs.mkdirSync(path.dirname(SIF_ORG_FILE), { recursive: true });
  fs.writeFileSync(SIF_ORG_FILE, JSON.stringify(org, null, 2));
  return org;
}
