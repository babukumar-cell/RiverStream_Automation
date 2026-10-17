import { Page, Locator } from '@playwright/test';
import { BasePage } from './base.page';

export class SettingsPage extends BasePage {
  // Sidebar Navigation
  readonly settingsNavLink: Locator;
  readonly usersNavLink: Locator;
  readonly orgsNavLink: Locator;

  // Users Page (/users)
  readonly usersHeader: Locator;
  readonly searchUserInput: Locator;
  readonly addUserButton: Locator;
  readonly userCards: Locator;
  readonly userEyeButtons: Locator;

  // Create / Edit User Modal
  readonly createUserModal: Locator;
  readonly userFirstNameInput: Locator;
  readonly userLastNameInput: Locator;
  readonly userEmailInput: Locator;
  readonly userPasswordInput: Locator;
  readonly userOrgDropdown: Locator;
  readonly userRoleDropdown: Locator;
  readonly submitCreateUserButton: Locator;
  readonly closeUserModalButton: Locator;

  // Organizations List Page (/organizations)
  readonly orgsHeader: Locator;
  readonly searchOrgInput: Locator;
  readonly addOrgButton: Locator;
  readonly allTab: Locator;
  readonly activeTab: Locator;
  readonly inactiveTab: Locator;
  readonly orgCards: Locator;
  readonly orgNames: Locator;
  readonly orgDomains: Locator;
  readonly orgUsageBadges: Locator;
  readonly orgStatusBadges: Locator;
  readonly orgEyeButtons: Locator;
  readonly orgDeleteButtons: Locator;

  // Create Organization Modal
  readonly createOrgModal: Locator;
  readonly orgNameInput: Locator;
  readonly orgDomainInput: Locator;
  readonly poCheckbox: Locator;
  readonly quoteCheckbox: Locator;
  readonly poAckCheckbox: Locator;
  readonly directEstimateToggle: Locator;
  readonly lifelineTrackingToggle: Locator;
  readonly subscriptionPeriodDropdown: Locator;
  readonly starterPlanCard: Locator;
  readonly enterprisePlanCard: Locator;
  readonly growthPlanCard: Locator;
  readonly proPlanCard: Locator;
  readonly addressFileUploadInput: Locator;
  readonly submitCreateOrgButton: Locator;
  readonly closeCreateOrgModalButton: Locator;

  // Organization Details Page (/organizations/{orgId})
  readonly orgDetailsHeader: Locator;
  readonly backToOrgsButton: Locator;
  readonly orgTitle: Locator;
  readonly editOrgButton: Locator;
  readonly saveOrgButton: Locator;
  readonly deleteOrgButton: Locator;
  readonly payNowButton: Locator;
  readonly billHistoryButton: Locator;
  readonly orgNameField: Locator;
  readonly orgDomainField: Locator;
  readonly orgStatusField: Locator;
  readonly uploadCustomDocsButton: Locator;
  readonly customDocsSection: Locator;
  readonly directEstimateOrgDetailsToggle: Locator;
  readonly quotaLimitDisplay: Locator;

  constructor(page: Page) {
    super(page);

    // Sidebar
    this.settingsNavLink = page.locator('aside button:has-text("Settings"), aside a:has-text("Settings")').first();
    this.usersNavLink = page.locator('aside button:has-text("Users"), aside a:has-text("Users")').first();
    this.orgsNavLink = page.locator('aside button:has-text("Organizations"), aside a:has-text("Organizations")').first();

    // Users Page
    this.usersHeader = page.locator('h1:has-text("Users"), h2:has-text("Users"), :text("Manage users and their roles")').first();
    this.searchUserInput = page.locator('input[placeholder*="search user" i]').first();
    this.addUserButton = page.locator('button:has-text("Add User"), button:has-text("+ Add User")').first();
    this.userCards = page.locator('div:has(> svg.lucide-user), [class*="card"]:has-text("@"), div:has-text("@"):has(button svg.lucide-eye)');
    this.userEyeButtons = page.locator('button:has(svg.lucide-eye), svg.lucide-eye');

    // Create User Modal
    this.createUserModal = page.locator('[role="dialog"]:has-text("Create User"), [role="dialog"]:has-text("User")').first();
    this.userFirstNameInput = page.locator('[role="dialog"] input').nth(0);
    this.userLastNameInput = page.locator('[role="dialog"] input').nth(1);
    this.userEmailInput = page.locator('[role="dialog"] input[type="email"], [role="dialog"] input').nth(2);
    this.userPasswordInput = page.locator('[role="dialog"] input[type="password"]').first();
    this.userOrgDropdown = page.locator('[role="dialog"] button:has-text("Select organization"), [role="dialog"] [role="combobox"]').first();
    this.userRoleDropdown = page.locator('[role="dialog"] button:has-text("Reviewer"), [role="dialog"] button:has-text("Admin"), [role="dialog"] [role="combobox"]').last();
    this.submitCreateUserButton = page.locator('[role="dialog"] button:has-text("Create User")').first();
    this.closeUserModalButton = page.locator('[role="dialog"] button:has(svg.lucide-x)').first();

    // Organizations List
    this.orgsHeader = page.locator('h1:has-text("Organizations"), h2:has-text("Organizations"), :text("Manage organizations")').first();
    this.searchOrgInput = page.locator('input[placeholder*="search organization" i]').first();
    this.addOrgButton = page.locator('button:has-text("Add Organization"), button:has-text("+ Add Organization")').first();
    this.allTab = page.locator('button:has-text("All"), [role="tab"]:has-text("All")').first();
    this.activeTab = page.locator('button:has-text("Active"), [role="tab"]:has-text("Active")').first();
    this.inactiveTab = page.locator('button:has-text("Inactive"), [role="tab"]:has-text("Inactive")').first();
    this.orgCards = page.locator('div:has(> svg.lucide-building), div:has(button svg.lucide-eye):has(button svg.lucide-trash-2)');
    this.orgNames = page.locator('h3, h4, .font-semibold:has-text(".com"), div:has(> svg.lucide-building) + div h3');
    this.orgDomains = page.locator('text=/\\.com|\\.in|\\.org|\\.net|oracle/i');
    this.orgUsageBadges = page.locator('text=/\\d+\\s*\\/\\s*\\d+\\s*this period/i');
    this.orgStatusBadges = page.locator('text=/Active|Inactive/i');
    this.orgEyeButtons = page.locator('button:has(svg.lucide-eye)');
    this.orgDeleteButtons = page.locator('button:has(svg.lucide-trash-2), button:has(svg.lucide-trash)');

    // Create Organization Modal
    this.createOrgModal = page.locator('[role="dialog"]:has-text("Create Organization")').first();
    this.orgNameInput = page.locator('[role="dialog"] input[placeholder*="Acme" i], [role="dialog"] input').nth(0);
    this.orgDomainInput = page.locator('[role="dialog"] input[placeholder*="acme.com" i], [role="dialog"] input').nth(1);
    this.poCheckbox = page.locator('[role="dialog"]').getByText('PURCHASE_ORDER').first();
    this.quoteCheckbox = page.locator('[role="dialog"]').getByText('QUOTE_REQUEST').first();
    this.poAckCheckbox = page.locator('[role="dialog"]').getByText('PO-ACK RECON').first();
    this.directEstimateToggle = page.locator('[role="dialog"] button[role="switch"]').first();
    this.lifelineTrackingToggle = page.locator('[role="dialog"] button[role="switch"]').last();
    this.subscriptionPeriodDropdown = page.locator('[role="dialog"] button:has-text("Select period"), [role="dialog"] [role="combobox"]').first();
    this.starterPlanCard = page.locator('[role="dialog"]').getByText('Starter').first();
    this.enterprisePlanCard = page.locator('[role="dialog"]').getByText('Pro').first();
    this.growthPlanCard = page.locator('[role="dialog"]').getByText('Growth').first();
    this.proPlanCard = page.locator('[role="dialog"]').getByText('Pro').first();
    this.addressFileUploadInput = page.locator('[role="dialog"] input[type="file"]').first();
    this.submitCreateOrgButton = page.locator('[role="dialog"] button:has-text("Create Organization")').first();
    this.closeCreateOrgModalButton = page.locator('[role="dialog"] button:has(svg.lucide-x)').first();

    // Organization Details Page
    this.orgDetailsHeader = page.locator('h1:has-text("Organization Details"), :text("Organization Details")').first();
    this.backToOrgsButton = page.locator('button:has-text("Back")').first();
    this.orgTitle = page.locator('h1.font-bold, h2.font-bold').last();
    this.editOrgButton = page.locator('button:has-text("Edit")').first();
    this.saveOrgButton = page.locator('button:has-text("Save"), button:has-text("Save changes")').first();
    this.deleteOrgButton = page.locator('button:has-text("Delete")').first();
    this.payNowButton = page.locator('button:has-text("Pay Now")').first();
    this.billHistoryButton = page.locator('button:has-text("Bill History")').first();
    this.orgNameField = page.locator('div:has-text("Organization Name") input, div:has-text("Organization Name") p, div:has-text("Organization Name")').last();
    this.orgDomainField = page.locator('div:has-text("Domain") input, div:has-text("Domain") p, div:has-text("Domain")').last();
    this.orgStatusField = page.locator('div:has-text("Status") span, div:has-text("Status")').last();
    this.uploadCustomDocsButton = page.locator('button:has-text("Upload Custom Docs"), button:has-text("Upload Custom Documents")').first();
    this.customDocsSection = page.locator('div:has-text("Custom Documents"), div:has-text("Custom Docs")').first();
    this.directEstimateOrgDetailsToggle = page.locator('div:has-text("Direct Estimate Creation") button[role="switch"]').first();
    this.quotaLimitDisplay = page.locator('text=/Document Limit|User Limit|monthly quota|documents used/i').first();
  }

  /**
   * Open Settings menu in left sidebar
   */
  async openSettingsMenu(): Promise<void> {
    if (!await this.usersNavLink.isVisible().catch(() => false)) {
      await this.settingsNavLink.click();
      await this.page.waitForTimeout(500);
    }
  }

  /**
   * Navigate to Users page
   */
  async navigateToUsers(): Promise<void> {
    await this.navigateTo('/users');
    await this.page.waitForLoadState('networkidle').catch(() => {});
    await this.page.locator('text=/@/, div:has(> svg.lucide-user)').first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
    await this.page.waitForTimeout(500);
  }

  /**
   * Navigate to Organizations page
   */
  async navigateToOrganizations(): Promise<void> {
    await this.navigateTo('/organizations');
    await this.page.waitForLoadState('networkidle').catch(() => {});
    await this.page.locator('text=/this period/i, text=/total documents/i').first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
    await this.page.waitForTimeout(500);
  }

  /**
   * Open Create Organization modal
   */
  async openCreateOrgModal(): Promise<void> {
    await this.navigateToOrganizations();
    await this.addOrgButton.waitFor({ state: 'visible', timeout: 10000 });
    await this.addOrgButton.click();
    await this.createOrgModal.waitFor({ state: 'visible', timeout: 8000 });
    await this.page.waitForTimeout(500);
  }

  /**
   * Close Create Organization modal
   */
  async closeCreateOrgModal(): Promise<void> {
    if (await this.closeCreateOrgModalButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await this.closeCreateOrgModalButton.click();
    } else {
      await this.page.keyboard.press('Escape');
    }
    await this.createOrgModal.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  }

  /**
   * Open Organization Details page for Riverstone or first organization
   */
  async openOrganizationDetails(orgName: string = 'MJ'): Promise<void> {
    await this.navigateToOrganizations();
    const search = this.searchOrgInput;
    if (await search.isVisible()) {
      await search.fill(orgName);
      await this.page.waitForTimeout(1000);
    }
    const eyeBtn = this.page.locator('button:has(svg.lucide-eye), svg.lucide-eye').first();
    await eyeBtn.click({ force: true });
    await this.page.waitForURL('**/organizations/**', { timeout: 15000 }).catch(() => {});
    await this.page.waitForLoadState('networkidle').catch(() => {});
    await this.page.waitForTimeout(1000);
  }
}
