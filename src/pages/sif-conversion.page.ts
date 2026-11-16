import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './base.page';

export type SifTab = 'All' | 'Ready for review' | 'Extracting' | 'Reviewed' | 'Converted' | 'Failed';
export const SIF_TABS: SifTab[] = ['All', 'Ready for review', 'Extracting', 'Reviewed', 'Converted', 'Failed'];
export type SifDocType = 'Purchase Order' | 'Quote Request';
/** Columns of the file table for an organization user; the Super Admin also has "Organization" after "File" */
export const SIF_COLUMNS = ['File', 'Type', 'Status', 'Template', 'Line items', 'Uploaded by', 'Uploaded'];
export const SIF_COLUMNS_SUPER_ADMIN = ['File', 'Organization', ...SIF_COLUMNS.slice(1)];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Confirmation dialogs of the SIF pages ("Delete conversion", "Re-run extraction") */
function confirmDialog(page: Page): Locator {
  return page.getByRole('alertdialog').or(page.getByRole('dialog')).first();
}

/** SIF Conversion list (/sif-conversion) */
export class SifListPage extends BasePage {
  readonly main: Locator;
  readonly title: Locator;
  readonly subtitle: Locator;
  readonly newConversionButton: Locator;
  readonly searchInput: Locator;
  readonly docTypeFilter: Locator;
  readonly templateFilter: Locator;
  readonly uploaderFilter: Locator;
  readonly table: Locator;
  readonly headers: Locator;
  readonly rows: Locator;
  readonly emptyMessage: Locator;
  readonly notEnabledMessage: Locator;
  readonly dialog: Locator;
  readonly columns: string[];

  /** `superAdmin`: the Super Admin's table has an extra Organization column */
  constructor(page: Page, { superAdmin = false }: { superAdmin?: boolean } = {}) {
    super(page);
    this.columns = superAdmin ? SIF_COLUMNS_SUPER_ADMIN : SIF_COLUMNS;
    // The app shell is a <main> too: the SIF page is the innermost one
    this.main = page.getByRole('main').last();
    this.title = this.main.getByText('SIF Conversion', { exact: true }).first();
    this.subtitle = this.main.getByText(/^Convert quote request and purchase order PDFs into SIF files/);
    this.newConversionButton = this.main.getByRole('button', { name: 'New conversion' });
    this.searchInput = this.main.getByPlaceholder('Search by file name');
    const combos = this.main.getByRole('combobox');
    this.docTypeFilter = combos.nth(0);
    this.templateFilter = combos.nth(1);
    this.uploaderFilter = combos.nth(2);
    this.table = this.main.locator('table');
    this.headers = this.table.locator('thead th');
    this.rows = this.table.locator('tbody tr').filter({ has: page.locator('td:nth-child(4)') });
    this.emptyMessage = this.main.getByText('No conversions match these filters.', { exact: true });
    this.notEnabledMessage = this.main.getByText('SIF Conversion is not enabled for this organization.', { exact: true });
    this.dialog = confirmDialog(page);
  }

  tab(name: SifTab): Locator {
    return this.main.locator('button').filter({ hasText: new RegExp(`^\\s*${escapeRe(name)}\\s*\\d+\\s*$`) });
  }

  async tabCount(name: SifTab): Promise<number> {
    return Number((await this.tab(name).innerText()).match(/(\d+)\s*$/)![1]);
  }

  async goto(): Promise<void> {
    await this.navigateTo('/sif-conversion');
    await this.waitForList();
  }

  /** Tab counts and the first page of rows (or the empty message) are rendered */
  async waitForList(): Promise<void> {
    await expect(this.tab('All')).toBeVisible({ timeout: 30000 });
    await expect(this.rows.first().or(this.emptyMessage).or(this.notEnabledMessage)).toBeVisible({ timeout: 30000 });
    await expect(this.main.getByText(/^Loading/)).toHaveCount(0, { timeout: 30000 });
  }

  /** Waits for the list request that follows a filter / tab / search change */
  private listResponse() {
    return this.page.waitForResponse((r) => /\/api\/listSifConversions\b/.test(r.url()), { timeout: 30000 }).catch(() => undefined);
  }

  async openTab(name: SifTab): Promise<void> {
    const res = this.listResponse();
    await this.tab(name).click();
    await res;
    await this.waitForList();
  }

  async search(text: string): Promise<void> {
    const res = this.listResponse();
    await this.searchInput.fill(text);
    await res;
    await this.page.waitForTimeout(500); // debounce: the list request is sent after typing stops
    await this.waitForList();
  }

  async openFilter(filter: Locator): Promise<Locator> {
    await filter.click();
    const listbox = this.page.getByRole('listbox');
    await expect(listbox).toBeVisible();
    return listbox;
  }

  async selectFilter(filter: Locator, option: string): Promise<void> {
    await this.openFilter(filter);
    const res = this.listResponse();
    await this.page.getByRole('option', { name: option, exact: true }).click();
    await res;
    await expect(filter).toHaveText(option);
    await this.waitForList();
  }

  /** The list loads 10 rows at a time: scrolls until every row is loaded (count stops growing) */
  async loadAllRows(): Promise<number> {
    await this.waitForList();
    // no table when nothing matches the filters ("No conversions match these filters.")
    if ((await this.table.count()) === 0) return 0;
    let previous = -1;
    let stable = 0;
    for (let i = 0; i < 60 && stable < 3; i++) {
      const count = await this.rows.count();
      if (count === previous) stable++;
      else stable = 0;
      previous = count;
      if (count) await this.rows.last().scrollIntoViewIfNeeded();
      await this.table.evaluate((t) => {
        let el: HTMLElement | null = t as HTMLElement;
        while (el) {
          if (el.scrollHeight > el.clientHeight + 4) el.scrollTop = el.scrollHeight;
          el = el.parentElement;
        }
      });
      await this.page.waitForTimeout(700);
    }
    return this.rows.count();
  }

  row(fileName: string): Locator {
    return this.rows.filter({ has: this.page.getByText(fileName, { exact: true }) });
  }

  /** Cell of a column (by header name) */
  cell(row: Locator, column: string): Locator {
    const index = this.columns.indexOf(column);
    if (index < 0) throw new Error(`No "${column}" column in the SIF table (${this.columns.join(', ')})`);
    return row.locator('td').nth(index);
  }

  fileCell(row: Locator): Locator {
    return this.cell(row, 'File');
  }
  typeCell(row: Locator): Locator {
    return this.cell(row, 'Type');
  }
  statusBadge(row: Locator): Locator {
    return this.cell(row, 'Status').locator('span.rounded-full, div.rounded-full').first();
  }
  templateCell(row: Locator): Locator {
    return this.cell(row, 'Template');
  }
  lineItemsCell(row: Locator): Locator {
    return this.cell(row, 'Line items');
  }
  uploadedByCell(row: Locator): Locator {
    return this.cell(row, 'Uploaded by');
  }
  kebab(row: Locator): Locator {
    return row.locator('button[data-slot="dropdown-menu-trigger"]');
  }
  menuItem(name: string): Locator {
    return this.page.getByRole('menuitem', { name, exact: true });
  }

  async openMenu(row: Locator): Promise<void> {
    await this.kebab(row).click();
    await expect(this.page.getByRole('menu')).toBeVisible();
  }

  /** Reloads the list until the file shows the status (extraction runs in the background) */
  async waitForStatus(fileName: string, status: RegExp, timeout = 180000): Promise<void> {
    await expect(async () => {
      await this.goto();
      await this.search(fileName);
      await expect(this.statusBadge(this.row(fileName))).toHaveText(status, { timeout: 3000 });
    }).toPass({ timeout, intervals: [3000, 5000, 5000, 10000] });
  }

  /** Text of a column for every loaded row */
  async columnTexts(cell: (row: Locator) => Locator): Promise<string[]> {
    const n = await this.rows.count();
    const out: string[] = [];
    for (let i = 0; i < n; i++) out.push((await cell(this.rows.nth(i)).innerText()).replace(/\s+/g, ' ').trim());
    return out;
  }
}

/** New conversion page (/sif-conversion/upload) */
export class SifUploadPage extends BasePage {
  readonly main: Locator;
  readonly heading: Locator;
  readonly subtitle: Locator;
  readonly docTypeSelect: Locator;
  readonly templateSelect: Locator;
  readonly previewFieldsButton: Locator;
  readonly dropZone: Locator;
  readonly chooseFileButton: Locator;
  readonly acceptedText: Locator;
  readonly fileInput: Locator;
  readonly removeFileButton: Locator;
  readonly uploadButton: Locator;
  readonly backLink: Locator;
  readonly previewDialog: Locator;

  constructor(page: Page) {
    super(page);
    this.main = page.getByRole('main').last();
    this.heading = this.main.getByText('Convert a PDF to SIF', { exact: true });
    this.subtitle = this.main.getByText(/^Our AI extracts the fields of the template you choose/);
    const combos = this.main.getByRole('combobox');
    this.docTypeSelect = combos.nth(0);
    this.templateSelect = combos.nth(1);
    this.previewFieldsButton = this.main.getByRole('button', { name: 'Preview fields' });
    this.dropZone = this.main.locator('div.border-dashed').filter({ hasText: /Drag and drop your PDF here|Remove File/ }).first();
    this.chooseFileButton = this.main.getByRole('button', { name: 'Choose File' });
    this.acceptedText = this.main.getByText('Accepted format: PDF · Max file size: 25MB', { exact: true });
    this.fileInput = page.locator('input[type="file"]');
    this.removeFileButton = this.main.getByRole('button', { name: 'Remove File' });
    this.uploadButton = this.main.getByRole('button', { name: 'Upload and Extract' });
    this.backLink = page.getByText('Back to SIF Conversion', { exact: true });
    this.previewDialog = page.getByRole('dialog');
    this.previewTitle = this.previewDialog.getByRole('heading').first();
  }

  readonly previewTitle: Locator;

  async goto(): Promise<void> {
    await this.navigateTo('/sif-conversion/upload');
    await this.waitForReady();
  }

  /** The page is interactive once its form is rendered and the client-side navigation has settled */
  async waitForReady(): Promise<void> {
    await this.page.waitForURL(/\/sif-conversion\/upload$/);
    await expect(this.heading).toBeVisible({ timeout: 30000 });
    await expect(this.docTypeSelect).toBeEnabled({ timeout: 30000 });
    await this.page.waitForLoadState('networkidle').catch(() => undefined);
  }

  /** Message shown in the upload area ("Only PDF files can be converted.", ...) */
  message(text: string): Locator {
    return this.main.getByText(text, { exact: true });
  }

  /**
   * Selects the document type and waits for its default template. Retried: a selection made while the page
   * is still settling after a client-side navigation can be reset to "Choose a document type".
   */
  async selectDocType(type: SifDocType): Promise<void> {
    const defaultTemplate = type === 'Purchase Order' ? 'Default PO' : 'Default QR';
    await expect(async () => {
      if ((await this.docTypeSelect.innerText()).trim() !== type) {
        await this.page.keyboard.press('Escape');
        await this.docTypeSelect.click();
        await this.page.getByRole('option', { name: type, exact: true }).click({ timeout: 5000 });
      }
      await expect(this.docTypeSelect).toHaveText(type, { timeout: 2000 });
      await expect(this.templateSelect).toHaveText(defaultTemplate, { timeout: 15000 });
      await this.page.waitForTimeout(500);
      await expect(this.docTypeSelect).toHaveText(type, { timeout: 1000 });
    }).toPass({ timeout: 60000 });
    await expect(this.templateSelect).toBeEnabled();
  }

  async selectTemplate(name: string): Promise<void> {
    await this.templateSelect.click();
    await this.page.getByRole('option', { name, exact: true }).click();
    await expect(this.templateSelect).toHaveText(name);
  }

  async openTemplates(): Promise<Locator> {
    await this.templateSelect.click();
    const listbox = this.page.getByRole('listbox');
    await expect(listbox).toBeVisible();
    return listbox;
  }

  async chooseFile(file: string): Promise<void> {
    await this.fileInput.setInputFiles(file);
  }

  /** Clicks Upload and Extract; resolves with the conversion id once the list page is shown */
  async uploadAndExtract(uploadTimeout = 180000): Promise<string> {
    await expect(this.uploadButton, 'Upload and Extract is enabled (document type and file chosen)').toBeEnabled({ timeout: 30000 });
    const uploaded = this.page.waitForResponse((r) => /\/api\/sifConversionUpload\b/.test(r.url()) && r.request().method() === 'POST', { timeout: uploadTimeout });
    await this.uploadButton.click();
    const res = await uploaded;
    expect(res.status(), 'sifConversionUpload API status').toBe(200);
    // the body of a large upload's response can be evicted before it is read: the id is then unknown
    const id = ((await res.json().catch(() => ({}))) as { id?: string }).id ?? '';
    await this.page.waitForURL(/\/sif-conversion$/, { timeout: 60000 });
    return id;
  }

  async openPreview(): Promise<void> {
    await this.previewFieldsButton.click();
    await expect(this.previewDialog).toBeVisible();
  }

  /** Row of the Preview fields table for a field label (required fields end with "*") */
  previewRow(label: string): Locator {
    return this.previewDialog.locator('tbody tr').filter({ has: this.page.locator('td:first-child', { hasText: new RegExp(`^\\s*${escapeRe(label)}\\s*\\*?\\s*$`) }) });
  }
}

/** Review page of a conversion (/sif-conversion/<id>) */
export class SifReviewPage extends BasePage {
  readonly main: Locator;
  readonly backButton: Locator;
  readonly subtitle: Locator;
  readonly saveButton: Locator;
  readonly convertButton: Locator;
  readonly extractedTab: Locator;
  readonly jsonTab: Locator;
  readonly panel: Locator;
  readonly productLinesTitle: Locator;
  readonly rowsSummary: Locator;
  readonly lineTable: Locator;
  readonly lineRows: Locator;
  readonly editingRow: Locator;
  readonly newRowButton: Locator;
  readonly jsonBlock: Locator;
  readonly toasts: Locator;

  constructor(page: Page) {
    super(page);
    this.main = page.getByRole('main').last();
    this.backButton = this.main.getByRole('button', { name: 'Back', exact: true });
    this.subtitle = this.main.getByText(/^(Purchase Order|Quote Request) · Template: /);
    this.saveButton = this.main.getByRole('button', { name: 'Save', exact: true });
    this.convertButton = this.main.getByRole('button', { name: 'Convert to SIF', exact: true });
    this.extractedTab = page.getByRole('tab', { name: 'Extracted Data' });
    this.jsonTab = page.getByRole('tab', { name: 'JSON View' });
    this.panel = page.getByRole('tabpanel').first();
    this.productLinesTitle = this.panel.getByText('Product Lines', { exact: true });
    this.rowsSummary = this.panel.getByText(/^Table with \d+ rows?$/);
    this.lineTable = this.panel.locator('table');
    // data rows (an editing row is followed by a "+ Add option" row)
    this.lineRows = this.lineTable.locator('tbody tr').filter({ hasNotText: '+ Add option' });
    this.editingRow = this.lineTable.locator('tbody tr').filter({ has: page.locator('input') });
    this.newRowButton = this.panel.getByRole('button', { name: /New row/ });
    this.jsonBlock = this.panel.locator('pre').first();
    this.toasts = page.locator('[data-sonner-toast]');
  }

  async waitForLoaded(): Promise<void> {
    await expect(this.extractedTab).toBeVisible({ timeout: 60000 });
    await expect(this.productLinesTitle).toBeVisible({ timeout: 60000 });
    await expect(this.rowsSummary).toBeVisible({ timeout: 60000 });
    await this.waitForPdf();
  }

  /** The PDF (left, react-pdf-viewer) is rendered: a page canvas is drawn and no spinner is left */
  async waitForPdf(): Promise<void> {
    await expect(this.page.locator('.rpv-core__page-layer canvas').first()).toBeVisible({ timeout: 60000 });
    await expect(this.page.locator('.rpv-core__spinner, .rpv-core__doc-loading')).toHaveCount(0, { timeout: 60000 });
    await expect(this.main.locator('.animate-spin')).toHaveCount(0, { timeout: 60000 });
  }

  fileName(name: string): Locator {
    return this.main.getByText(name, { exact: true }).first();
  }

  statusBadge(status: string): Locator {
    return this.main.getByText(status, { exact: true }).first();
  }

  /** Document field card (PO Number, Project) with its copy / edit icons */
  field(label: string): Locator {
    return this.panel.getByText(label, { exact: true }).locator('xpath=ancestor::div[.//button][1]');
  }
  copyButton(label: string): Locator {
    return this.field(label).locator('button:has(svg.lucide-copy)');
  }
  editButton(label: string): Locator {
    return this.field(label).locator('button:has(svg.lucide-pen)');
  }

  async editField(label: string, value: string): Promise<void> {
    await this.editButton(label).click();
    const input = this.field(label).locator('input, textarea').first();
    await input.fill(value);
    await this.field(label).locator('button:has(svg.lucide-check)').click();
    await expect(this.field(label)).toContainText(value);
  }

  async rowCount(): Promise<number> {
    return Number((await this.rowsSummary.innerText()).match(/\d+/)![0]);
  }

  editRowButton(row: Locator): Locator {
    return row.getByRole('button', { name: 'Edit row' });
  }
  deleteRowButton(row: Locator): Locator {
    return row.getByRole('button', { name: 'Delete row' });
  }

  /** Cells of a product line: Part Number, Description, Qty, Weight, List, Sell, Buy, Company, Catalog, TAG1, Options */
  cell(row: Locator, index: number): Locator {
    return row.locator('td').nth(index);
  }

  async addRow(partNumber: string, description: string, qty: string): Promise<void> {
    await this.newRowButton.click();
    const inputs = this.editingRow.locator('input');
    await inputs.nth(0).fill(partNumber);
    await inputs.nth(1).fill(description);
    await inputs.nth(2).fill(qty);
    await this.editingRow.getByRole('button', { name: 'Save changes' }).click();
    await expect(this.editingRow).toHaveCount(0);
  }

  async editRowQty(row: Locator, qty: string): Promise<void> {
    await this.editRowButton(row).click();
    await this.editingRow.locator('input').nth(2).fill(qty);
    await this.editingRow.getByRole('button', { name: 'Save changes' }).click();
    await expect(this.editingRow).toHaveCount(0);
  }

  async save(): Promise<void> {
    const saved = this.page.waitForResponse((r) => /\/api\/saveSifReview\//.test(r.url()) && r.request().method() === 'PUT');
    await this.saveButton.click();
    expect((await saved).status(), 'saveSifReview API status').toBe(200);
    await expect(this.toasts.filter({ hasText: 'Saved.' })).toBeVisible();
  }
}

export { confirmDialog };
