import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './base.page';

export class DashboardPage extends BasePage {
  // Locators
  readonly logoutButton: Locator;
  readonly organizationDropdown: Locator;
  readonly navMenu: Locator;
  readonly dashboardHeader: Locator;

  constructor(page: Page) {
    super(page);

    this.logoutButton = page.locator('aside button:has(svg), button:has-text("Logout"), [aria-label*="Logout" i]').first();
    this.organizationDropdown = page.locator('button:has-text("All Organizations"), button:has-text("Organization"), [role="combobox"]').first();
    this.navMenu = page.locator('aside, nav, .sidebar').first();
    this.dashboardHeader = page.locator('h1:has-text("Dashboard"), header:has-text("Dashboard"), :text("Dashboard")').first();
  }

  /**
   * Verify that user has successfully arrived on dashboard
   */
  async isDashboardLoaded(): Promise<boolean> {
    try {
      await this.page.waitForURL((url) => !url.pathname.includes('/login') && !url.pathname.endsWith('/'), { timeout: 20000 }).catch(() => {});
      const hasNav = await this.navMenu.isVisible({ timeout: 10000 }).catch(() => false);
      const hasHeader = await this.dashboardHeader.isVisible({ timeout: 10000 }).catch(() => false);
      const currentUrl = this.getCurrentUrl();
      return hasNav || hasHeader || currentUrl.includes('dashboard') || currentUrl.includes('home');
    } catch {
      return false;
    }
  }

  /**
   * Perform logout
   */
  async logout(): Promise<void> {
    await this.logoutButton.click();
    await this.page.waitForLoadState('networkidle').catch(() => {});
  }
}
