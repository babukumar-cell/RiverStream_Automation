import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from '../base.page';
import { ConfirmDeleteDialog, fieldContainer, labelledCombobox, labelledInput, selectOption, switchByTitle } from './settings-shared';
import { UserFormDialog, UserRole } from './users.page';

/** Document types as labelled on the organization detail page */
export type OrgDocType = 'Purchase Order' | 'Quote Request' | 'PO-ACK Recon';
export type OrgStatus = 'Active' | 'Inactive' | 'Suspended';

/** "Upload ERP Data" dialog (replaces the old Custom Docs upload) */
export class ErpUploadDialog {
  readonly root: Locator;
  readonly heading: Locator;
  readonly description: Locator;
  readonly customerAddressLabel: Locator;
  readonly productCodeLabel: Locator;
  readonly downloadSampleButtons: Locator;
  readonly browseLinks: Locator;
  readonly fileInputs: Locator;
  readonly closeButton: Locator;

  constructor(page: Page) {
    this.root = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Upload ERP Data', exact: true }) });
    this.heading = this.root.getByRole('heading', { name: 'Upload ERP Data', exact: true });
    this.description = this.root.getByText('Import customer addresses and product codes for this organization from Excel.');
    this.customerAddressLabel = this.root.getByText('Customer Address Excel', { exact: true });
    this.productCodeLabel = this.root.getByText('Product Code Excel', { exact: true });
    this.downloadSampleButtons = this.root.getByRole('button', { name: 'Download sample', exact: true });
    this.browseLinks = this.root.getByText('browse', { exact: true });
    this.fileInputs = this.root.locator('input[type="file"]');
    this.closeButton = this.root.getByRole('button', { name: 'Close', exact: true });
  }
}

/**
 * Organization detail page (/organizations/{orgId}).
 * Most fields are read-only until Edit is clicked.
 */
export class OrganizationDetailsPage extends BasePage {
  readonly backButton: Locator;
  readonly nameHeading: Locator;
  readonly editButton: Locator;
  readonly deleteButton: Locator;
  readonly saveButton: Locator;
  readonly cancelButton: Locator;
  readonly notFoundMessage: Locator;

  // Profile
  readonly profileHeading: Locator;
  readonly nameInput: Locator;
  /** Status badge (view mode) */
  readonly statusField: Locator;
  /** Status select (edit mode) */
  readonly statusSelect: Locator;
  readonly domainInput: Locator;

  // Subscription
  readonly subscriptionHeading: Locator;
  readonly payNowButton: Locator;
  readonly billHistoryButton: Locator;
  readonly planInput: Locator;
  readonly expiresAtInput: Locator;
  readonly lastPaymentInput: Locator;
  readonly documentLimitInput: Locator;
  readonly documentLimitUsage: Locator;
  readonly userLimitInput: Locator;
  readonly userLimitUsage: Locator;
  readonly retentionInput: Locator;
  readonly totalUsageField: Locator;
  readonly monthlyUsageField: Locator;

  // Bill History panel (inline card, not a dialog)
  readonly billHistoryHeading: Locator;
  readonly billHistoryPanel: Locator;
  readonly billHistoryCloseButton: Locator;
  readonly billHistoryColumnHeaders: Locator;
  readonly billHistoryRows: Locator;

  // Settings
  readonly settingsHeading: Locator;
  /** Popover trigger showing the enabled document type badges */
  readonly enabledDocTypesTrigger: Locator;
  readonly enabledDocTypeBadges: Locator;
  readonly erpDataLabel: Locator;
  readonly erpUploadButton: Locator;
  readonly directEstimateSwitch: Locator;
  readonly lifelineTrackingSwitch: Locator;
  readonly createdAtInput: Locator;
  readonly updatedAtInput: Locator;

  // Users section
  readonly usersHeading: Locator;
  readonly usersSection: Locator;
  readonly usersSearchInput: Locator;
  readonly addUserButton: Locator;
  readonly noUsersMessage: Locator;

  readonly erpUploadDialog: ErpUploadDialog;
  readonly addUserDialog: UserFormDialog;
  readonly editUserDialog: EditOrgUserDialog;
  readonly confirmDeleteDialog: ConfirmDeleteDialog;

  constructor(page: Page) {
    super(page);
    this.backButton = page.getByRole('button', { name: 'Back', exact: true });
    this.nameHeading = page.locator('main h1');
    this.editButton = page.getByRole('button', { name: 'Edit', exact: true });
    this.deleteButton = page.getByRole('button', { name: 'Delete', exact: true });
    this.saveButton = page.getByRole('button', { name: 'Save', exact: true });
    this.cancelButton = page.getByRole('button', { name: 'Cancel', exact: true });
    this.notFoundMessage = page.getByText('Organization not found', { exact: true });

    this.profileHeading = page.getByRole('heading', { name: 'Profile', exact: true });
    this.nameInput = labelledInput(page, 'Organization Name');
    this.statusField = fieldContainer(page, 'Status');
    this.statusSelect = labelledCombobox(page, 'Status');
    this.domainInput = labelledInput(page, 'Domain');

    this.subscriptionHeading = page.getByRole('heading', { name: 'Subscription', exact: true });
    this.payNowButton = page.getByRole('button', { name: 'Pay Now', exact: true });
    this.billHistoryButton = page.getByRole('button', { name: 'Bill History', exact: true });
    this.planInput = labelledInput(page, 'Plan');
    this.expiresAtInput = labelledInput(page, 'Expires At');
    this.lastPaymentInput = labelledInput(page, 'Last Payment');
    this.documentLimitInput = labelledInput(page, 'Document Limit');
    this.documentLimitUsage = fieldContainer(page, 'Document Limit').getByText(/documents used$/);
    this.userLimitInput = labelledInput(page, 'User Limit');
    this.userLimitUsage = fieldContainer(page, 'User Limit').getByText(/users used$/);
    this.retentionInput = labelledInput(page, 'Document Retention (Days)');
    this.totalUsageField = page.getByText('Total usage', { exact: true }).locator('xpath=..');
    this.monthlyUsageField = page.getByText('Monthly usage', { exact: true }).locator('xpath=..');

    this.billHistoryHeading = page.getByRole('heading', { name: 'Bill History', level: 4, exact: true });
    this.billHistoryPanel = page.locator('[data-slot="card"]').filter({ has: this.billHistoryHeading });
    this.billHistoryCloseButton = this.billHistoryHeading.locator('xpath=..').getByRole('button');
    this.billHistoryColumnHeaders = this.billHistoryPanel.locator('table th');
    this.billHistoryRows = this.billHistoryPanel.locator('table tbody tr');

    this.settingsHeading = page.getByRole('heading', { name: 'Settings', level: 4, exact: true });
    this.enabledDocTypesTrigger = fieldContainer(page, 'Enabled Document Types').locator('button[aria-haspopup="dialog"]');
    this.enabledDocTypeBadges = this.enabledDocTypesTrigger.locator('[data-slot="badge"]');
    this.erpDataLabel = page.getByText('ERP Data', { exact: true });
    this.erpUploadButton = page.getByRole('button', { name: 'Upload', exact: true });
    this.directEstimateSwitch = switchByTitle(page, 'Direct Estimate Creation');
    this.lifelineTrackingSwitch = switchByTitle(page, 'Lifeline Tracking');
    this.createdAtInput = labelledInput(page, 'Created At');
    this.updatedAtInput = labelledInput(page, 'Updated At');

    this.usersHeading = page.getByRole('heading', { name: 'Users', level: 4, exact: true });
    this.usersSection = page.locator('[data-slot="card"]').filter({ has: this.usersHeading });
    this.usersSearchInput = this.usersSection.getByPlaceholder('Search users...');
    this.addUserButton = this.usersSection.getByRole('button', { name: 'Add User', exact: true });
    this.noUsersMessage = this.usersSection.getByText('No users found.', { exact: true });

    this.erpUploadDialog = new ErpUploadDialog(page);
    this.addUserDialog = new UserFormDialog(page, 'Add User');
    this.editUserDialog = new EditOrgUserDialog(page);
    this.confirmDeleteDialog = new ConfirmDeleteDialog(page);
  }

  async goto(orgId: string): Promise<void> {
    await this.navigateTo(`/organizations/${orgId}`);
    await expect(this.nameInput.or(this.notFoundMessage)).toBeVisible({ timeout: 30000 });
  }

  /** Waits until the page shows the given organization */
  async expectLoaded(name: string): Promise<void> {
    await expect(this.nameHeading).toHaveText(name, { timeout: 30000 });
    await expect(this.nameInput).toHaveValue(name);
  }

  /** Popover checkbox for a document type (edit mode) */
  docTypeCheckbox(type: OrgDocType): Locator {
    return this.page.getByRole('dialog').locator('label').filter({ hasText: new RegExp(`^${type}$`) }).getByRole('checkbox');
  }

  /** User row in the Users section (matched by name or email) */
  userRow(nameOrEmail: string): Locator {
    return this.usersSection.locator('div.px-6').filter({ hasText: nameOrEmail }).filter({ has: this.page.getByRole('button') });
  }

  userRowRole(row: Locator): Locator {
    return row.locator('[data-slot="badge"]');
  }

  userRowEditButton(row: Locator): Locator {
    return row.getByRole('button').filter({ has: this.page.locator('svg.lucide-pen') });
  }

  userRowDeleteButton(row: Locator): Locator {
    return row.getByRole('button').filter({ has: this.page.locator('svg.lucide-trash-2') });
  }

  async startEdit(): Promise<void> {
    await this.editButton.click();
    await expect(this.saveButton).toBeVisible();
  }

  async selectStatus(status: OrgStatus): Promise<void> {
    await this.statusSelect.click();
    await selectOption(this.page, status).click();
    await expect(this.statusSelect).toHaveText(status);
  }

  /** Clicks Save and waits for the PUT /api/updateOrganization/{id} call */
  async save(): Promise<void> {
    const response = this.page.waitForResponse(
      res => /\/api\/updateOrganization\//.test(res.url()) && res.request().method() === 'PUT',
      { timeout: 30000 },
    );
    await this.saveButton.click();
    expect((await response).status(), 'updateOrganization API status').toBe(200);
    await expect(this.editButton).toBeVisible();
  }

  async cancelEdit(): Promise<void> {
    await this.cancelButton.click();
    await expect(this.editButton).toBeVisible();
  }

  async openBillHistory(): Promise<void> {
    await this.billHistoryButton.click();
    await expect(this.billHistoryHeading).toBeVisible();
  }

  async openErpUpload(): Promise<ErpUploadDialog> {
    await this.erpUploadButton.click();
    await expect(this.erpUploadDialog.heading).toBeVisible();
    return this.erpUploadDialog;
  }

  async searchUsers(text: string): Promise<void> {
    const response = this.page.waitForResponse(res => /\/api\/listUsers\b/.test(res.url()), { timeout: 20000 });
    await this.usersSearchInput.fill(text);
    await response.catch(() => undefined); // search may be client-side filtering; the row assertions decide
  }

  async addUser(user: { firstName: string; lastName?: string; email: string; role?: UserRole }): Promise<void> {
    await this.addUserButton.click();
    await expect(this.addUserDialog.heading).toBeVisible();
    await this.addUserDialog.fill(user);
    await this.addUserDialog.submit();
    await expect(this.userRow(user.email)).toBeVisible({ timeout: 20000 });
  }

  /** Delete the organization from its detail page with confirmation */
  async deleteWithConfirmation(): Promise<void> {
    await this.deleteButton.click();
    await expect(this.confirmDeleteDialog.root).toBeVisible();
    const response = this.page.waitForResponse(res => /\/api\/deleteOrganization/i.test(res.url()), { timeout: 30000 });
    await this.confirmDeleteDialog.confirmButton.click();
    expect((await response).status(), 'deleteOrganization API status').toBe(200);
    await this.page.waitForURL(/\/organizations$/);
  }
}

/** "Edit User" dialog opened from the pen icon in the org-detail Users section */
export class EditOrgUserDialog extends UserFormDialog {
  readonly saveChangesButton: Locator;

  constructor(page: Page) {
    super(page, 'Edit User');
    this.saveChangesButton = this.root.getByRole('button', { name: 'Save Changes', exact: true });
  }

  async saveChanges(): Promise<void> {
    const response = this.page.waitForResponse(
      res => /\/api\/updateUser\b/i.test(res.url()) && res.request().method() !== 'GET',
      { timeout: 30000 },
    );
    await this.saveChangesButton.click();
    expect((await response).status(), 'updateUser API status').toBe(200);
    await expect(this.root).toBeHidden();
  }
}
