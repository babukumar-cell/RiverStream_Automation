import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from '../base.page';
import { ConfirmDeleteDialog, fieldContainer, labelledCombobox, labelledInput, selectOption } from './settings-shared';
import { UserRole } from './users.page';

/** User Details page (/users/{email}) opened from the eye icon on the Users list */
export class UserDetailsPage extends BasePage {
  readonly backButton: Locator;
  readonly nameHeading: Locator;
  readonly editButton: Locator;
  readonly deleteButton: Locator;
  readonly saveButton: Locator;
  readonly cancelButton: Locator;

  readonly basicInfoHeading: Locator;
  readonly organizationInfoHeading: Locator;
  readonly accountDetailsHeading: Locator;

  readonly userIdInput: Locator;
  /** Read-only role text (view mode) */
  readonly roleField: Locator;
  /** Role select (edit mode) */
  readonly roleSelect: Locator;
  readonly firstNameInput: Locator;
  readonly lastNameInput: Locator;
  readonly emailInput: Locator;
  readonly organizationIdInput: Locator;
  readonly organizationNameInput: Locator;
  readonly firstTimeUserField: Locator;
  readonly createdAtInput: Locator;

  readonly confirmDeleteDialog: ConfirmDeleteDialog;

  constructor(page: Page) {
    super(page);
    this.backButton = page.getByRole('button', { name: 'Back', exact: true });
    this.nameHeading = page.locator('main h1');
    this.editButton = page.getByRole('button', { name: 'Edit', exact: true });
    this.deleteButton = page.getByRole('button', { name: 'Delete', exact: true });
    this.saveButton = page.getByRole('button', { name: 'Save', exact: true });
    this.cancelButton = page.getByRole('button', { name: 'Cancel', exact: true });

    this.basicInfoHeading = page.getByRole('heading', { name: 'Basic Information', exact: true });
    this.organizationInfoHeading = page.getByRole('heading', { name: 'Organization Information', exact: true });
    this.accountDetailsHeading = page.getByRole('heading', { name: 'Account Details', exact: true });

    this.userIdInput = labelledInput(page, 'User ID');
    this.roleField = fieldContainer(page, 'Role');
    this.roleSelect = labelledCombobox(page, 'Role');
    this.firstNameInput = labelledInput(page, 'First Name');
    this.lastNameInput = labelledInput(page, 'Last Name');
    this.emailInput = labelledInput(page, 'Email');
    this.organizationIdInput = labelledInput(page, 'Organization ID');
    this.organizationNameInput = labelledInput(page, 'Organization Name');
    this.firstTimeUserField = fieldContainer(page, 'First Time User');
    this.createdAtInput = labelledInput(page, 'Created At');

    this.confirmDeleteDialog = new ConfirmDeleteDialog(page);
  }

  async goto(email: string): Promise<void> {
    await this.navigateTo(`/users/${encodeURIComponent(email)}`);
    await this.waitForUser(email);
  }

  async waitForUser(email: string): Promise<void> {
    await expect(this.emailInput).toHaveValue(email, { timeout: 30000 });
  }

  async startEdit(): Promise<void> {
    await this.editButton.click();
    await expect(this.saveButton).toBeVisible();
  }

  async selectRole(role: UserRole): Promise<void> {
    await this.roleSelect.click();
    await selectOption(this.page, role).click();
    await expect(this.roleSelect).toHaveText(role);
  }

  /** Clicks Save and waits for the update API call */
  async save(): Promise<void> {
    const response = this.page.waitForResponse(
      res => /\/api\/updateUser\b/i.test(res.url()) && res.request().method() !== 'GET',
      { timeout: 30000 },
    );
    await this.saveButton.click();
    expect((await response).status(), 'updateUser API status').toBe(200);
    await expect(this.editButton).toBeVisible();
  }

  /** Delete with confirmation; waits for the deleteUser API call and the redirect to /users */
  async deleteWithConfirmation(): Promise<void> {
    await this.deleteButton.click();
    await expect(this.confirmDeleteDialog.root).toBeVisible();
    const response = this.page.waitForResponse(res => /\/api\/deleteUser\b/.test(res.url()), { timeout: 30000 });
    await this.confirmDeleteDialog.confirmButton.click();
    expect((await response).status(), 'deleteUser API status').toBe(200);
    await this.page.waitForURL(/\/users$/);
  }
}
