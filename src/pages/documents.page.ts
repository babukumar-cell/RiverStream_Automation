import { Page, Locator, Response, expect } from '@playwright/test';
import { BasePage } from './base.page';

export type FileFormat = 'PDF' | 'XLS' | 'XLSX' | 'EDI' | 'SIF';
export type DocumentTypeFilter = 'Purchase order' | 'Quote request';

/** Every status label the Document Library can show (document insertion statuses). */
export const DOCUMENT_STATUSES = [
  'Processing',
  'Extracted',
  'Extraction Failed',
  'Success',
  'Partially Success',
  'Failed',
  'Reviewed',
] as const;

/** One document entity as returned by POST /api/listDocumentsLibrary */
export interface LibraryDocument {
  _id: string;
  fileName: string;
  selectedDocType: string;
  status: string;
  createdAt: string;
  userName: string;
  userEmail: string;
  organizationName: string;
  extractedData?: { customer_name?: { value: string | null } };
}

/** A captured listDocumentsLibrary call: what the page asked for and what it got back */
export interface LibraryPage {
  request: {
    startIndex: number;
    pageSize: number;
    search_text: string | null;
    organizationName: string | null;
    fileTypeFilter?: string[];
    docTypeFilter?: string[];
    createdFrom?: string;
    createdBefore?: string;
  };
  documents: LibraryDocument[];
  totalCount: number;
  hasMore: boolean;
}

/** API value sent for each Document type filter button */
export const DOC_TYPE_FILTER_VALUE: Record<DocumentTypeFilter, string> = {
  'Purchase order': 'PURCHASE_ORDER',
  'Quote request': 'QUOTE_REQUEST',
};

const LIST_ENDPOINT = '/api/listDocumentsLibrary';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * Documents page (/documents): Document Library table with org selector, search,
 * collapsible filter panel (file format, document type, upload date), and infinite scroll.
 */
export class DocumentsPage extends BasePage {
  readonly pageHeading: Locator;
  readonly orgDropdown: Locator;
  readonly uploadNewFileButton: Locator;
  readonly searchInput: Locator;

  // Filter summary bar
  readonly filtersButton: Locator;
  readonly activeFilterBadge: Locator;
  readonly expandFiltersButton: Locator;
  readonly collapseFiltersButton: Locator;
  readonly formatSummary: Locator;
  readonly typeSummary: Locator;
  readonly dateSummary: Locator;

  // Filter panel
  readonly fileFormatHeading: Locator;
  readonly allFormatsFilterBtn: Locator;
  readonly allDocumentTypesBtn: Locator;
  readonly dateRangeButton: Locator;
  readonly calendar: Locator;
  readonly calendarCaption: Locator;
  readonly previousMonthButton: Locator;
  readonly nextMonthButton: Locator;
  readonly applyFiltersBtn: Locator;
  readonly clearFiltersBtn: Locator;

  // Table
  readonly table: Locator;
  readonly tableHeaders: Locator;
  readonly dataRows: Locator;
  readonly loadingRow: Locator;
  readonly noMoreDocumentsText: Locator;
  readonly emptyStateMessage: Locator;
  readonly scrollContainer: Locator;
  readonly uploadedByHoverCard: Locator;

  constructor(page: Page) {
    super(page);

    this.pageHeading = page.getByRole('heading', { name: 'Document Library' });
    this.orgDropdown = page.getByRole('combobox');
    this.uploadNewFileButton = page.getByRole('button', { name: 'Upload New File' });
    this.searchInput = page.getByPlaceholder('Search documents...');

    this.filtersButton = page.getByRole('button', { name: /^Filters\s*\d*$/ });
    this.activeFilterBadge = this.filtersButton.locator('span');
    this.expandFiltersButton = page.getByRole('button', { name: 'Click to expand' });
    this.collapseFiltersButton = page.getByRole('button', { name: 'Click to collapse' });
    this.formatSummary = page.getByText(/^Format:/);
    this.typeSummary = page.getByText(/^Type:/);
    this.dateSummary = page.getByText(/^Date:/);

    this.fileFormatHeading = page.getByRole('heading', { name: 'File format' });
    this.allFormatsFilterBtn = this.formatButton('All formats');
    this.allDocumentTypesBtn = this.documentTypeButton('All document types');
    this.dateRangeButton = page.getByRole('heading', { name: 'Upload date' }).locator('xpath=following-sibling::*[1]').getByRole('button');
    this.calendar = page.getByRole('dialog').getByRole('grid');
    this.calendarCaption = page.getByRole('dialog').getByRole('status');
    this.previousMonthButton = page.getByRole('button', { name: 'Go to the Previous Month' });
    this.nextMonthButton = page.getByRole('button', { name: 'Go to the Next Month' });
    this.applyFiltersBtn = page.getByRole('button', { name: 'Apply Active Filters' });
    this.clearFiltersBtn = page.getByRole('button', { name: 'Clear all filters' });

    this.table = page.locator('table');
    this.tableHeaders = page.locator('table thead th, table thead [role="columnheader"], table thead td');
    // Data rows have all six cells; status rows ("Loading documents...", "No more documents to load") have one.
    this.dataRows = this.table.locator('tbody tr').filter({ has: page.locator('td:nth-child(6)') });
    this.loadingRow = this.table.getByText('Loading documents...');
    this.noMoreDocumentsText = this.table.getByText('No more documents to load');
    this.emptyStateMessage = this.table.getByText(/^No documents (found|match)/i);
    this.scrollContainer = this.table.locator('xpath=ancestor::div[contains(@class,"overflow-y-auto")][1]');
    this.uploadedByHoverCard = page.locator('[data-slot="hover-card-content"]');
  }

  formatButton(label: FileFormat | 'All formats'): Locator {
    return this.fileFormatHeading.locator('xpath=following-sibling::div[1]').getByRole('button', { name: label, exact: true });
  }

  documentTypeButton(label: DocumentTypeFilter | 'All document types'): Locator {
    return this.page.getByRole('heading', { name: 'Document type' }).locator('xpath=following-sibling::div[1]').getByRole('button', { name: label, exact: true });
  }

  /** Data row whose Document Name cell is exactly `fileName` */
  rowByName(fileName: string): Locator {
    return this.dataRows.filter({ has: this.page.getByText(fileName, { exact: true }) });
  }

  // Column cells (the table has no per-cell anchors, so cells are addressed by column position).
  nameCell(row: Locator): Locator { return row.locator('td').nth(0); }
  customerCell(row: Locator): Locator { return row.locator('td').nth(1); }
  uploadedByTrigger(row: Locator): Locator { return row.locator('td').nth(2).locator('[data-slot="hover-card-trigger"]'); }
  uploadDateCell(row: Locator): Locator { return row.locator('td').nth(3); }
  statusBadge(row: Locator): Locator { return row.locator('td').nth(4).locator('span').first(); }
  reviewButton(row: Locator): Locator { return row.getByRole('button', { name: 'Review', exact: true }); }
  reExtractButton(row: Locator): Locator { return row.getByRole('button', { name: 'Re-Extract', exact: true }); }

  static isListRequest(response: Response): boolean {
    return response.url().includes(LIST_ENDPOINT) && response.request().method() === 'POST';
  }

  /** Waits for the next listDocumentsLibrary response matching `predicate` (applied to the request body). */
  async waitForListResponse(predicate: (req: LibraryPage['request']) => boolean = () => true): Promise<LibraryPage> {
    const response = await this.page.waitForResponse(
      r => DocumentsPage.isListRequest(r) && predicate(r.request().postDataJSON() || {}),
      { timeout: 30000 },
    );
    return DocumentsPage.parseListResponse(response);
  }

  static async parseListResponse(response: Response): Promise<LibraryPage> {
    expect(response.status(), `listDocumentsLibrary HTTP status`).toBe(200);
    const json = await response.json();
    return {
      request: response.request().postDataJSON(),
      documents: json.documents.entities,
      totalCount: json.documents.totalCount,
      hasMore: json.documents.hasMore,
    };
  }

  /**
   * Starts recording every listDocumentsLibrary response (initial load, scroll pages, filters).
   * Call the returned function to get the unique documents seen so far, keyed by _id.
   */
  trackListResponses(): () => Promise<LibraryDocument[]> {
    const pending: Promise<LibraryPage>[] = [];
    this.page.on('response', response => {
      if (DocumentsPage.isListRequest(response)) pending.push(DocumentsPage.parseListResponse(response));
    });
    return async () => {
      const byId = new Map<string, LibraryDocument>();
      for (const result of await Promise.all(pending)) {
        for (const doc of result.documents) byId.set(doc._id, doc);
      }
      return [...byId.values()];
    };
  }

  /** Status and action text of every rendered row, read in one pass so polling cannot interleave. */
  async getRowStatusesAndActions(): Promise<Array<{ name: string; status: string; action: string }>> {
    return this.dataRows.evaluateAll(rows => rows.map(row => {
      const cells = row.querySelectorAll('td');
      const text = (i: number) => ((cells[i] as HTMLElement).innerText || '').trim();
      return { name: text(0), status: text(4), action: text(5) };
    }));
  }

  /** Opens /documents and returns the first page of documents the table rendered. */
  async navigate(): Promise<LibraryPage> {
    const firstPage = this.waitForListResponse(req => req.startIndex === 0);
    await this.navigateTo('/documents');
    const result = await firstPage;
    await this.waitForTableLoaded();
    return result;
  }

  async waitForTableLoaded(): Promise<void> {
    await expect(this.loadingRow).toHaveCount(0, { timeout: 20000 });
    await expect(this.dataRows.first().or(this.noMoreDocumentsText).or(this.emptyStateMessage)).toBeVisible();
  }

  async expandFilters(): Promise<void> {
    await expect(this.expandFiltersButton.or(this.collapseFiltersButton)).toBeVisible();
    if (await this.expandFiltersButton.isVisible()) {
      await this.expandFiltersButton.click();
    }
    await expect(this.fileFormatHeading).toBeVisible();
  }

  /**
   * Clicks "Apply Active Filters" and returns the refreshed first page. The table also re-polls
   * while documents are processing, so pass `predicate` to pick the response for the new filters.
   */
  async applyFilters(predicate: (req: LibraryPage['request']) => boolean = () => true): Promise<LibraryPage> {
    const refreshed = this.waitForListResponse(req => req.startIndex === 0 && predicate(req));
    await this.applyFiltersBtn.click();
    const result = await refreshed;
    await this.waitForTableLoaded();
    return result;
  }

  async filterByFormat(format: FileFormat | 'All formats'): Promise<LibraryPage> {
    await this.expandFilters();
    await this.formatButton(format).click();
    return this.applyFilters(req =>
      format === 'All formats' ? !req.fileTypeFilter?.length : !!req.fileTypeFilter?.includes(format));
  }

  async filterByDocumentType(type: DocumentTypeFilter | 'All document types'): Promise<LibraryPage> {
    await this.expandFilters();
    await this.documentTypeButton(type).click();
    return this.applyFilters(req =>
      type === 'All document types' ? !req.docTypeFilter?.length : !!req.docTypeFilter?.includes(DOC_TYPE_FILTER_VALUE[type]));
  }

  async clearAllFilters(): Promise<LibraryPage> {
    await this.expandFilters();
    const refreshed = this.waitForListResponse(req =>
      req.startIndex === 0 && !req.fileTypeFilter?.length && !req.docTypeFilter?.length && !req.createdFrom);
    await this.clearFiltersBtn.click();
    const result = await refreshed;
    await this.waitForTableLoaded();
    return result;
  }

  /** Calendar day button, e.g. aria-label "Wednesday, October 21st, 2026" (today is prefixed "Today, ") */
  calendarDay(date: Date): Locator {
    const label = `${MONTHS[date.getMonth()]} ${date.getDate()}(st|nd|rd|th), ${date.getFullYear()}$`;
    return this.calendar.getByRole('button', { name: new RegExp(label) });
  }

  private async showCalendarMonth(date: Date): Promise<void> {
    const target = `${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
    for (let i = 0; i < 24; i++) {
      const caption = (await this.calendarCaption.innerText()).trim();
      if (caption === target) return;
      const [month, year] = caption.split(' ');
      const shown = Number(year) * 12 + MONTHS.indexOf(month);
      const wanted = date.getFullYear() * 12 + date.getMonth();
      await (wanted < shown ? this.previousMonthButton : this.nextMonthButton).click();
    }
    throw new Error(`Calendar never showed ${target}`);
  }

  /** Opens the Upload date calendar and selects the inclusive range [from, to] (does not apply). */
  async selectDateRange(from: Date, to: Date): Promise<void> {
    await this.expandFilters();
    await this.dateRangeButton.click();
    await expect(this.calendar).toBeVisible();
    await this.showCalendarMonth(from);
    await this.calendarDay(from).click();
    await this.showCalendarMonth(to);
    await this.calendarDay(to).click();
    await this.page.keyboard.press('Escape');
    await expect(this.calendar).toBeHidden();
  }

  /** Selects an organization in the header dropdown and returns the refreshed first page. */
  async selectOrganization(orgName: string): Promise<LibraryPage> {
    const refreshed = this.waitForListResponse(req =>
      req.startIndex === 0 && (req.organizationName || '').toLowerCase() === orgName.toLowerCase());
    await this.orgDropdown.click();
    await this.page.getByRole('option', { name: orgName, exact: true }).click();
    const result = await refreshed;
    await this.waitForTableLoaded();
    return result;
  }

  /** Types into the search box and returns the list response for exactly that search text. */
  async searchDocument(term: string): Promise<LibraryPage> {
    const refreshed = this.waitForListResponse(req => req.search_text === term && req.startIndex === 0);
    await this.searchInput.fill(term);
    const result = await refreshed;
    await this.waitForTableLoaded();
    return result;
  }

  async getVisibleDocumentNames(): Promise<string[]> {
    return (await this.dataRows.locator('td:nth-child(1)').allInnerTexts()).map(t => t.trim());
  }

  async getVisibleStatuses(): Promise<string[]> {
    return (await this.dataRows.locator('td:nth-child(5)').allInnerTexts()).map(t => t.trim());
  }

  async getVisibleUploadDates(): Promise<string[]> {
    return (await this.dataRows.locator('td:nth-child(4)').allInnerTexts()).map(t => t.trim());
  }

  /**
   * Scrolls the table container until at least `minRows` data rows are rendered or the
   * "No more documents to load" marker appears. Returns the rendered data-row count.
   */
  async loadRows(minRows: number, timeout: number = 90000): Promise<number> {
    await expect(async () => {
      await this.scrollContainer.evaluate(el => { el.scrollTop = el.scrollHeight; });
      const reachedEnd = await this.noMoreDocumentsText.isVisible();
      expect(reachedEnd || (await this.dataRows.count()) >= minRows).toBe(true);
    }).toPass({ timeout, intervals: [500, 1000, 1500] });
    return this.dataRows.count();
  }

  /** Scrolls until the "No more documents to load" marker appears. Returns the rendered data-row count. */
  async scrollToEnd(timeout: number = 120000): Promise<number> {
    await expect(async () => {
      await this.scrollContainer.evaluate(el => { el.scrollTop = el.scrollHeight; });
      await expect(this.noMoreDocumentsText).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout, intervals: [250, 500, 1000] });
    return this.dataRows.count();
  }

  /** Scrolls until a row matching `row` is rendered or the list ends. Returns whether it was found. */
  async scrollUntilVisible(row: Locator, timeout: number = 120000): Promise<boolean> {
    await expect(async () => {
      if ((await row.count()) > 0) return;
      await this.scrollContainer.evaluate(el => { el.scrollTop = el.scrollHeight; });
      expect((await row.count()) > 0 || (await this.noMoreDocumentsText.isVisible())).toBe(true);
    }).toPass({ timeout, intervals: [500, 1000, 1500] });
    return (await row.count()) > 0;
  }

  /** Text colour of an element as [r, g, b] (Chrome reports Tailwind colours as lab(), so convert via canvas). */
  async textColorRgb(locator: Locator): Promise<[number, number, number]> {
    return locator.evaluate(el => {
      const ctx = document.createElement('canvas').getContext('2d')!;
      ctx.fillStyle = getComputedStyle(el).color;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      return [r, g, b] as [number, number, number];
    });
  }

  /** Formats an ISO timestamp the way the table does ("Oct 21, 2026"), in the browser's time zone. */
  async formatUploadDate(iso: string): Promise<string> {
    return this.page.evaluate(
      value => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      iso,
    );
  }

  // Convenience aliases and helpers for test suites
  get docTypeHeading(): Locator {
    return this.page.getByRole('heading', { name: 'Document type' });
  }

  get docTypeSection(): Locator {
    return this.docTypeHeading.locator('xpath=ancestor::div[1]');
  }

  get fileFormatSection(): Locator {
    return this.fileFormatHeading.locator('xpath=ancestor::div[1]');
  }

  get uploadDateSection(): Locator {
    return this.page.getByRole('heading', { name: 'Upload date' }).locator('xpath=ancestor::div[1]');
  }

  get clearAllFiltersButton(): Locator {
    return this.clearFiltersBtn;
  }

  get filtersPanel(): Locator {
    return this.fileFormatHeading.locator('xpath=ancestor::div[contains(@class,"border") or contains(@class,"rounded")][1]');
  }

  get filterSummaryPill(): Locator {
    return this.activeFilterBadge;
  }

  get tableHeaderCells(): Locator {
    return this.tableHeaders;
  }

  async collapseFilters(): Promise<void> {
    if (await this.collapseFiltersButton.isVisible()) {
      await this.collapseFiltersButton.click();
    }
  }

  async search(term: string): Promise<LibraryPage> {
    return this.searchDocument(term);
  }

  async filterByDocType(type: string): Promise<LibraryPage> {
    const normalized: DocumentTypeFilter = (type.toLowerCase().includes('purchase') ? 'Purchase order' : 'Quote request');
    return this.filterByDocumentType(normalized);
  }

  async openReview(indexOrRow: number | Locator = 0): Promise<void> {
    const row = typeof indexOrRow === 'number' ? this.dataRows.nth(indexOrRow) : indexOrRow;
    await this.reviewButton(row).click();
  }
}
