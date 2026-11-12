import { Page, Locator, FrameLocator, expect } from '@playwright/test';
import { BasePage } from './base.page';

export type BillingPlan = 'Starter' | 'Growth' | 'Pro';
export type BillingPeriod = 'Monthly' | 'Yearly';
export type BillingTab = 'Overview' | 'Payment Methods' | 'Billing History';

export interface TestCard {
  number: string;
  /** MM/YY as typed by a user, e.g. "12/26" */
  expiry: string;
  cvc: string;
}

/**
 * Plan picker (Starter / Growth / Pro cards with a Monthly / Yearly period). The same component is used on the
 * admin's Settings > Billing page and in the Super Admin's "Pay Now" panel on the organization details page.
 */
export class PlanPicker {
  readonly page: Page;
  readonly root: Locator;
  readonly periodLabel: Locator;
  /** Message shown when another plan is chosen while a subscription renews automatically */
  readonly switchBlockedMessage: Locator;

  constructor(page: Page, root: Locator) {
    this.page = page;
    this.root = root;
    // "Subscription period *" (mandatory marker inside the label)
    this.periodLabel = root.getByText(/^Subscription period\s*\*?$/);
    this.switchBlockedMessage = root.getByText(
      'This organization already has a subscription that renews automatically. Cancel it first to switch plans.',
      { exact: true },
    );
  }

  periodRadio(period: BillingPeriod): Locator {
    return this.root.getByRole('radio').and(this.root.locator(`[value="${period.toLowerCase()}"]`));
  }

  /** Label next to a period radio ("Monthly" / "Yearly (save 9%)") */
  periodOption(period: BillingPeriod): Locator {
    return this.root.locator('label').filter({ hasText: period === 'Monthly' ? /^Monthly$/ : /^Yearly/ });
  }

  async selectPeriod(period: BillingPeriod): Promise<void> {
    await this.periodRadio(period).click();
    await expect(this.periodRadio(period)).toHaveAttribute('aria-checked', 'true');
  }

  /** The plan card (a role=button tile whose aria-pressed reflects the selection) */
  card(plan: BillingPlan): Locator {
    return this.root.locator('[role="button"][aria-pressed]').filter({ has: this.page.getByRole('heading', { name: plan, exact: true }) });
  }

  /** Card call-to-action: "Get Started" / "Current Plan" / "Contact Sales" */
  cta(plan: BillingPlan): Locator {
    return this.card(plan).locator('button[type="button"]').last();
  }

  /** Green "Current Plan" ribbon on top of the subscribed plan */
  currentPlanBadge(plan: BillingPlan): Locator {
    return this.card(plan).locator('span').filter({ hasText: /^Current Plan$/ }).first();
  }

  price(plan: BillingPlan): Locator {
    return this.card(plan).locator('span').filter({ hasText: /^\$[\d,]+$/ }).first();
  }

  features(plan: BillingPlan): Locator {
    return this.card(plan).locator('li');
  }

  async selectPlan(plan: BillingPlan): Promise<void> {
    await this.card(plan).click();
    await expect(this.card(plan)).toHaveAttribute('aria-pressed', 'true');
  }
}

/** Stripe Payment Element (an iframe) used on the Billing page and on Stripe's hosted invoice page */
export class StripePaymentElement {
  readonly page: Page;
  readonly frame: FrameLocator;
  readonly cardTab: Locator;
  readonly cardNumber: Locator;
  readonly expiry: Locator;
  readonly cvc: Locator;
  readonly country: Locator;
  readonly postalCode: Locator;

  constructor(page: Page, iframeSelector = 'iframe[src*="elements-inner-payment"]') {
    this.page = page;
    this.frame = page.frameLocator(iframeSelector).first();
    this.cardTab = this.frame.getByRole('button', { name: 'Card', exact: true });
    this.cardNumber = this.frame.locator('input[name="number"]');
    this.expiry = this.frame.locator('input[name="expiry"]');
    this.cvc = this.frame.locator('input[name="cvc"]');
    this.country = this.frame.locator('select[name="country"]');
    this.postalCode = this.frame.locator('input[name="postalCode"]');
  }

  async selectCard(): Promise<void> {
    await this.cardTab.click();
    await expect(this.cardNumber).toBeVisible({ timeout: 30000 });
  }

  /** Types the card like a user (Stripe formats the value while typing) */
  async fillCard(card: TestCard): Promise<void> {
    await this.cardNumber.click();
    await this.cardNumber.pressSequentially(card.number.replace(/\s+/g, ''), { delay: 30 });
    await this.expiry.pressSequentially(card.expiry.replace(/\D/g, ''), { delay: 30 });
    await this.cvc.pressSequentially(card.cvc, { delay: 30 });
    // A ZIP code is only asked for some countries (e.g. United States)
    if (await this.postalCode.isVisible().catch(() => false)) await this.postalCode.fill('10001');
    await expect(this.cardNumber).toHaveValue(card.number.replace(/\s+/g, '').replace(/(\d{4})(?=\d)/g, '$1 '));
  }
}

/**
 * Clicks a button below a Stripe Payment Element. Once the card is complete, Stripe expands the optional
 * "Save my information" (Link) fields and the iframe grows, which moves the button: clicking while it moves
 * lands on the iframe instead. Wait until the button stays at the same position, then click.
 */
export async function clickWhenSettled(button: Locator): Promise<void> {
  let previous = '';
  for (let i = 0; i < 30; i++) {
    await button.scrollIntoViewIfNeeded();
    const box = JSON.stringify(await button.boundingBox());
    if (box === previous) break;
    previous = box;
    await button.page().waitForTimeout(400);
  }
  await button.click();
}

/** Settings > Billing (organization admin) */
export class BillingPage extends BasePage {
  readonly heading: Locator;
  readonly subtitle: Locator;
  readonly plans: PlanPicker;

  // Overview: current subscription card
  readonly subscriptionCard: Locator;
  readonly subscriptionPlan: Locator;
  readonly subscriptionBadge: Locator;
  readonly subscriptionStatusText: Locator;
  readonly cancelSubscriptionButton: Locator;
  readonly cancelPrompt: Locator;
  readonly confirmCancelButton: Locator;
  readonly keepSubscriptionButton: Locator;
  readonly switchPlansNote: Locator;
  readonly selectedPlanValue: Locator;

  // Payment Methods tab
  readonly subscribingTo: Locator;
  readonly subscribingAmount: Locator;
  readonly chargeNote: Locator;
  readonly paymentElement: StripePaymentElement;
  readonly subscribeButton: Locator;
  readonly paymentError: Locator;

  // Billing History tab
  readonly historyTable: Locator;
  readonly historyHeaders: Locator;
  readonly historyRows: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.getByRole('heading', { name: 'Billing', level: 1, exact: true });
    this.subtitle = page.getByText('Manage your plan, payment methods, and billing history', { exact: true });
    this.plans = new PlanPicker(page, page.locator('main'));

    this.subscriptionCard = page.locator('main div.rounded-xl').filter({ has: page.getByText('Current Subscription', { exact: true }) });
    this.subscriptionPlan = this.subscriptionCard.locator('p.text-lg');
    this.subscriptionBadge = this.subscriptionCard.locator('span.rounded-full');
    this.subscriptionStatusText = this.subscriptionCard.getByText(/^(Renews automatically on|Auto-renewal is off\.|This subscription has ended)/);
    this.cancelSubscriptionButton = this.subscriptionCard.getByRole('button', { name: 'Cancel subscription', exact: true });
    this.cancelPrompt = this.subscriptionCard.getByText('Cancel auto-renewal? Your plan stays active until the end of this period.', { exact: true });
    this.confirmCancelButton = this.subscriptionCard.getByRole('button', { name: /^(Yes, cancel|Cancelling\.\.\.)$/ });
    this.keepSubscriptionButton = this.subscriptionCard.getByRole('button', { name: 'Keep subscription', exact: true });
    this.switchPlansNote = page.getByText(
      'Your plan renews automatically. To switch plans, cancel this subscription and choose a new plan once it ends.',
      { exact: true },
    );
    this.selectedPlanValue = page.getByText('Selected Plan', { exact: true }).locator('xpath=following-sibling::p[1]');

    this.subscribingTo = page.getByText(/^Subscribing to /);
    this.subscribingAmount = this.subscribingTo.locator('xpath=following-sibling::span[1]');
    this.chargeNote = page.getByText(/^Your card will be charged automatically every (month|year) until you cancel\.$/);
    this.paymentElement = new StripePaymentElement(page, 'main iframe[title*="Secure payment input"]');
    this.subscribeButton = page.getByRole('button', { name: /^(Subscribe for \$[\d,.]+|Processing\.\.\.)$/ });
    this.paymentError = this.subscribeButton.locator('xpath=preceding-sibling::p[contains(@class,"text-red-600")][1]');

    this.historyTable = page.locator('main table');
    this.historyHeaders = this.historyTable.locator('thead th');
    this.historyRows = this.historyTable.locator('tbody tr');
  }

  tab(name: BillingTab): Locator {
    return this.page.getByRole('tab', { name, exact: true });
  }

  /** Opens Settings > Billing from the sidebar (the Settings group expands on click) */
  async openFromSidebar(): Promise<void> {
    const sidebar = this.page.locator('aside');
    const billing = sidebar.getByRole('button', { name: 'Billing', exact: true }).or(sidebar.getByRole('link', { name: 'Billing', exact: true }));
    if (!(await billing.isVisible().catch(() => false))) {
      await sidebar.getByRole('button', { name: 'Settings', exact: true }).or(sidebar.getByText('Settings', { exact: true })).first().click();
    }
    await billing.first().click();
    await this.page.waitForURL(/\/settings\/billing$/);
    await this.waitForBillingLoaded();
  }

  async goto(): Promise<void> {
    await this.navigateTo('/settings/billing');
    await this.waitForBillingLoaded();
  }

  /** Billing data (organization + plans) is loaded once the plan cards are rendered */
  async waitForBillingLoaded(): Promise<void> {
    await expect(this.heading).toBeVisible({ timeout: 30000 });
    await expect(this.page.getByText(/^Loading\.\.\.$/)).toHaveCount(0, { timeout: 30000 });
    await expect(this.plans.card('Growth')).toBeVisible({ timeout: 30000 });
  }

  async openTab(name: BillingTab): Promise<void> {
    await this.tab(name).click();
    await expect(this.tab(name)).toHaveAttribute('aria-selected', 'true');
    if (name === 'Billing History') {
      await expect(this.historyRows.first().or(this.page.getByText('No payments yet.', { exact: true }))).toBeVisible({ timeout: 30000 });
    }
  }

  /** Get Started on a plan: the app creates the subscription and opens the Payment Methods tab with Stripe's form */
  async startCheckout(plan: BillingPlan, period: BillingPeriod = 'Monthly'): Promise<void> {
    await this.plans.selectPeriod(period);
    await this.plans.selectPlan(plan);
    const created = this.page.waitForResponse((r) => /\/api\/createSubscription\b/.test(r.url()) && r.request().method() === 'POST', { timeout: 60000 });
    await this.plans.cta(plan).click();
    expect((await created).status(), 'createSubscription API status').toBe(200);
    await expect(this.tab('Payment Methods')).toHaveAttribute('aria-selected', 'true');
    await expect(this.paymentElement.cardTab).toBeVisible({ timeout: 60000 });
  }

  /** Reloads until the subscription card shows the expected badge (payments are applied by Stripe webhooks) */
  async waitForSubscriptionBadge(badge: RegExp, timeout = 120000): Promise<void> {
    await expect(async () => {
      await this.goto();
      await expect(this.subscriptionBadge).toHaveText(badge, { timeout: 5000 });
    }).toPass({ timeout, intervals: [3000, 5000, 10000] });
  }

  historyCell(row: Locator, column: string): Locator {
    return row.locator('td').nth(
      ['Invoice', 'Paid on', 'Plan', 'Type', 'Service period', 'Card', 'Amount', 'Invoice PDF'].indexOf(column),
    );
  }

  downloadButton(row: Locator): Locator {
    return row.getByRole('button', { name: /^(Download|Preparing\.\.\.)$/ });
  }
}

/** Stripe-hosted invoice page opened from the "Pay Now" button of the Payment Failed email */
export class StripeInvoicePage {
  readonly page: Page;
  readonly amount: Locator;
  readonly invoiceTo: Locator;
  readonly invoiceNumber: Locator;
  readonly usdCurrency: Locator;
  readonly paymentElement: StripePaymentElement;
  readonly payButton: Locator;
  readonly paidHeading: Locator;
  readonly paidAmount: Locator;
  readonly paymentMethod: Locator;

  constructor(page: Page) {
    this.page = page;
    this.amount = page.getByText(/^\$[\d,]+\.\d{2}$/).first();
    // Label and value are in two cells of a table row: <td><span>To</span></td><td>…</td>
    this.invoiceTo = StripeInvoicePage.valueOf(page, 'To');
    this.invoiceNumber = StripeInvoicePage.valueOf(page, 'Invoice');
    // The page offers the customer's local currency next to USD (geolocation): pay in USD
    this.usdCurrency = page.frameLocator('iframe[src*="elements-inner-currency-selector"]').first().getByText(/^\$[\d,]+\.\d{2}$/);
    this.paymentElement = new StripePaymentElement(page);
    this.payButton = page.getByRole('button', { name: /^Pay/ }).last();
    this.paidHeading = page.getByText('Invoice paid', { exact: true });
    this.paidAmount = this.paidHeading.locator('xpath=following::*[normalize-space()][1]');
    this.paymentMethod = StripeInvoicePage.valueOf(page, 'Payment method');
  }

  static valueOf(page: Page, label: string): Locator {
    return page.getByText(label, { exact: true }).locator('xpath=ancestor::td[1]/following-sibling::td[1]');
  }

  async waitForLoaded(): Promise<void> {
    await expect(this.amount).toBeVisible({ timeout: 60000 });
    await expect(this.paymentElement.cardTab.or(this.paidHeading)).toBeVisible({ timeout: 60000 });
  }

  async chooseUsd(): Promise<void> {
    if (await this.usdCurrency.isVisible().catch(() => false)) await this.usdCurrency.click();
  }
}
