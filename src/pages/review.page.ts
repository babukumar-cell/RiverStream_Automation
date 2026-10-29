import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './base.page';

export class ReviewPage extends BasePage {
  // Top Header Actions
  readonly pageTitle: Locator;
  readonly backButton: Locator;
  readonly completeButton: Locator;
  readonly submitToErpButton: Locator;
  readonly statusBadge: Locator;

  // Left Panel - PDF Viewer & Controls
  readonly documentTitle: Locator;
  readonly documentPreview: Locator;
  readonly pageNumberIndicator: Locator;
  readonly prevPageButton: Locator;
  readonly nextPageButton: Locator;
  readonly zoomInButton: Locator;
  readonly zoomOutButton: Locator;
  readonly zoomPercentage: Locator;
  readonly downloadButton: Locator;
  readonly fitToPageButton: Locator;
  readonly selectionButton: Locator;

  // Right Panel - Tabs & Analysis
  readonly extractedDataTab: Locator;
  readonly jsonViewTab: Locator;
  readonly jsonContainer: Locator;
  readonly confidenceScores: Locator;
  readonly sourceCitationLinks: Locator;
  readonly copyButtons: Locator;
  readonly editButtons: Locator;
  readonly addressSwapButtons: Locator;

  // Extracted Fields
  readonly customerNameField: Locator;
  readonly poNumberField: Locator;
  readonly dateField: Locator;
  readonly totalAmountField: Locator;
  readonly billingAddressField: Locator;
  readonly shippingAddressField: Locator;

  // Order Line Items & Modal
  readonly orderLineItemsHeader: Locator;
  readonly expandLineItemsButton: Locator;
  readonly lineItemsModal: Locator;
  readonly editAllButton: Locator;
  readonly editingStatusIndicator: Locator;
  readonly cancelEditButton: Locator;
  readonly saveAllButton: Locator;
  readonly addRowButton: Locator;
  readonly lineItemTable: Locator;
  readonly lineItemRows: Locator;
  readonly lineItemInputs: Locator;
  readonly deleteRowButtons: Locator;
  readonly closeModalButton: Locator;

  constructor(page: Page) {
    super(page);

    // Top Header
    this.pageTitle = page.locator('h1:has-text("Review Document"), :text("Review Document")').first();
    this.backButton = page.locator('button:has-text("Back to Documents"), a:has-text("Back to Documents"), button:has-text("Back")').first();
    this.completeButton = page.locator('button:has-text("Complete")').first();
    this.submitToErpButton = page.locator('button:has-text("Submit to ERP")').first();
    this.statusBadge = page.locator('text=/Partially Success|Extracted|Complete|Processing/i').first();

    // Left Panel - PDF Viewer & Controls
    this.documentTitle = page.locator('h2:has-text(".pdf"), h3:has-text(".pdf"), :text(".pdf")').first();
    this.documentPreview = page.locator('img, canvas, .pdf-viewer, embed, iframe, div[class*="pdf"]').first();
    this.pageNumberIndicator = page.getByText(/Page\s*\d+\s*[\/of]\s*\d+/i).first().or(page.locator(':text("Page 1")').first());
    this.prevPageButton = page.locator('button:has-text("<")').first();
    this.nextPageButton = page.locator('button:has-text(">")').first();
    this.zoomInButton = page.locator('button:has(svg.lucide-zoom-in), button[aria-label*="zoom in" i], button:has-text("+")').first();
    this.zoomOutButton = page.locator('button:has(svg.lucide-zoom-out), button[aria-label*="zoom out" i], button:has-text("-")').first();
    this.zoomPercentage = page.locator('text=/\\d+%/i').first();
    this.downloadButton = page.locator('button:has(svg.lucide-download), button[aria-label*="download" i], a[aria-label*="download" i]').first();
    this.fitToPageButton = page.locator('button:has(svg.lucide-scan), button:has(svg.lucide-expand)').first();
    this.selectionButton = page.locator('button:has(svg.lucide-mouse-pointer), button[aria-label*="select" i]').first();

    // Right Panel - Tabs & Analysis
    this.extractedDataTab = page.locator('button:has-text("Extracted Data"), [role="tab"]:has-text("Extracted Data")').first();
    this.jsonViewTab = page.locator('button:has-text("JSON View"), [role="tab"]:has-text("JSON View")').first();
    this.jsonContainer = page.locator('pre, code, textarea, [class*="json"]').first();
    this.confidenceScores = page.locator('span:has-text("%"), [class*="badge"]:has-text("%")');
    this.sourceCitationLinks = page.locator('text=/Source:\\s*Page/i');
    this.copyButtons = page.locator('button:has(svg.lucide-copy), [aria-label*="copy" i]');
    this.editButtons = page.locator('button:has(svg.lucide-pen), button:has(svg.lucide-pencil), [aria-label*="edit" i]');
    this.addressSwapButtons = page.locator('button:has(svg.lucide-arrow-left-right), button:has(svg.lucide-arrow-right-left), button:has(svg.lucide-arrow-up-down), button:has-text("⇄")');

    // Extracted Fields
    this.customerNameField = page.locator('div:has(> p:has-text("Customer Name")), div:has-text("Customer Name")').last();
    this.poNumberField = page.locator('div:has(> p:has-text("Purchase Order")), div:has(> p:has-text("Po Number")), div:has-text("Purchase Order")').last();
    this.dateField = page.locator('div:has(> p:has-text("Invoice Date")), div:has(> p:has-text("Estimate Date")), div:has-text("Invoice Date")').last();
    this.totalAmountField = page.locator('div:has(> p:has-text("Total Amount")), div:has-text("Total Amount")').last();
    this.billingAddressField = page.locator('div:has-text("Billing Address"), div:has-text("Billing Addressee Name")').last();
    this.shippingAddressField = page.locator('div:has-text("Shipping Address"), div:has-text("Shipping Addressee Name")').last();

    // Order Line Items & Modal
    this.orderLineItemsHeader = page.locator(':text("Order Line Items")').first();
    this.expandLineItemsButton = page.locator('div:has-text("Order Line Items") button:has(svg), div:has-text("Order Line Items") svg').last();
    this.lineItemsModal = page.locator('[role="dialog"]:has-text("Order Line Items"), div:has(h2:has-text("Order Line Items"))').first();
    this.editAllButton = page.locator('button:has-text("Edit All")').first();
    this.editingStatusIndicator = page.locator('button:has-text("Editing"), :text("Editing")').first();
    this.cancelEditButton = page.locator('button:has-text("Cancel")').first();
    this.saveAllButton = page.locator('button:has-text("Save All"), button:has-text("Save")').first();
    this.addRowButton = page.locator('button:has-text("+ Add Row"), button:has-text("Add Row")').first();
    this.lineItemTable = page.locator('[role="dialog"] table, table').first();
    this.lineItemRows = page.locator('[role="dialog"] table tbody tr, table tbody tr');
    this.lineItemInputs = page.locator('[role="dialog"] table tbody tr input, table tbody tr input');
    this.deleteRowButtons = page.locator('[role="dialog"] table tbody tr button:has(svg.lucide-trash), table tbody tr button:has(svg)');
    this.closeModalButton = page.locator('[role="dialog"] button:has(svg.lucide-x), [role="dialog"] button:has-text("×")').first();
  }

  /**
   * Wait for review page loading spinner to finish and core UI elements to be visible
   */
  async waitForReviewLoaded(): Promise<void> {
    // Explicitly wait for any document loading spinner/overlay to disappear
    const loading = this.page.locator(':text("Loading document..."), :text("Loading...")').first();
    await loading.waitFor({ state: 'hidden', timeout: 35000 }).catch(() => {});

    // Explicitly wait until the core review interface element is visible
    const reviewReady = this.completeButton
      .or(this.extractedDataTab)
      .or(this.pageNumberIndicator)
      .or(this.documentTitle)
      .first();
    await reviewReady.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});

    // Dismiss any popup error dialog (such as "ERP Insertion Failed") if one appeared
    const errorDialogClose = this.page.locator('button:has-text("Close"), div[role="dialog"] button:has-text("Close")').first();
    if (await errorDialogClose.isVisible().catch(() => false)) {
      await errorDialogClose.click({ force: true }).catch(() => {});
    }
  }

  /**
   * Navigate to Documents library or Dashboard and open a reviewable document
   */
  async openFirstPdfDocument(): Promise<void> {
    // If already on a review page, explicitly verify and return
    if (this.page.url().includes('/review/')) {
      await this.waitForReviewLoaded();
      return;
    }

    await this.navigateTo('/documents');

    // Explicitly wait for the documents table to render rows
    const tableRow = this.page.locator('table tbody tr').first();
    const hasTable = await tableRow.waitFor({ state: 'visible', timeout: 25000 }).then(() => true).catch(() => false);

    if (hasTable) {
      // Find the first review button (preferring .pdf documents if present)
      const pdfReviewBtn = this.page.locator('table tbody tr').filter({ hasText: /\.pdf/i }).locator('button:has-text("Review")').first();
      const anyReviewBtn = this.page.locator('table tbody tr button:has-text("Review"), button:has-text("Review")').first();

      const hasPdfBtn = await pdfReviewBtn.isVisible().catch(() => false);
      const targetBtn = hasPdfBtn ? pdfReviewBtn : anyReviewBtn;

      if (await targetBtn.isVisible().catch(() => false)) {
        await targetBtn.scrollIntoViewIfNeeded().catch(() => {});
        await Promise.all([
          this.page.waitForURL('**/review/**', { timeout: 35000 }),
          targetBtn.click({ force: true }),
        ]);
        await this.waitForReviewLoaded();
        return;
      }
    }

    // Fallback: Open from Dashboard pending review table
    await this.navigateTo('/dashboard');
    const dashReviewBtn = this.page.locator('table tbody tr button:has-text("Review")').first();
    await dashReviewBtn.waitFor({ state: 'visible', timeout: 25000 });
    await dashReviewBtn.scrollIntoViewIfNeeded().catch(() => {});
    await Promise.all([
      this.page.waitForURL('**/review/**', { timeout: 35000 }),
      dashReviewBtn.click({ force: true }),
    ]);
    await this.waitForReviewLoaded();
  }

  /**
   * Verify if document review page is loaded
   */
  async isDocumentLoaded(): Promise<boolean> {
    const hasHeader = await this.pageTitle.isVisible({ timeout: 10000 }).catch(() => false);
    const hasComplete = await this.completeButton.isVisible({ timeout: 5000 }).catch(() => false);
    return hasHeader || hasComplete;
  }

  /**
   * Expand Order Line Items modal
   */
  async expandOrderLineItems(): Promise<void> {
    const isAlreadyOpen = await this.lineItemsModal.isVisible().catch(() => false);
    if (!isAlreadyOpen) {
      const expandBtn = this.page.locator('div:has-text("Order Line Items") button:has(svg), div:has-text("Order Line Items") svg, [aria-label*="expand" i]').last();
      await expandBtn.scrollIntoViewIfNeeded().catch(() => {});
      await expandBtn.click();
      await this.lineItemsModal.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
      await this.page.waitForTimeout(500);
    }
  }

  /**
   * Close Order Line Items modal
   */
  async closeOrderLineItems(): Promise<void> {
    const isModalOpen = await this.lineItemsModal.isVisible().catch(() => false);
    if (!isModalOpen) return;

    const closeBtn = this.page.locator('[role="dialog"] button:has(svg.lucide-x), [role="dialog"] button:has-text("×"), [role="dialog"] button[aria-label*="close" i]').first();
    if (await closeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await closeBtn.click();
    } else {
      await this.page.keyboard.press('Escape');
    }
    await this.lineItemsModal.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  }

  // Convenience helpers
  async openJsonView(): Promise<void> {
    await this.jsonViewTab.click();
  }

  async openExtractedData(): Promise<void> {
    await this.extractedDataTab.click();
  }

  async getJsonContent(): Promise<string> {
    return (await this.jsonContainer.innerText().catch(() => '')) || '';
  }

  async openLineItemsModal(): Promise<void> {
    await this.expandOrderLineItems();
  }

  async closeLineItemsModal(): Promise<void> {
    await this.closeOrderLineItems();
  }

  async isInEditMode(): Promise<boolean> {
    return this.cancelEditButton.isVisible({ timeout: 2000 }).catch(() => false);
  }

  async cancelEditing(): Promise<void> {
    if (await this.cancelEditButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await this.cancelEditButton.click();
    }
  }
}
