import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from '../base.page';
import { ConfirmDeleteDialog, labelledCombobox, selectOption, switchByTitle } from './settings-shared';

export type PlanName = 'Free Trial' | 'Starter' | 'Growth' | 'Pro';
export type SubscriptionPeriod = 'Monthly' | 'Yearly';
/** Document type chips as labelled in the Create Organization dialog */
export type CreateOrgDocType = 'PURCHASE_ORDER' | 'QUOTE_REQUEST' | 'PO-ACK RECON';
export type OrgStatusTab = 'All' | 'Active' | 'Inactive';

export interface NewOrganization {
  name: string;
  domain: string;
  /** Final selection of document type chips; PURCHASE_ORDER and QUOTE_REQUEST are pre-selected */
  docTypes?: CreateOrgDocType[];
  directEstimateCreation?: boolean;
  lifelineTracking?: boolean;
  period?: SubscriptionPeriod;
  plan?: PlanName;
}

/** "Create Organization" dialog opened from "Add Organization" */
export class CreateOrganizationDialog {
  readonly page: Page;
  readonly root: Locator;
  readonly heading: Locator;
  readonly nameLabel: Locator;
  readonly domainLabel: Locator;
  readonly nameInput: Locator;
  readonly domainInput: Locator;
  readonly domainError: Locator;
  readonly docTypeLabel: Locator;
  readonly directEstimateSwitch: Locator;
  readonly lifelineTrackingSwitch: Locator;
  readonly periodSelect: Locator;
  readonly planCards: Locator;
  readonly submitButton: Locator;
  readonly closeButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.root = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Create Organization', exact: true }) });
    this.heading = this.root.getByRole('heading', { name: 'Create Organization', exact: true });
    this.nameLabel = this.root.locator('label').filter({ hasText: /^Organization Name\s*\*$/ });
    this.domainLabel = this.root.locator('label').filter({ hasText: /^Domain\s*\*$/ });
    this.nameInput = this.root.getByPlaceholder('Acme Corp', { exact: true });
    this.domainInput = this.root.getByPlaceholder('acme.com', { exact: true });
    this.domainError = this.root.getByText('Please enter a valid domain (e.g. acme.com).', { exact: true });
    this.docTypeLabel = this.root.getByText('Select Document Type *', { exact: true });
    this.directEstimateSwitch = switchByTitle(this.root, 'Direct Estimate Creation');
    this.lifelineTrackingSwitch = switchByTitle(this.root, 'Lifeline Tracking');
    this.periodSelect = labelledCombobox(this.root, 'Subscription period');
    // Each plan card is a role=button tile with aria-pressed reflecting the selection
    this.planCards = this.root.locator('[role="button"][aria-pressed]');
    this.submitButton = this.root.getByRole('button', { name: 'Create Organization', exact: true });
    this.closeButton = this.root.getByRole('button', { name: 'Close', exact: true });
  }

  /** Clickable chip for a document type */
  docTypeChip(type: CreateOrgDocType): Locator {
    return this.root.getByText(type, { exact: true }).locator('xpath=..');
  }

  /** The chip shows a ✓ box when selected */
  async isDocTypeSelected(type: CreateOrgDocType): Promise<boolean> {
    return (await this.docTypeChip(type).innerText()).includes('✓');
  }

  async expectDocTypeSelected(type: CreateOrgDocType, selected: boolean): Promise<void> {
    if (selected) {
      await expect(this.docTypeChip(type)).toContainText('✓');
    } else {
      await expect(this.docTypeChip(type)).not.toContainText('✓');
    }
  }

  async setDocType(type: CreateOrgDocType, selected: boolean): Promise<void> {
    if ((await this.isDocTypeSelected(type)) !== selected) {
      await this.docTypeChip(type).click();
    }
    await this.expectDocTypeSelected(type, selected);
  }

  planCard(plan: PlanName): Locator {
    return this.planCards.filter({ has: this.page.getByRole('heading', { name: plan, exact: true }) });
  }

  /** Call-to-action button inside a plan card ("Start Free Trial", "Get Started", "Contact Sales") */
  planCta(plan: PlanName): Locator {
    return this.planCard(plan).locator('button');
  }

  async selectPeriod(period: SubscriptionPeriod): Promise<void> {
    await this.periodSelect.click();
    await selectOption(this.page, period === 'Monthly' ? 'Monthly' : /^Yearly/).click();
    await expect(this.periodSelect).toContainText(period);
  }

  async selectPlan(plan: PlanName): Promise<void> {
    await this.planCard(plan).click();
    await expect(this.planCard(plan)).toHaveAttribute('aria-pressed', 'true');
  }

  async setSwitch(sw: Locator, on: boolean): Promise<void> {
    if ((await sw.getAttribute('aria-checked')) !== String(on)) await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', String(on));
  }

  async fill(org: NewOrganization): Promise<void> {
    await this.nameInput.fill(org.name);
    await this.domainInput.fill(org.domain);
    if (org.docTypes) {
      const all: CreateOrgDocType[] = ['PURCHASE_ORDER', 'QUOTE_REQUEST', 'PO-ACK RECON'];
      // Select wanted types first so at least one stays selected throughout
      for (const t of org.docTypes) await this.setDocType(t, true);
      for (const t of all.filter(x => !org.docTypes!.includes(x))) await this.setDocType(t, false);
    }
    if (org.directEstimateCreation !== undefined) await this.setSwitch(this.directEstimateSwitch, org.directEstimateCreation);
    if (org.lifelineTracking !== undefined) await this.setSwitch(this.lifelineTrackingSwitch, org.lifelineTracking);
    await this.selectPeriod(org.period ?? 'Monthly');
    await this.selectPlan(org.plan ?? 'Free Trial');
  }

  /** Clicks Create Organization; resolves with the new orgId taken from the API response */
  async submit(): Promise<string> {
    const response = this.page.waitForResponse(
      res => /\/api\/createOrganization\b/.test(res.url()) && res.request().method() === 'POST',
      { timeout: 30000 },
    );
    await this.submitButton.click();
    const res = await response;
    expect(res.status(), 'createOrganization API status').toBe(200);
    const body = await res.json();
    await expect(this.root).toBeHidden({ timeout: 15000 });
    return body.entity.orgId as string;
  }

  async close(): Promise<void> {
    await this.closeButton.click();
    await expect(this.root).toBeHidden();
  }
}

/** Organizations list page (/organizations) — superAdmin only */
export class OrganizationsPage extends BasePage {
  readonly heading: Locator;
  readonly subtitle: Locator;
  readonly searchInput: Locator;
  readonly addOrganizationButton: Locator;
  readonly noOrganizationsMessage: Locator;
  /** One <h3> per organization card (the organization name) */
  readonly orgNames: Locator;
  readonly createDialog: CreateOrganizationDialog;
  readonly confirmDeleteDialog: ConfirmDeleteDialog;

  constructor(page: Page) {
    super(page);
    this.heading = page.getByRole('heading', { name: 'Organizations', level: 2, exact: true });
    this.subtitle = page.getByText('Manage organizations and their settings', { exact: true });
    this.searchInput = page.getByPlaceholder('Search organizations...');
    this.addOrganizationButton = page.getByRole('button', { name: 'Add Organization', exact: true });
    this.noOrganizationsMessage = page.getByText('No organizations found.', { exact: true });
    this.orgNames = page.locator('main h3');
    this.createDialog = new CreateOrganizationDialog(page);
    this.confirmDeleteDialog = new ConfirmDeleteDialog(page);
  }

  tab(name: OrgStatusTab): Locator {
    return this.page.getByRole('tab', { name, exact: true });
  }

  /** All organization cards currently rendered (nearest ancestor of each name holding the action buttons) */
  get orgCards(): Locator {
    return this.orgNames.locator('xpath=ancestor::div[.//button][1]');
  }

  orgCard(name: string): Locator {
    return this.orgCards.filter({ has: this.page.getByRole('heading', { name, exact: true }) });
  }

  /** Text pieces of a card */
  cardDomain(card: Locator): Locator {
    return card.locator('h3 + p');
  }

  cardUsage(card: Locator): Locator {
    return card.getByText(/this period$/);
  }

  /** "<Plan> · <n> total documents" */
  cardPlanSummary(card: Locator): Locator {
    return card.getByText(/total documents$/);
  }

  cardStatusBadge(card: Locator): Locator {
    return card.locator('[data-slot="badge"]');
  }

  cardViewButton(card: Locator): Locator {
    return card.getByRole('button').filter({ has: this.page.locator('svg.lucide-eye') });
  }

  cardDeleteButton(card: Locator): Locator {
    return card.getByRole('button').filter({ has: this.page.locator('svg.lucide-trash-2') });
  }

  async goto(): Promise<void> {
    await this.navigateTo('/organizations');
    await expect(this.heading).toBeVisible();
    await expect(this.orgNames.first().or(this.noOrganizationsMessage)).toBeVisible({ timeout: 30000 });
  }

  /** Types into the search box and waits for the list request issued for that text */
  async search(text: string): Promise<void> {
    const response = this.page.waitForResponse(
      res => /\/api\/superAdminListOrganizations\b/.test(res.url()) && (res.request().postData() || '').includes(JSON.stringify(text).slice(1, -1)),
      { timeout: 20000 },
    );
    await this.searchInput.fill(text);
    await response;
  }

  async selectTab(name: OrgStatusTab): Promise<void> {
    await this.tab(name).click();
    await expect(this.tab(name)).toHaveAttribute('aria-selected', 'true');
    await expect(this.orgNames.first().or(this.noOrganizationsMessage)).toBeVisible({ timeout: 20000 });
  }

  async openCreateDialog(): Promise<CreateOrganizationDialog> {
    await this.addOrganizationButton.click();
    await expect(this.createDialog.heading).toBeVisible();
    return this.createDialog;
  }

  async openDetails(name: string): Promise<void> {
    await this.search(name);
    const card = this.orgCard(name);
    await expect(card).toHaveCount(1);
    await this.cardViewButton(card).click();
    await this.page.waitForURL(/\/organizations\/[^/]+$/);
  }

  /** Deletes an organization from the list via its trash icon and the confirmation dialog */
  async deleteFromList(name: string): Promise<void> {
    await this.search(name);
    const card = this.orgCard(name);
    await expect(card).toHaveCount(1);
    await this.cardDeleteButton(card).click();
    await expect(this.confirmDeleteDialog.root).toBeVisible();
    const response = this.page.waitForResponse(res => /\/api\/deleteOrganization/i.test(res.url()), { timeout: 30000 });
    await this.confirmDeleteDialog.confirmButton.click();
    expect((await response).status(), 'deleteOrganization API status').toBe(200);
    await expect(this.confirmDeleteDialog.root).toBeHidden();
  }
}
