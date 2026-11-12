import { Page, Locator, Response, expect } from '@playwright/test';
import { BasePage } from './base.page';

/** One extracted value as stored by the backend (GET /api/getDocument/<id>) */
export interface ReviewField {
  value: string | number | null;
  user_value?: string | null;
  confidence_score?: number;
  citation?: { text?: string; page?: number } | string | null;
}

export type ReviewFieldKey =
  | 'customer_name'
  | 'purchase_order'
  | 'invoice_date'
  | 'total_amount'
  | 'billing_addressee_name'
  | 'shipping_addressee_name'
  | 'billing_address'
  | 'shipping_address';

export interface ReviewDocument {
  _id: string;
  fileName: string;
  status: string;
  selectedDocType: string;
  extractedData: Record<ReviewFieldKey, ReviewField> & { order_line_items: Array<Record<string, ReviewField>> };
}

/** Card label shown on the review page for each extracted field */
export const FIELD_LABELS: Record<ReviewFieldKey, string> = {
  customer_name: 'Customer Name',
  purchase_order: 'Purchase Order',
  invoice_date: 'Invoice Date',
  total_amount: 'Total Amount',
  billing_addressee_name: 'Billing Addressee Name',
  shipping_addressee_name: 'Shipping Addressee Name',
  billing_address: 'Billing Address',
  shipping_address: 'Shipping Address',
};

/**
 * Document Review page (/review/<id>?from=documents|dashboard), Nov 2026 UI:
 *  - header: "Back to Documents|Dashboard", "Document Review", status badge, "Submit to ERP"
 *  - left card: file name, "Original PDF document", page / zoom / download / search toolbar, PDF viewer
 *    (react-pdf-viewer: one region "Page N" per page, drawn on a canvas)
 *  - right card: "Document Analysis", "Complete", tabs "Extracted Data" / "JSON View", one card per field
 *    (confidence badge, value, "Source: Page N", copy / edit / pick-from-PDF buttons), Swap buttons between
 *    billing and shipping, and the "Order Line Items" summary that expands into a table popup.
 * Edits on the page stay in the browser until "Complete" saves them (POST /api/updateDocument).
 */
export class ReviewPage extends BasePage {
  // Header
  readonly backButton: Locator;
  readonly pageHeading: Locator;
  readonly submitToErpButton: Locator;
  readonly erpOrderMessage: Locator;
  readonly erpErrorDialog: Locator;

  // Viewer
  readonly fileTypeLabel: Locator;
  readonly pageIndicator: Locator;
  readonly prevPageButton: Locator;
  readonly nextPageButton: Locator;
  readonly zoomInButton: Locator;
  readonly zoomOutButton: Locator;
  readonly zoomLevel: Locator;
  readonly downloadButton: Locator;
  readonly downloadLink: Locator;
  readonly searchButton: Locator;
  readonly searchInput: Locator;
  readonly searchSubmitButton: Locator;
  readonly searchResultCount: Locator;
  readonly pdfCanvas: Locator;
  readonly pickBanner: Locator;

  // Analysis
  readonly analysisHeading: Locator;
  readonly completeButton: Locator;
  readonly extractedDataTab: Locator;
  readonly jsonViewTab: Locator;
  readonly tabPanel: Locator;
  readonly jsonBlock: Locator;
  readonly swapNamesButton: Locator;
  readonly swapAddressesButton: Locator;
  readonly lineItemsSummary: Locator;
  readonly expandLineItemsButton: Locator;
  readonly lineItemsSectionTitle: Locator;
  readonly inlineLineItemRows: Locator;

  // Order Line Items popup
  readonly lineItemsModal: Locator;
  readonly lineItemsRowCount: Locator;
  readonly closeLineItemsButton: Locator;
  readonly editAllButton: Locator;
  readonly editingButton: Locator;
  readonly saveAllButton: Locator;
  readonly cancelButton: Locator;
  readonly addRowButton: Locator;
  readonly saveChangesButton: Locator;
  readonly newRowButton: Locator;
  readonly lineItemHeaders: Locator;
  readonly lineItemRows: Locator;

  constructor(page: Page) {
    super(page);

    this.backButton = page.getByRole('button', { name: /^Back to (Documents|Dashboard)$/ });
    this.pageHeading = page.getByRole('heading', { name: 'Document Review', level: 1 });
    this.submitToErpButton = page.getByRole('button', { name: 'Submit to ERP', exact: true });
    // "Sales Order is submitted in ERP frappe with Order Number: SAL-ORD-..." (the number is a separate link)
    this.erpOrderMessage = page.locator('div').filter({ has: page.getByText(/Sales Order is submitted in ERP/) }).filter({ hasText: /SAL-ORD-/ }).last();
    this.erpErrorDialog = page.getByRole('dialog').or(page.getByRole('alertdialog')).filter({ hasText: 'ERP Insertion Failed' });

    this.fileTypeLabel = page.getByText(/^Original \w+ document$/);
    this.pageIndicator = page.getByText(/^Page \d+ \/ \d+$/);
    this.prevPageButton = this.pageIndicator.locator('xpath=preceding-sibling::button[1]');
    this.nextPageButton = this.pageIndicator.locator('xpath=following-sibling::button[1]');
    this.zoomInButton = page.getByRole('button', { name: 'Zoom in' });
    this.zoomOutButton = page.getByRole('button', { name: 'Zoom out' });
    this.zoomLevel = this.zoomOutButton.locator('xpath=following-sibling::*[1]');
    this.downloadButton = page.getByRole('button', { name: 'Download' });
    this.downloadLink = page.getByRole('link').filter({ has: this.downloadButton });
    this.searchButton = page.getByRole('button', { name: 'Search in PDF' });
    this.searchInput = page.getByRole('textbox', { name: 'Search in PDF…' });
    this.searchSubmitButton = page.getByRole('button', { name: 'Search', exact: true });
    this.searchResultCount = this.searchInput.locator('xpath=../..').getByText(/^\d+ \/ \d+$/);
    this.pdfCanvas = page.locator('.rpv-core__inner-pages canvas, canvas');
    this.pickBanner = page.getByText(/^Select text in the PDF to fill/);

    this.analysisHeading = page.getByRole('heading', { name: 'Document Analysis' });
    this.completeButton = page.getByRole('button', { name: 'Complete', exact: true });
    this.extractedDataTab = page.getByRole('tab', { name: 'Extracted Data' });
    this.jsonViewTab = page.getByRole('tab', { name: 'JSON View' });
    this.tabPanel = page.getByRole('tabpanel');
    this.jsonBlock = this.tabPanel.locator('pre');
    // Two Swap buttons: addressee names, then addresses
    this.swapNamesButton = page.getByRole('button', { name: 'Swap', exact: true }).nth(0);
    this.swapAddressesButton = page.getByRole('button', { name: 'Swap', exact: true }).nth(1);
    this.lineItemsSummary = page.getByText(/^(Table with \d+ rows?|Array with \d+ items?)$/);
    this.expandLineItemsButton = page.getByRole('button', { name: 'Expand table to view or edit values' });
    // Clicking the section title opens the table inside the panel (its values link to the PDF page)
    this.lineItemsSectionTitle = this.tabPanel.getByText('Order Line Items', { exact: true });
    this.inlineLineItemRows = this.tabPanel.locator('table tbody tr');

    // The popup is the innermost element holding both its heading and its table
    this.lineItemsModal = page
      .locator('div')
      .filter({ has: page.getByRole('heading', { name: 'Order Line Items', level: 2 }) })
      .filter({ has: page.locator('table') })
      .last();
    this.lineItemsRowCount = this.lineItemsModal.getByText(/^\d+ rows?$/);
    this.closeLineItemsButton = this.lineItemsModal.locator('button:has(svg.lucide-x)').first();
    this.editAllButton = this.lineItemsModal.getByRole('button', { name: 'Edit All', exact: true });
    this.editingButton = this.lineItemsModal.getByRole('button', { name: 'Editing...', exact: true });
    this.saveAllButton = this.lineItemsModal.getByRole('button', { name: 'Save All', exact: true });
    this.cancelButton = this.lineItemsModal.getByRole('button', { name: 'Cancel', exact: true });
    this.addRowButton = this.lineItemsModal.getByRole('button', { name: '+ Add Row', exact: true });
    this.saveChangesButton = this.lineItemsModal.getByRole('button', { name: 'Save Changes', exact: true });
    this.newRowButton = this.lineItemsModal.getByRole('button', { name: '+ New row', exact: true });
    this.lineItemHeaders = this.lineItemsModal.locator('thead th');
    this.lineItemRows = this.lineItemsModal.locator('tbody tr');
  }

  // =========================================================================
  // Loading
  // =========================================================================

  static isGetDocument = (r: Response, id?: string) =>
    r.request().method() === 'GET' && (id ? r.url().includes(`/api/getDocument/${id}`) : /\/api\/getDocument\/\w+/.test(r.url()));

  /** Opens /review/<id> and returns the document the page loaded (reloading while it is still processing). */
  async open(id: string, from: 'documents' | 'dashboard' = 'documents'): Promise<ReviewDocument> {
    let doc: ReviewDocument | undefined;
    await expect(async () => {
      const loaded = this.page.waitForResponse((r) => ReviewPage.isGetDocument(r, id), { timeout: 45000 });
      await this.navigateTo(`/review/${id}?from=${from}`);
      const r = await loaded;
      expect(r.status(), 'getDocument HTTP status').toBe(200);
      doc = (await r.json()) as ReviewDocument;
      expect(doc.status, `${doc.fileName} has finished processing`).not.toBe('processing');
    }).toPass({ timeout: 300000, intervals: [10000, 15000, 20000] });
    await this.waitForReviewLoaded();
    return doc!;
  }

  /** Waits until the analysis panel and the document preview have rendered (shared by other suites). */
  async waitForReviewLoaded(): Promise<void> {
    // "Extracted Data" is on every review page (PO, quote / SIF, spreadsheets)
    await expect(this.extractedDataTab.or(this.page.getByText(/Loading document/i)).first()).toBeVisible({ timeout: 45000 });
    await expect(this.page.getByText(/^Loading document/i)).toHaveCount(0, { timeout: 45000 });
    await expect(this.extractedDataTab).toBeVisible({ timeout: 45000 });
    // PDF: drawn on a canvas (zoom reads 0% until then); spreadsheets / EDI / SIF render as a table or text
    await this.pdfCanvas
      .first()
      .or(this.page.getByText(/^Showing sheet \d+ of \d+$/))
      .first()
      .waitFor({ state: 'visible', timeout: 45000 })
      .catch(() => {});
    if (await this.pdfCanvas.first().isVisible()) await expect(this.zoomLevel).not.toHaveText('0%', { timeout: 30000 });
  }

  /** Re-reads the document from the API (same auth as the page). */
  async reload(): Promise<ReviewDocument> {
    const loaded = this.page.waitForResponse((r) => ReviewPage.isGetDocument(r), { timeout: 45000 });
    await this.page.reload();
    const doc = (await (await loaded).json()) as ReviewDocument;
    await this.waitForReviewLoaded();
    return doc;
  }

  // =========================================================================
  // Header
  // =========================================================================

  /** Status badge next to "Submit to ERP" (Extracted, Reviewed, Success, ...). */
  statusBadge(status: string | RegExp): Locator {
    return this.page
      .locator('div')
      .filter({ has: this.backButton })
      .filter({ has: this.submitToErpButton })
      .last()
      .getByText(status, { exact: typeof status === 'string' });
  }

  // =========================================================================
  // Viewer
  // =========================================================================

  fileHeading(fileName: string): Locator {
    return this.page.getByRole('heading', { name: fileName, level: 2 });
  }

  /** Text layer of one PDF page (role=region "Page N"). */
  pdfPage(n: number): Locator {
    return this.page.getByRole('region', { name: `Page ${n}`, exact: true });
  }

  /**
   * Waits until the PDF viewer has stopped scrolling. The page counter changes as soon as Next / Previous /
   * a citation is clicked, before the viewer scrolls; a click made during that scroll is overridden by it.
   */
  async waitForPdfScrollSettled(): Promise<void> {
    const scroller = this.page.locator('.rpv-core__inner-pages').first();
    let last = -1;
    await expect
      .poll(
        async () => {
          const top = await scroller.evaluate((e) => e.scrollTop);
          const settled = top === last;
          last = top;
          return settled;
        },
        { message: 'PDF viewer stopped scrolling', intervals: [400], timeout: 15000 },
      )
      .toBe(true);
  }

  /** Goes to the next / previous PDF page and waits for the viewer to get there. */
  async goToPage(direction: 'next' | 'previous'): Promise<void> {
    await (direction === 'next' ? this.nextPageButton : this.prevPageButton).click();
    await this.waitForPdfScrollSettled();
  }

  async zoomPercent(): Promise<number> {
    return parseInt((await this.zoomLevel.innerText()).replace('%', ''), 10);
  }

  /** "Pick value from PDF" for a field, then draws the selection rectangle around `text` on PDF page `pageNo`. */
  async pickFromPdf(label: string, pageNo: number, text: string): Promise<void> {
    await this.fieldPickButton(label).click();
    await expect(this.pickBanner).toHaveText(`Select text in the PDF to fill "${label}"`);
    const span = this.pdfPage(pageNo).locator('span.rpv-core__text-layer-text').filter({ hasText: new RegExp(`^${escapeRe(text)}$`) }).first();
    await span.scrollIntoViewIfNeeded();
    const box = (await span.boundingBox())!;
    await this.page.mouse.move(box.x - 3, box.y - 3);
    await this.page.mouse.down();
    await this.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
    await this.page.mouse.move(box.x + box.width + 3, box.y + box.height + 3, { steps: 10 });
    await this.page.mouse.up();
    await expect(this.pickBanner).toHaveCount(0);
  }

  // =========================================================================
  // Extracted Data cards
  // =========================================================================

  /** A field card: label, confidence, value, "Source: Page N" and its buttons. */
  fieldCard(label: string): Locator {
    return this.tabPanel.locator('div.rounded-xl').filter({ has: this.page.getByText(label, { exact: true }) }).last();
  }

  /** Displayed value (the paragraph under the label; not shown while the field is being edited). */
  fieldValue(label: string): Locator {
    return this.fieldCard(label).locator('p').nth(1);
  }

  fieldConfidence(label: string): Locator {
    return this.fieldCard(label).getByText(/^\d+%$/);
  }

  fieldSource(label: string): Locator {
    return this.fieldCard(label).getByText(/^Source: Page \d+$/);
  }

  fieldCopyButton(label: string): Locator {
    return this.fieldCard(label).locator('button:has(svg.lucide-copy)');
  }

  fieldEditButton(label: string): Locator {
    return this.fieldCard(label).locator('button:has(svg.lucide-pen)');
  }

  fieldPickButton(label: string): Locator {
    return this.fieldCard(label).getByRole('button', { name: 'Pick value from PDF' });
  }

  fieldInput(label: string): Locator {
    return this.fieldCard(label).getByRole('textbox');
  }

  fieldSaveButton(label: string): Locator {
    return this.fieldCard(label).locator('button:has(svg.lucide-check)');
  }

  /** Displayed value with line breaks / repeated spaces collapsed. */
  async fieldText(label: string): Promise<string> {
    return (await this.fieldValue(label).innerText()).replace(/\s+/g, ' ').trim();
  }

  // =========================================================================
  // Order Line Items popup
  // =========================================================================

  async openLineItems(): Promise<void> {
    await this.expandLineItemsButton.scrollIntoViewIfNeeded();
    await this.expandLineItemsButton.click();
    await expect(this.lineItemsModal).toBeVisible();
    await expect(this.lineItemRows.first()).toBeVisible();
  }

  async closeLineItems(): Promise<void> {
    await this.closeLineItemsButton.click();
    await expect(this.lineItemsModal).toBeHidden();
  }

  /** Header texts of the line-items table. */
  async lineItemColumns(): Promise<string[]> {
    return (await this.lineItemHeaders.allInnerTexts()).map((t) => t.trim());
  }

  /** Cell texts of every row (input values while editing), without the Actions column. */
  async lineItemValues(): Promise<string[][]> {
    return this.lineItemRows.evaluateAll((rows) =>
      rows.map((r) =>
        [...(r as HTMLTableRowElement).cells]
          .slice(0, -1)
          .map((c) => ((c.querySelector('input, textarea') as HTMLInputElement | null)?.value ?? (c as HTMLElement).innerText).trim()),
      ),
    );
  }

  lineItemCell(row: number, column: number): Locator {
    return this.lineItemRows.nth(row).locator('td').nth(column);
  }

  lineItemInput(row: number, column: number): Locator {
    return this.lineItemCell(row, column).locator('input, textarea');
  }

  deleteRowButton(row: number): Locator {
    return this.lineItemRows.nth(row).getByRole('button', { name: 'Delete row' });
  }

  clearRowButton(row: number): Locator {
    return this.lineItemRows.nth(row).getByRole('button', { name: 'Clear row' });
  }

  /** Opens the line-items table inside the Extracted Data panel. */
  async expandLineItemsInline(): Promise<void> {
    await this.lineItemsSectionTitle.scrollIntoViewIfNeeded();
    await this.lineItemsSectionTitle.click();
    await expect(this.inlineLineItemRows.first()).toBeVisible();
  }

  /** Clickable value of an inline line-item cell (clicking it shows its PDF page). */
  inlineLineItemValue(row: number, column: number): Locator {
    return this.inlineLineItemRows.nth(row).locator('td').nth(column).locator('div[title]').first();
  }

  /** Drags line-item row `from` onto row `to` (HTML5 drag and drop). */
  async dragRow(from: number, to: number): Promise<void> {
    await this.lineItemRows.nth(from).dragTo(this.lineItemRows.nth(to));
  }
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
