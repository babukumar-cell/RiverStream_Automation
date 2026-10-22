import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './base.page';

/** Primary sidebar entries: visible label, route reached after clicking, and the app header title. */
export const SidebarRoutes = [
  { label: 'Dashboard', url: /\/dashboard$/, header: 'Dashboard' },
  { label: 'Documents', url: /\/documents$/, header: 'Documents' },
  { label: 'PO-ACK Recon', url: /\/po-ack-recon$/, header: 'PO-ACK Recon' },
  { label: 'Clients', url: /\/clients$/, header: 'Clients' },
  { label: 'Analytics', url: /\/analytics$/, header: 'Analytics' },
  { label: 'Audit Logs', url: /\/coming-soon\?from=audit-logs$/, header: 'Audit Logs' },
] as const;

/**
 * Application shell shared by every logged-in page: left sidebar (navigation, plan badge, logout)
 * and the top header (page title, notification bell, signed-in user).
 */
export class LeftSidePage extends BasePage {
  readonly sidebar: Locator;
  readonly sidebarNav: Locator;
  readonly collapseSidebarButton: Locator;
  readonly expandSidebarButton: Locator;
  readonly logoutButton: Locator;
  readonly planName: Locator;
  readonly planValidity: Locator;

  readonly header: Locator;
  readonly bellButton: Locator;
  readonly headerAvatar: Locator;

  // Dashboard & Navigation accessors
  readonly orgDropdown: Locator;
  readonly totalDocumentsCard: Locator;
  readonly processingRateCard: Locator;
  readonly extractionAccuracyCard: Locator;
  readonly reviewedCard: Locator;
  readonly pendingReviewCard: Locator;
  readonly processingCard: Locator;
  readonly avgProcessingTimeCard: Locator;
  readonly documentsNavLink: Locator;

  constructor(page: Page) {
    super(page);

    this.sidebar = page.locator('aside');
    this.sidebarNav = this.sidebar.getByRole('navigation');
    this.collapseSidebarButton = page.getByRole('button', { name: 'Collapse sidebar' });
    this.expandSidebarButton = page.getByRole('button', { name: 'Expand sidebar' });
    this.logoutButton = this.sidebar.getByRole('button', { name: 'Logout' });
    this.planName = this.sidebar.getByText(/^\w[\w ]* Plan$/);
    this.planValidity = this.sidebar.getByText(/^Valid until /);

    this.header = page.getByRole('banner');
    this.bellButton = this.header.locator('button:has(svg.lucide-bell)');
    this.headerAvatar = this.header.locator('[data-slot="avatar"]');

    this.orgDropdown = page.getByRole('combobox').or(page.locator('[data-slot="select-trigger"], .org-dropdown'));
    this.totalDocumentsCard = page.getByRole('tab', { name: /Total Documents/i }).or(page.locator('text=Total Documents'));
    this.processingRateCard = page.locator('text=Processing Rate').or(page.locator('text=Processing').first());
    this.extractionAccuracyCard = page.locator('text=Extraction Accuracy').or(page.locator('text=Accuracy').first());
    this.reviewedCard = page.getByRole('tab', { name: /Reviewed/i }).or(page.locator('text=Reviewed'));
    this.pendingReviewCard = page.getByRole('tab', { name: /Pending Review/i }).or(page.locator('text=Pending Review'));
    this.processingCard = page.getByRole('tab', { name: /Processing/i }).or(page.locator('text=Processing'));
    this.avgProcessingTimeCard = page.locator('text=Avg Processing Time').or(page.locator('text=Processing Time').first());
    this.documentsNavLink = this.sidebarNav.getByRole('button', { name: 'Documents', exact: true }).or(this.sidebarNav.locator('a[href*="document"], button:has-text("Documents")'));
  }

  /** Sidebar navigation button (works expanded and collapsed: collapsed buttons keep a title). */
  navButton(label: string): Locator {
    return this.sidebarNav.getByRole('button', { name: label, exact: true });
  }

  /** Signed-in user's display name in the header. */
  headerUserName(name: string): Locator {
    return this.header.getByText(name, { exact: true });
  }

  async openDashboard(): Promise<void> {
    await this.navigateTo('/dashboard');
    await expect(this.sidebarNav).toBeVisible();
  }

  async navigateViaSidebar(label: string): Promise<void> {
    await this.navButton(label).click();
  }

  /** Click Logout and wait for the Sign-In page. Only use in a test-owned (fresh) login session. */
  async clickLogout(): Promise<void> {
    await this.logoutButton.click();
    await expect(this.page).toHaveURL(/\/$/);
    await expect(this.page.locator('#email')).toBeVisible();
  }

  async sidebarWidth(): Promise<number> {
    const box = await this.sidebar.boundingBox();
    if (!box) throw new Error('Sidebar is not rendered');
    return box.width;
  }
}
