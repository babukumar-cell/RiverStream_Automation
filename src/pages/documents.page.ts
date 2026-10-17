import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './base.page';

export class DocumentsPage extends BasePage {
  // Locators
  readonly pageHeading: Locator;
  readonly orgDropdown: Locator;
  readonly uploadNewFileButton: Locator;
  readonly searchInput: Locator;
  readonly filterToggle: Locator;
  readonly allFormatsFilterBtn: Locator;
  readonly pdfFilterBtn: Locator;
  readonly xlsFilterBtn: Locator;
  readonly xlsxFilterBtn: Locator;
  readonly ediFilterBtn: Locator;
  readonly sifFilterBtn: Locator;
  readonly applyFiltersBtn: Locator;
  readonly clearFiltersBtn: Locator;
  readonly table: Locator;
  readonly tableHeaders: Locator;
  readonly tableRows: Locator;
  readonly reviewButtons: Locator;
  readonly reExtractButtons: Locator;

  constructor(page: Page) {
    super(page);

    this.pageHeading = page.locator('h1, h2:has-text("Document Library"), :text("Document Library")').first();
    this.orgDropdown = page.locator('button:has-text("All Organizations"), button:has-text("Riverstone Organization"), div:has(> span:has-text("Organization")) button, button[role="combobox"]').first();
    this.uploadNewFileButton = page.locator('button:has-text("Upload New File"), a:has-text("Upload New File")').first();
    this.searchInput = page.locator('input[placeholder*="Search documents" i], input[type="text"]').first();
    this.filterToggle = page.locator('button:has-text("Click to expand"), button:has-text("Click to collapse"), button:has-text("Filters")').first();

    this.allFormatsFilterBtn = page.locator('button:has-text("All formats")').first();
    this.pdfFilterBtn = page.locator('button:has-text("PDF")').first();
    this.xlsFilterBtn = page.locator('button').filter({ hasText: /^XLS$/i }).or(page.locator('button:has-text("XLS"):not(:has-text("XLSX"))')).first();
    this.xlsxFilterBtn = page.locator('button:has-text("XLSX")').first();
    this.ediFilterBtn = page.locator('button:has-text("EDI")').first();
    this.sifFilterBtn = page.locator('button:has-text("SIF")').first();

    this.applyFiltersBtn = page.locator('button:has-text("Apply Active Filters")').first();
    this.clearFiltersBtn = page.locator('button:has-text("Clear all filters")').first();

    this.table = page.locator('table').first();
    this.tableHeaders = page.locator('thead th, [role="columnheader"]');
    this.tableRows = page.locator('tbody tr');
    this.reviewButtons = page.locator('tbody tr button:has-text("Review")');
    this.reExtractButtons = page.locator('tbody tr button:has-text("Re-Extract")');
  }

  async waitForTableLoaded(): Promise<void> {
    const loading = this.page.locator(':text("Loading documents...")');
    if (await loading.isVisible({ timeout: 1000 }).catch(() => false)) {
      await loading.waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
    }
    await this.page.waitForTimeout(500);
  }

  async navigate(): Promise<void> {
    if (this.getCurrentUrl().includes('/documents')) {
      await this.waitForTableLoaded();
      return;
    }

    const sidebarDocsLink = this.page.locator('aside a[href*="documents"], aside button:has-text("Documents"), [role="navigation"] a:has-text("Documents"), a:has-text("Documents"), button:has-text("Documents")').first();
    if (await sidebarDocsLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await sidebarDocsLink.click();
    } else {
      try {
        await this.page.goto('/documents', { waitUntil: 'domcontentloaded', timeout: 30000 });
      } catch {
        await this.page.waitForTimeout(1000);
        await this.page.goto('/documents', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      }
    }

    await this.page.waitForURL('**/documents**', { timeout: 15000 }).catch(() => {});
    await this.waitForTableLoaded();
    await this.table.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
  }

  async ensureFiltersExpanded(): Promise<void> {
    const expandBtn = this.page.locator('button:has-text("Click to expand"), :text("Click to expand")').first();
    if (await expandBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await expandBtn.click();
      await this.page.waitForTimeout(500);
    }
  }

  async ensureFiltersCollapsed(): Promise<void> {
    const collapseBtn = this.page.locator('button:has-text("Click to collapse"), :text("Click to collapse")').first();
    if (await collapseBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await collapseBtn.click();
      await this.page.waitForTimeout(500);
    }
  }

  async searchDocument(term: string): Promise<void> {
    await this.searchInput.fill(term);
    await this.page.waitForTimeout(600);
    await this.waitForTableLoaded();
  }

  async clearSearch(): Promise<void> {
    await this.searchInput.clear();
    await this.page.waitForTimeout(600);
    await this.waitForTableLoaded();
  }

  async filterByFormat(format: 'All' | 'PDF' | 'XLS' | 'XLSX' | 'EDI' | 'SIF'): Promise<void> {
    await this.ensureFiltersExpanded();
    let btn = this.allFormatsFilterBtn;
    switch (format) {
      case 'PDF': btn = this.pdfFilterBtn; break;
      case 'XLS': btn = this.xlsFilterBtn; break;
      case 'XLSX': btn = this.xlsxFilterBtn; break;
      case 'EDI': btn = this.ediFilterBtn; break;
      case 'SIF': btn = this.sifFilterBtn; break;
      default: btn = this.allFormatsFilterBtn; break;
    }
    if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await btn.click();
      await this.page.waitForTimeout(400);
      if (await this.applyFiltersBtn.isEnabled({ timeout: 1500 }).catch(() => false)) {
        await this.applyFiltersBtn.click();
        await this.waitForTableLoaded();
      }
    }
  }

  async selectOrganization(orgName: string): Promise<void> {
    if (await this.orgDropdown.isVisible({ timeout: 3000 }).catch(() => false)) {
      await this.orgDropdown.click();
      await this.page.waitForTimeout(500);
      const option = this.page.locator(`[role="option"]:has-text("${orgName}"), [role="menuitem"]:has-text("${orgName}"), li:has-text("${orgName}")`).first();
      if (await option.isVisible({ timeout: 3000 }).catch(() => false)) {
        await option.click();
        await this.page.waitForTimeout(800);
      }
    }
  }

  async getRowCount(): Promise<number> {
    const emptyRow = this.page.locator('tbody tr:has-text("No more documents"), tbody tr:has-text("No documents"), tbody tr:has-text("No results"), tbody tr:has-text("No data")');
    if (await emptyRow.isVisible().catch(() => false)) {
      return 0;
    }
    return await this.tableRows.count();
  }

  async getFirstRowDocumentName(): Promise<string> {
    const emptyRow = this.page.locator('tbody tr:has-text("No more documents"), tbody tr:has-text("No documents"), tbody tr:has-text("No results"), tbody tr:has-text("No data")');
    if (await emptyRow.isVisible().catch(() => false)) {
      return '';
    }
    const firstRowDocCell = this.page.locator('tbody tr td:first-child').first();
    const text = (await firstRowDocCell.innerText().catch(() => ''))?.trim() || '';
    if (text.toLowerCase().includes('no more documents') || text.toLowerCase().includes('no documents')) {
      return '';
    }
    return text;
  }
}
