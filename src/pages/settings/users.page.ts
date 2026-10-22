import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from '../base.page';
import { labelledCombobox, labelledInput, selectOption } from './settings-shared';

export type UserRole = 'Reviewer' | 'Admin';

export interface NewUser {
  firstName: string;
  lastName?: string;
  email: string;
  password?: string;
  /** Organization name as listed in the Organization select (without the "(x/y users)" suffix) */
  organization?: string;
  role?: UserRole;
}

/**
 * "Create User" dialog (Users page) and "Add User" dialog (organization detail page).
 * Both share the same fields; the org-detail variant has no Password / Organization select.
 */
export class UserFormDialog {
  readonly page: Page;
  readonly root: Locator;
  readonly heading: Locator;
  readonly firstNameInput: Locator;
  readonly lastNameInput: Locator;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly organizationSelect: Locator;
  readonly roleSelect: Locator;
  readonly submitButton: Locator;
  readonly closeButton: Locator;
  /** Inline validation text, e.g. "Please enter a valid email address." */
  readonly validationMessage: Locator;

  constructor(page: Page, title: 'Create User' | 'Add User' | 'Edit User' = 'Create User') {
    this.page = page;
    this.root = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
    this.heading = this.root.getByRole('heading', { name: title, exact: true });
    this.firstNameInput = labelledInput(this.root, 'First Name');
    this.lastNameInput = labelledInput(this.root, 'Last Name');
    this.emailInput = labelledInput(this.root, 'Email');
    this.passwordInput = labelledInput(this.root, 'Password');
    this.organizationSelect = labelledCombobox(this.root, 'Organization');
    this.roleSelect = labelledCombobox(this.root, 'Role');
    this.submitButton = this.root.getByRole('button', { name: 'Create User', exact: true });
    this.closeButton = this.root.getByRole('button', { name: 'Close', exact: true });
    this.validationMessage = this.root.getByText(/please enter|is required|invalid/i);
  }

  /** Option in the Organization select, e.g. "MJ (0/5 users)" */
  organizationOption(name: string): Locator {
    return this.page.getByRole('option').filter({ hasText: new RegExp(`^${escapeRegExp(name)}\\s*\\(`) });
  }

  roleOption(role: UserRole): Locator {
    return selectOption(this.page, role);
  }

  async selectOrganization(name: string): Promise<void> {
    await this.organizationSelect.click();
    await this.organizationOption(name).click();
    await expect(this.organizationSelect).toContainText(name);
  }

  async selectRole(role: UserRole): Promise<void> {
    await this.roleSelect.click();
    await this.roleOption(role).click();
    await expect(this.roleSelect).toHaveText(role);
  }

  async fill(user: NewUser): Promise<void> {
    await this.firstNameInput.fill(user.firstName);
    if (user.lastName !== undefined) await this.lastNameInput.fill(user.lastName);
    await this.emailInput.fill(user.email);
    if (user.password !== undefined) await this.passwordInput.fill(user.password);
    if (user.organization) await this.selectOrganization(user.organization);
    if (user.role) await this.selectRole(user.role);
  }

  /** Submits and waits for the createUser API call to succeed and the dialog to close. */
  async submit(): Promise<void> {
    const response = this.page.waitForResponse(
      res => /\/api\/createUser\b/.test(res.url()) && res.request().method() === 'POST',
      { timeout: 30000 },
    );
    await this.submitButton.click();
    const res = await response;
    expect(res.status(), 'createUser API status').toBe(200);
    await expect(this.root).toBeHidden({ timeout: 15000 });
  }

  async close(): Promise<void> {
    await this.closeButton.click();
    await expect(this.root).toBeHidden();
  }
}

/** Users list page (/users) */
export class UsersPage extends BasePage {
  readonly heading: Locator;
  readonly subtitle: Locator;
  readonly searchInput: Locator;
  readonly addUserButton: Locator;
  /** One <h3> per user card (the user's display name) */
  readonly userNames: Locator;
  readonly noUsersMessage: Locator;
  readonly endOfListMessage: Locator;
  readonly createUserDialog: UserFormDialog;

  constructor(page: Page) {
    super(page);
    this.heading = page.getByRole('heading', { name: 'Users', level: 2, exact: true });
    this.subtitle = page.getByText('Manage users and their roles', { exact: true });
    this.searchInput = page.getByPlaceholder('Search users...');
    this.addUserButton = page.getByRole('button', { name: 'Add User', exact: true });
    this.userNames = page.locator('main h3');
    this.noUsersMessage = page.getByText('No users found.', { exact: true });
    this.endOfListMessage = page.getByText('No more users to show', { exact: true });
    this.createUserDialog = new UserFormDialog(page, 'Create User');
  }

  async goto(): Promise<void> {
    await this.navigateTo('/users');
    await expect(this.heading).toBeVisible();
    await expect(this.userNames.first().or(this.noUsersMessage)).toBeVisible({ timeout: 30000 });
  }

  /** Card of the user whose name or email matches */
  userCard(nameOrEmail: string): Locator {
    return this.userCards.filter({ hasText: nameOrEmail });
  }

  /** All user cards currently rendered */
  get userCards(): Locator {
    // Nearest ancestor of each name heading that also holds the action button = one card
    return this.userNames.locator('xpath=ancestor::div[.//button][1]');
  }

  viewButton(card: Locator): Locator {
    return card.getByRole('button');
  }

  async search(text: string): Promise<void> {
    const response = this.page.waitForResponse(res => /\/api\/listUsers\b/.test(res.url()), { timeout: 20000 });
    await this.searchInput.fill(text);
    await response;
  }

  async openCreateUserDialog(): Promise<UserFormDialog> {
    await this.addUserButton.click();
    await expect(this.createUserDialog.heading).toBeVisible();
    return this.createUserDialog;
  }

  /** Opens the User Details page for the given email via the card's eye button */
  async openUserDetails(email: string): Promise<void> {
    await this.search(email);
    const card = this.userCard(email);
    await expect(card).toHaveCount(1);
    await this.viewButton(card).click();
    await this.page.waitForURL(/\/users\/[^/]+$/);
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
