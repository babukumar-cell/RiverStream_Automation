import { Page, Locator, Download, expect } from '@playwright/test';
import { BasePage } from './base.page';

export type KpiName = 'Total Documents' | 'Pending Review' | 'Processing' | 'Reviewed';
export const KpiNames: readonly KpiName[] = ['Total Documents', 'Pending Review', 'Processing', 'Reviewed'];

/** Response of GET /api/dashboard (drives the KPI cards). */
export interface DashboardStats {
  processing: number;
  extracted: number;
  reviewed: number;
  failed: number;
  total: number;
  avgConfidence: number;
  avgProcessingTime: number;
}

/**
 * Dashboard (/dashboard): organization / date-range filters, KPI cards (rendered as tabs),
 * the document table of the selected KPI, document-type / file-format filters and Export.
 */
export class DashboardPage extends BasePage {
  // Filters
  readonly orgCombobox: Locator;
  readonly orgListbox: Locator;
  readonly orgOptions: Locator;
  readonly dateRangeButton: Locator;
  readonly dateRangeGroup: Locator;
  readonly calendar: Locator;
  readonly documentTypeButton: Locator;
  readonly fileFormatButton: Locator;
  readonly clearFiltersButton: Locator;
  readonly uploadNewFileButton: Locator;

  // KPI cards and document table
  readonly kpiTablist: Locator;
  readonly kpiTabs: Locator;
  readonly listHeading: Locator;
  readonly tabPanel: Locator;
  readonly tableHeaderCells: Locator;
  readonly tableRows: Locator;
  readonly endOfList: Locator;
  readonly hoverCard: Locator;

  // Export
  readonly exportButton: Locator;
  readonly exportMenu: Locator;
  readonly exportCsvItem: Locator;
  readonly exportXlsxItem: Locator;
  readonly exportSummary: Locator;

  constructor(page: Page) {
    super(page);

    this.orgCombobox = page.getByRole('combobox');
    this.orgListbox = page.getByRole('listbox', { name: 'Suggestions' });
    this.orgOptions = this.orgListbox.getByRole('option');
    this.dateRangeButton = page.getByRole('button', { name: /^Date range:/ });
    this.dateRangeGroup = page.getByRole('group', { name: 'Date range' });
    this.calendar = page.getByRole('grid');
    this.documentTypeButton = page.getByRole('button', { name: /^Document type/ });
    this.fileFormatButton = page.getByRole('button', { name: /^File format/ });
    this.clearFiltersButton = page.getByRole('button', { name: 'Clear', exact: true });
    this.uploadNewFileButton = page.getByRole('button', { name: 'Upload New File' });

    this.kpiTablist = page.getByRole('tablist', { name: 'Document status' });
    this.kpiTabs = this.kpiTablist.getByRole('tab');
    this.listHeading = page.getByRole('heading', { level: 2, name: /\d+ documents$/ });
    this.tabPanel = page.getByRole('tabpanel');
    this.tableHeaderCells = this.tabPanel.locator('thead').getByRole('cell');
    this.tableRows = this.tabPanel.locator('tbody').getByRole('row');
    this.endOfList = this.tabPanel.getByText('No more documents to load', { exact: true });
    this.hoverCard = page.locator('[data-slot="hover-card-content"]');

    this.exportButton = page.getByRole('button', { name: 'Export', exact: true });
    this.exportMenu = page.getByRole('menu', { name: 'Export' });
    this.exportCsvItem = this.exportMenu.getByRole('menuitem', { name: 'CSV (.csv)' });
    this.exportXlsxItem = this.exportMenu.getByRole('menuitem', { name: 'Excel (.xlsx)' });
    this.exportSummary = this.exportMenu.getByText(/^Exports these \d+ documents?$/);
  }

  async navigate(): Promise<void> {
    await this.navigateTo('/dashboard');
    await this.expectLoaded();
  }

  /** Dashboard shell, KPI cards and the first page of the document table are rendered. */
  async expectLoaded(): Promise<void> {
    await expect(this.page).toHaveURL(/\/dashboard/);
    await expect(this.kpiTablist).toBeVisible({ timeout: 30000 });
    await expect(this.listHeading).toBeVisible();
    await this.waitForLoaded();
  }

  /** Kept for specs that still call it; throws (via expect) when the dashboard is not loaded. */
  async isDashboardLoaded(): Promise<boolean> {
    await this.expectLoaded();
    return true;
  }

  async openOrgDropdown(): Promise<void> {
    await this.orgCombobox.click();
    await this.orgListbox.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  }

  // ---------- KPI cards ----------

  kpiTab(name: KpiName): Locator {
    return this.kpiTablist.getByRole('tab', { name: new RegExp(`^${name} `) });
  }

  /** Numeric value shown on a KPI card. */
  async kpiCount(name: KpiName): Promise<number> {
    const text = await this.kpiTab(name).innerText();
    const match = text.match(/^\s*[A-Za-z ]+\s+([\d,]+)/);
    if (!match) throw new Error(`No count on KPI card "${name}": ${JSON.stringify(text)}`);
    return parseInt(match[1].replace(/,/g, ''), 10);
  }

  async allKpiCounts(): Promise<Record<KpiName, number>> {
    const counts = {} as Record<KpiName, number>;
    for (const name of KpiNames) counts[name] = await this.kpiCount(name);
    return counts;
  }

  async selectKpi(name: KpiName): Promise<void> {
    await this.kpiTab(name).click();
    await expect(this.kpiTab(name)).toHaveAttribute('aria-selected', 'true');
    await expect(this.listHeading).toHaveAccessibleName(new RegExp(`^${name === 'Total Documents' ? 'All Documents' : name} \\d+ documents$`));
    await this.waitForLoaded();
  }

  /** Count in the table heading above the document list, e.g. "Pending Review 102". */
  async listHeadingCount(): Promise<number> {
    const name = (await this.listHeading.textContent()) || '';
    const match = name.match(/(\d[\d,]*)\s*$/);
    if (!match) throw new Error(`No count in list heading: ${JSON.stringify(name)}`);
    return parseInt(match[1].replace(/,/g, ''), 10);
  }

  // ---------- Document table ----------

  /**
   * Scroll the infinite-scroll table until "No more documents to load" appears.
   * Returns the number of rows rendered.
   */
  async loadAllRows(maxPages: number = 40): Promise<number> {
    await this.waitForLoaded();
    for (let i = 0; i < maxPages; i++) {
      if (await this.endOfList.isVisible()) return this.tableRows.count();
      const before = await this.tableRows.count();
      if (before === 0) {
        await expect(this.endOfList.or(this.tabPanel.getByText(/^No documents/i))).toBeVisible();
        return 0;
      }
      await this.tableRows.last().scrollIntoViewIfNeeded();
      await expect
        .poll(async () => (await this.endOfList.isVisible()) || (await this.tableRows.count()) > before, {
          message: 'next page of documents to load',
          timeout: 20000,
        })
        .toBe(true);
    }
    throw new Error(`Document table did not reach its end after ${maxPages} pages`);
  }

  /** Text of one column for every rendered row (column located by its header label). */
  async columnValues(header: 'Document Name' | 'Customer' | 'Uploaded By' | 'Upload Date' | 'Status'): Promise<string[]> {
    const headers = (await this.tableHeaderCells.allInnerTexts()).map(h => h.trim().toLowerCase());
    const index = headers.indexOf(header.toLowerCase());
    if (index < 0) throw new Error(`Column "${header}" not found in ${JSON.stringify(headers)}`);
    return this.tableRows.evaluateAll(
      (rows, i) => rows.map(r => ((r as HTMLTableRowElement).cells[i]?.innerText || '').trim()),
      index,
    );
  }

  uploadedByTrigger(row: Locator): Locator {
    return row.locator('[data-slot="hover-card-trigger"]');
  }

  // ---------- Filters ----------

  orgOption(name: string): Locator {
    return this.orgListbox.getByRole('option', { name, exact: true });
  }

  async selectOrganization(name: string): Promise<void> {
    await this.orgCombobox.click();
    await this.orgOption(name).click();
    await expect(this.orgCombobox).toHaveText(name);
    await this.waitForLoaded();
  }

  dateRangePreset(label: string): Locator {
    return this.dateRangeGroup.getByRole('button', { name: new RegExp(`^${label}`) });
  }

  async selectDateRange(label: 'All time' | 'This week' | 'Last week' | 'This month' | 'Last month'): Promise<void> {
    await this.dateRangeButton.click();
    await this.dateRangePreset(label).click();
    await expect(this.dateRangeButton).toHaveAccessibleName(`Date range: ${label}`);
    await this.page.keyboard.press('Escape');
    await this.waitForLoaded();
  }

  /** Day button in the open calendar, e.g. calendarDay(/October 1st, 2026$/). */
  calendarDay(name: RegExp): Locator {
    return this.calendar.getByRole('button', { name });
  }

  documentTypeOption(name: 'All document types' | 'Purchase order' | 'Quote request'): Locator {
    return this.page.getByRole('menuitemradio', { name, exact: true });
  }

  async selectDocumentType(name: 'All document types' | 'Purchase order' | 'Quote request'): Promise<void> {
    await this.documentTypeButton.click();
    await this.documentTypeOption(name).click();
    await this.waitForLoaded();
  }

  fileFormatOption(format: 'PDF' | 'XLS' | 'XLSX' | 'EDI' | 'SIF'): Locator {
    return this.page.getByRole('menuitemcheckbox', { name: `${format} .${format.toLowerCase()}`, exact: true });
  }

  /** Tick the given file formats (multi-select menu) and close the menu. */
  async selectFileFormats(...formats: Array<'PDF' | 'XLS' | 'XLSX' | 'EDI' | 'SIF'>): Promise<void> {
    await this.fileFormatButton.click();
    for (const format of formats) {
      await this.fileFormatOption(format).click();
      await expect(this.fileFormatOption(format)).toHaveAttribute('aria-checked', 'true');
    }
    await this.page.keyboard.press('Escape');
    await this.waitForLoaded();
  }

  // ---------- Export ----------

  async openExportMenu(): Promise<void> {
    await this.exportButton.click();
    await expect(this.exportMenu).toBeVisible();
  }

  /** Number in "Exports these N documents" (export menu must be open). */
  async exportSummaryCount(): Promise<number> {
    const text = (await this.exportSummary.textContent()) || '';
    return parseInt(text.replace(/\D+/g, ''), 10);
  }

  async exportAs(format: 'csv' | 'xlsx'): Promise<Download> {
    if (!(await this.exportMenu.isVisible())) await this.openExportMenu();
    const item = format === 'csv' ? this.exportCsvItem : this.exportXlsxItem;
    const [download] = await Promise.all([this.page.waitForEvent('download'), item.click()]);
    return download;
  }

  // ---------- Backend reference data ----------

  /** Wait for the next /api/dashboard response (KPI source) and return its JSON. */
  async waitForStatsResponse(): Promise<DashboardStats> {
    const response = await this.page.waitForResponse(
      r => /\/api\/dashboard(\?|$)/.test(r.url()) && r.request().method() === 'GET' && r.ok(),
    );
    return (await response.json()) as DashboardStats;
  }
}
