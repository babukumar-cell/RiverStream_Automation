import { Page, Locator } from '@playwright/test';
import { BasePage } from './base.page';

export class PoAckReconPage extends BasePage {
  // Page header & top controls
  readonly pageTitle: Locator;
  readonly projectsHeader: Locator;
  readonly searchInput: Locator;
  readonly newProjectButton: Locator;

  // Projects table elements
  readonly projectTable: Locator;
  readonly projectRows: Locator;
  readonly tableHeaders: Locator;
  readonly projectNameCells: Locator;

  // New Project Dialog elements
  readonly dialog: Locator;
  readonly dialogTitle: Locator;
  readonly projectNameInput: Locator;
  readonly projectLocationInput: Locator;
  readonly projectDescriptionInput: Locator;
  readonly createProjectButton: Locator;
  readonly cancelProjectButton: Locator;
  readonly closeDialogButton: Locator;
  readonly validationMessage: Locator;

  // Breadcrumbs & Navigation
  readonly breadcrumbs: Locator;
  readonly breadcrumbReconLink: Locator;
  readonly breadcrumbProjectLink: Locator;
  readonly documentFilterButtons: Locator;

  // Project Documents List
  readonly docSearchInput: Locator;
  readonly uploadDocsButton: Locator;
  readonly docTable: Locator;
  readonly docTableHeaders: Locator;
  readonly docTableRows: Locator;
  readonly docReviewButtons: Locator;
  readonly docUploadAckButtons: Locator;

  // Upload Documents Modal
  readonly uploadModal: Locator;
  readonly uploadModalTitle: Locator;
  readonly poDropzone: Locator;
  readonly poFileInput: Locator;
  readonly poBrowseButton: Locator;
  readonly ackDropzone: Locator;
  readonly ackFileInput: Locator;
  readonly ackBrowseButton: Locator;
  readonly addAnotherAckButton: Locator;
  readonly cancelUploadButton: Locator;
  readonly uploadFilesButton: Locator;
  readonly closeUploadModalButton: Locator;

  // Review Page
  readonly showPdfsButton: Locator;
  readonly completeButton: Locator;
  readonly ackDropdown: Locator;
  readonly editAllButtons: Locator;
  readonly discrepancyBadges: Locator;
  readonly emailPreviewButton: Locator;
  readonly discrepancyCards: Locator;

  constructor(page: Page) {
    super(page);

    this.pageTitle = page.locator('h1:has-text("PO-ACK Recon")').first();
    this.projectsHeader = page.locator('h2:has-text("Projects")').first();
    this.searchInput = page.locator('input[placeholder*="Search projects" i]').first();
    this.newProjectButton = page.locator('button:has-text("New Project")').first();

    this.projectTable = page.locator('table').first();
    this.projectRows = page.locator('table tbody tr');
    this.tableHeaders = page.locator('table th');
    this.projectNameCells = page.locator('table tbody tr td:first-child');

    // Dialog elements
    this.dialog = page.locator('[role="dialog"]').first();
    this.dialogTitle = page.locator('[role="dialog"] h2, [role="dialog"] h3, text=/Create New Project/i').first();
    this.projectNameInput = page.locator('[role="dialog"] input[placeholder*="Enter project name" i], input[placeholder*="Enter project name" i]').first();
    this.projectLocationInput = page.locator('[role="dialog"] input[placeholder*="Enter location" i], input[placeholder*="Enter location" i]').first();
    this.projectDescriptionInput = page.locator('[role="dialog"] textarea').first();
    this.createProjectButton = page.locator('[role="dialog"] button:has-text("Create")').first();
    this.cancelProjectButton = page.locator('[role="dialog"] button:has-text("Cancel")').first();
    this.closeDialogButton = page.locator('[role="dialog"] button:has-text("Close"), [role="dialog"] button[aria-label*="close" i], [role="dialog"] button:has(svg)').first();
    this.validationMessage = page.locator('[role="dialog"] [role="alert"], [role="dialog"] p.text-destructive, [role="dialog"] .text-red-500, [role="alert"]').first();

    // Breadcrumbs & Filters
    this.breadcrumbs = page.locator('[data-slot="breadcrumb-list"], nav[aria-label="breadcrumb"] ol').first();
    this.breadcrumbReconLink = page.locator('[data-slot="breadcrumb-link"]:has-text("PO-ACK Recon"), [data-slot="breadcrumb-list"] button:has-text("PO-ACK Recon")').first();
    this.breadcrumbProjectLink = page.locator('[data-slot="breadcrumb-list"] [data-slot="breadcrumb-item"]').nth(1);
    this.documentFilterButtons = page.locator('button:has-text("All"), button:has-text("Awaiting ACK"), button:has-text("Pending Review"), button:has-text("Matched"), button:has-text("Medium"), button:has-text("Critical"), button:has-text("Minor"), button:has-text("Failed")');

    // Project Documents List
    this.docSearchInput = page.locator('input[placeholder*="Search PO number" i]').first();
    this.uploadDocsButton = page.locator('button:has-text("Upload Documents")').first();
    this.docTable = page.locator('table').first();
    this.docTableHeaders = page.locator('table thead th, table th');
    this.docTableRows = page.locator('table tbody tr');
    this.docReviewButtons = page.locator('table tbody tr button:has-text("Review")');
    this.docUploadAckButtons = page.locator('table tbody tr button:has-text("Upload ACK")');

    // Upload Documents Modal
    this.uploadModal = page.locator('[role="dialog"]').filter({ hasText: /Upload Documents/i }).first();
    this.uploadModalTitle = this.uploadModal.locator('h2, h3, :text("Upload Documents")').first();
    this.poDropzone = this.uploadModal.locator('div:has(> *:has-text("Purchase Order")), div:has-text("Purchase Order")').first();
    this.poFileInput = this.uploadModal.locator('input[type="file"]').first();
    this.poBrowseButton = this.uploadModal.locator('button:has-text("Browse files"), span:has-text("Browse files")').first();
    this.ackDropzone = this.uploadModal.locator('div:has(> *:has-text("Acknowledgment")), div:has-text("Acknowledgment")').first();
    this.ackFileInput = this.uploadModal.locator('input[type="file"]').nth(1);
    this.ackBrowseButton = this.uploadModal.locator('button:has-text("Browse files"), span:has-text("Browse files")').nth(1);
    this.addAnotherAckButton = this.uploadModal.locator('button:has-text("Add another file")').first();
    this.cancelUploadButton = this.uploadModal.locator('button:has-text("Cancel")').first();
    this.uploadFilesButton = this.uploadModal.locator('button:has-text("Upload Files")').first();
    this.closeUploadModalButton = this.uploadModal.locator('button:has-text("Close"), button[aria-label*="close" i], button:has(svg)').first();

    // Review Page
    this.showPdfsButton = page.locator('button:has-text("Show PDFs"), button:has-text("View PDFs"), button:has-text("Collapse PDF"), button:has-text("Hide PDFs")').first();
    this.completeButton = page.locator('button:has-text("Complete")').first();
    this.ackDropdown = page.locator('button:has-text("ACK"), select, [role="combobox"]').first();
    this.editAllButtons = page.locator('button:has-text("Edit All")');
    this.discrepancyBadges = page.locator('text=/\\d+\\s+Critical|\\d+\\s+Medium|\\d+\\s+Minor|\\d+\\s+Matched/i');
    this.emailPreviewButton = page.locator('button:has-text("Email Preview")').first();
    this.discrepancyCards = page.locator('.bg-yellow-50, .bg-yellow-100, .bg-amber-50, [class*="yellow"], [class*="amber"]');
  }

  /**
   * Wait for project table loading spinner to disappear
   */
  async waitForProjectsLoaded(): Promise<void> {
    const loading = this.page.locator(':text("Loading projects..."), :text("Loading...")').first();
    await loading.waitFor({ state: 'hidden', timeout: 25000 }).catch(() => {});
    const content = this.page.locator('table tbody tr td').first().or(this.page.locator(':text("No projects found")')).first();
    await content.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
  }

  /**
   * Wait for document table loading spinner to disappear
   */
  async waitForDocsLoaded(): Promise<void> {
    const loading = this.page.locator(':text("Loading documents..."), :text("Loading...")').first();
    await loading.waitFor({ state: 'hidden', timeout: 25000 }).catch(() => {});
    const content = this.page.locator('table tbody tr td').first().or(this.page.locator(':text("No documents found")')).first();
    await content.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
  }

  /**
   * Navigate directly to PO-ACK Recon Projects page
   */
  async navigate(): Promise<void> {
    const isAtProjects = await this.projectsHeader.isVisible({ timeout: 1000 }).catch(() => false);
    const hasSearch = await this.searchInput.isVisible({ timeout: 1000 }).catch(() => false);
    if (isAtProjects && hasSearch) {
      await this.waitForProjectsLoaded();
      return;
    }

    const breadcrumbLink = this.page.locator('[data-slot="breadcrumb-link"]:has-text("PO-ACK Recon"), [data-slot="breadcrumb-list"] button:has-text("PO-ACK Recon")').first();
    if (await breadcrumbLink.isVisible({ timeout: 2000 }).catch(() => false)) {
      await breadcrumbLink.click();
    } else {
      const reconSidebar = this.page.locator('aside a[href*="po-ack-recon"], aside button:has-text("PO-ACK Recon")').first();
      if (await reconSidebar.isVisible({ timeout: 2000 }).catch(() => false)) {
        await reconSidebar.click();
      } else {
        await this.navigateTo('/po-ack-recon');
      }
    }

    await this.waitForProjectsLoaded();
  }

  /**
   * Verify if Projects page is loaded
   */
  async isLoaded(): Promise<boolean> {
    const hasHeader = await this.pageTitle.isVisible({ timeout: 10000 }).catch(() => false);
    const hasSearch = await this.searchInput.isVisible({ timeout: 5000 }).catch(() => false);
    return hasHeader || hasSearch;
  }

  /**
   * Open New Project modal
   */
  async openNewProjectModal(): Promise<void> {
    await this.newProjectButton.waitFor({ state: 'visible', timeout: 10000 });
    await this.newProjectButton.click();
    await this.dialog.waitFor({ state: 'visible', timeout: 5000 });
  }

  /**
   * Close modal via Cancel button
   */
  async closeModalWithCancel(): Promise<void> {
    await this.cancelProjectButton.click();
    await this.dialog.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  }

  /**
   * Close modal via Close (X) icon / Close button
   */
  async closeModalWithCloseButton(): Promise<void> {
    await this.closeDialogButton.click();
    await this.dialog.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  }

  /**
   * Close modal by pressing Escape key
   */
  async closeModalWithEscape(): Promise<void> {
    await this.page.keyboard.press('Escape');
    await this.dialog.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  }

  /**
   * Create a new project
   */
  async createProject(name: string, location?: string, description?: string): Promise<void> {
    await this.openNewProjectModal();
    if (name) {
      await this.projectNameInput.fill(name);
    }
    if (location) {
      await this.projectLocationInput.fill(location);
    }
    if (description) {
      await this.projectDescriptionInput.fill(description);
    }
    await this.createProjectButton.click();
    await this.dialog.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
    await this.page.waitForTimeout(1000);
    await this.waitForProjectsLoaded();
  }

  /**
   * Search for projects in the search box
   */
  async searchProject(query: string): Promise<void> {
    await this.searchInput.waitFor({ state: 'visible', timeout: 5000 });
    await this.searchInput.fill(query);
    await this.page.waitForTimeout(600); // Allow debounce filtering
    await this.waitForProjectsLoaded();
  }

  /**
   * Clear the search input
   */
  async clearSearch(): Promise<void> {
    await this.searchInput.fill('');
    await this.page.waitForTimeout(600);
    await this.waitForProjectsLoaded();
  }

  /**
   * Get visible project names from table
   */
  async getVisibleProjectNames(): Promise<string[]> {
    await this.waitForProjectsLoaded();
    const count = await this.projectNameCells.count();
    const names: string[] = [];
    for (let i = 0; i < count; i++) {
      const rawText = (await this.projectNameCells.nth(i).innerText()).trim();
      const cleanName = rawText.split('\n')[0].trim();
      const lower = cleanName.toLowerCase();
      if (cleanName && !lower.includes('no po-ack') && !lower.includes('no project') && !lower.includes('no record') && !lower.includes('loading')) {
        names.push(cleanName);
      }
    }
    return names;
  }

  /**
   * Click on a project by name to view its documents list
   */
  async openProject(projectName: string): Promise<void> {
    await this.waitForProjectsLoaded();
    const projectLink = this.page.locator(`table tbody tr:has-text("${projectName}") a, table tbody tr:has-text("${projectName}") td:first-child`).first();
    if (!await projectLink.isVisible({ timeout: 2000 }).catch(() => false)) {
      await this.searchProject(projectName);
    }
    await projectLink.waitFor({ state: 'visible', timeout: 10000 });
    await projectLink.click();
    await this.page.waitForTimeout(1000);
    await this.waitForDocsLoaded();
  }

  /**
   * Open the review view for the first document in the current project
   */
  async openFirstDocumentReview(): Promise<void> {
    await this.waitForDocsLoaded();
    const firstReview = this.docReviewButtons.first();
    await firstReview.waitFor({ state: 'visible', timeout: 15000 });
    await firstReview.click({ force: true });
    const loading = this.page.locator(':text("Loading...")').first();
    await loading.waitFor({ state: 'hidden', timeout: 25000 }).catch(() => {});
    await this.completeButton.waitFor({ state: 'visible', timeout: 25000 }).catch(() => {});
  }

  /**
   * Open Upload Documents modal
   */
  async openUploadDocumentsModal(): Promise<void> {
    await this.uploadDocsButton.waitFor({ state: 'visible', timeout: 10000 });
    await this.uploadDocsButton.click();
    await this.uploadModal.waitFor({ state: 'visible', timeout: 8000 });
  }

  /**
   * Attach PO File in the upload modal
   */
  async attachPoFile(filePath: string): Promise<void> {
    await this.poFileInput.setInputFiles(filePath);
    await this.page.waitForTimeout(500);
  }

  /**
   * Attach ACK File in the upload modal
   */
  async attachAckFile(filePath: string, ackIndex: number = 0): Promise<void> {
    const fileInputs = this.uploadModal.locator('input[type="file"]');
    const targetInput = fileInputs.nth(1 + ackIndex);
    await targetInput.setInputFiles(filePath);
    await this.page.waitForTimeout(500);
  }

  /**
   * Click '+ Add another file' button in the upload modal
   */
  async clickAddAnotherAck(): Promise<void> {
    await this.addAnotherAckButton.waitFor({ state: 'visible', timeout: 5000 });
    await this.addAnotherAckButton.click();
    await this.page.waitForTimeout(500);
  }

  /**
   * Close upload modal with Cancel
   */
  async cancelUpload(): Promise<void> {
    await this.cancelUploadButton.click();
    await this.uploadModal.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  }

  /**
   * Close upload modal with (X) button
   */
  async closeUploadModalWithX(): Promise<void> {
    await this.closeUploadModalButton.click();
    await this.uploadModal.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  }

  /**
   * Submit PO and ACK files
   */
  async submitUploadFiles(): Promise<void> {
    await this.uploadFilesButton.waitFor({ state: 'visible', timeout: 5000 });
    await this.uploadFilesButton.click();
    await this.uploadModal.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
    await this.waitForDocsLoaded();
  }

  /**
   * Filter documents table by status button (e.g. 'Critical', 'Medium', 'Matched', 'All')
   */
  async applyStatusFilter(status: string): Promise<void> {
    const filterBtn = this.page.locator(`button:has-text("${status}")`).first();
    await filterBtn.waitFor({ state: 'visible', timeout: 10000 });
    await filterBtn.click();
    await this.page.waitForTimeout(1000);
    await this.waitForDocsLoaded();
  }

  /**
   * Get visible status texts from the document table
   */
  async getVisibleDocumentStatuses(): Promise<string[]> {
    const rows = this.docTableRows;
    const count = await rows.count();
    const statuses: string[] = [];
    for (let i = 0; i < count; i++) {
      const row = rows.nth(i);
      const isVisible = await row.isVisible();
      if (!isVisible) continue;
      const statusCell = row.locator('td:nth-child(4), td:has-text("Critical"), td:has-text("Medium"), td:has-text("Minor"), td:has-text("Matched"), td:has-text("Awaiting"), td:has-text("Pending"), td:has-text("Failed"), td:has-text("Processing")').first();
      if (await statusCell.isVisible().catch(() => false)) {
        const text = (await statusCell.innerText()).trim();
        if (text && !text.toLowerCase().includes('no po-ack')) {
          statuses.push(text);
        }
      }
    }
    return statuses;
  }
}
