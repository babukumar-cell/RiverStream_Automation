import { Page, Locator } from '@playwright/test';
import { BasePage } from './base.page';

export class LeftSidePage extends BasePage {
  // Navigation & Header Locators
  readonly logoutButton: Locator;
  readonly userProfile: Locator;
  readonly orgDropdown: Locator;
  readonly dashboardNavLink: Locator;
  readonly documentsNavLink: Locator;
  readonly clientsNavLink: Locator;
  readonly analyticsNavLink: Locator;
  readonly settingsNavLink: Locator;
  readonly uploadNewFileButton: Locator;

  // Metric Cards Locators
  readonly totalDocumentsCard: Locator;
  readonly totalPOsCard: Locator;
  readonly processingRateCard: Locator;
  readonly extractionAccuracyCard: Locator;
  readonly reviewedCard: Locator;
  readonly pendingReviewCard: Locator;
  readonly processingCard: Locator;
  readonly avgProcessingTimeCard: Locator;

  constructor(page: Page) {
    super(page);

    // Sidebar & User controls
    this.userProfile = page.locator('text=/Admin Riverstone/i, .avatar, button:has([class*="lucide-user"])').first();
    this.logoutButton = page.locator('aside button:has(svg.lucide-log-out), button:has(svg.lucide-log-out), aside [aria-label*="logout" i], aside [title*="logout" i], button:has-text("Logout")').first();
    this.orgDropdown = page.locator('button:has-text("All Organizations"), button:has-text("Organization"), [role="combobox"]').first();
    this.dashboardNavLink = page.locator('aside a:has-text("Dashboard"), button:has-text("Dashboard")').first();
    this.documentsNavLink = page.locator('aside a:has-text("Documents"), button:has-text("Documents")').first();
    this.clientsNavLink = page.locator('aside a:has-text("Clients"), button:has-text("Clients")').first();
    this.analyticsNavLink = page.locator('aside a:has-text("Analytics"), button:has-text("Analytics")').first();
    this.settingsNavLink = page.locator('aside a:has-text("Settings"), button:has-text("Settings")').first();
    this.uploadNewFileButton = page.locator('button:has-text("Upload New File")').first();

    // Metric Cards (matching exact dashboard text observed)
    this.totalDocumentsCard = page.locator('div:has-text("Total Documents"), div:has-text("Total POs")').first();
    this.totalPOsCard = this.totalDocumentsCard;
    this.processingRateCard = page.locator('div:has-text("Processing Rate")').first();
    this.extractionAccuracyCard = page.locator('div:has-text("Extraction Accuracy")').first();
    this.reviewedCard = page.locator('div:has-text("Reviewed")').first();
    this.pendingReviewCard = page.locator('div:has-text("Pending Review")').first();
    this.processingCard = page.locator('div:has-text("Processing")').first();
    this.avgProcessingTimeCard = page.locator('div:has-text("Avg Processing Time")').first();
  }

  async selectOrganization(orgName: string): Promise<void> {
    if (await this.orgDropdown.isVisible({ timeout: 5000 }).catch(() => false)) {
      await this.orgDropdown.click();
      await this.page.locator(`text=${orgName}`).first().click();
    }
  }

  async clickLogout(): Promise<void> {
    if (await this.logoutButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await this.logoutButton.click();
    } else if (await this.userProfile.isVisible({ timeout: 3000 }).catch(() => false)) {
      await this.userProfile.click();
      const popupLogout = this.page.locator('button:has-text("Logout"), button:has-text("Sign out"), a:has-text("Logout")').first();
      await popupLogout.click();
    }
    await this.page.waitForLoadState('networkidle').catch(() => {});
  }
}
