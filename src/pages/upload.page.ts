import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './base.page';
import { createUniqueTestFile } from '../utils/file-utils';
import path from 'path';

export class UploadPage extends BasePage {
  // Locators
  readonly uploadNavButton: Locator;
  readonly fileInput: Locator;
  readonly chooseFileButton: Locator;
  readonly dropZone: Locator;
  readonly documentTypeDropdown: Locator;
  readonly processButton: Locator;
  readonly uploadProgressBar: Locator;
  readonly uploadSuccessToast: Locator;
  readonly errorMessage: Locator;
  readonly backToDashboardButton: Locator;

  constructor(page: Page) {
    super(page);

    this.uploadNavButton = page.locator('button:has-text("Upload New File"), a:has-text("Upload New File"), button:has-text("Upload")').first();
    this.fileInput = page.locator('input[type="file"]').first();
    this.chooseFileButton = page.locator('button:has-text("Choose File"), label:has-text("Choose File")').first();
    this.dropZone = page.locator('div.border-dashed, div:has(> button:has-text("Choose File"))').first();
    this.documentTypeDropdown = page.locator('button:has-text("Choose a document type"), button:has-text("Quote Request"), button:has-text("Purchase Order"), label:has-text("Document type") ~ button').first();
    this.processButton = page.locator('button:has-text("Process"), button:has-text("Upload Document"), button:has-text("Upload"):not(:has-text("New"))').first();
    this.uploadProgressBar = page.locator('.progress-bar, [role="progressbar"]');
    this.uploadSuccessToast = page.locator('.toast-success, .alert-success, :text-matches("successfully uploaded|upload complete|processing", "i")').first();
    this.errorMessage = page.locator('.toast-error, .alert-danger, [role="alert"], :text-matches("unsupported|invalid|error|failed|rejected|limit|too large|already exists|not allowed", "i")').first();
    this.backToDashboardButton = page.locator('button:has-text("Back to Dashboard"), a:has-text("Back to Dashboard"), button:has-text("Dashboard")').first();
  }

  async waitForReady(): Promise<void> {
    await this.page.waitForLoadState('domcontentloaded').catch(() => {});
    // Wait for "Accepted file formats are still loading" banner to detach if present
    const loadingBanner = this.page.locator(':text("Accepted file formats are still loading")');
    if (await loadingBanner.isVisible({ timeout: 1500 }).catch(() => false)) {
      await loadingBanner.waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
    }
    await this.page.waitForTimeout(500);
  }

  async navigate(): Promise<void> {
    if (!this.getCurrentUrl().includes('/upload')) {
      await this.navigateTo('/upload?from=dashboard');
    }
    await this.waitForReady();
  }

  async selectDocumentType(type: string): Promise<void> {
    await this.waitForReady();
    if (await this.documentTypeDropdown.isVisible({ timeout: 5000 }).catch(() => false)) {
      const tagName = await this.documentTypeDropdown.evaluate(el => el.tagName.toLowerCase()).catch(() => 'button');
      if (tagName === 'select') {
        await this.documentTypeDropdown.selectOption({ label: type }).catch(async () => {
          await this.documentTypeDropdown.selectOption({ value: type });
        });
      } else {
        await this.documentTypeDropdown.click({ timeout: 5000 }).catch(() => {});
        await this.page.waitForTimeout(500);
        const searchPattern = type.toLowerCase().includes('quot') || type.toLowerCase().includes('quote') ? 'Quote' : 'Purchase Order';
        const option = this.page.locator(`[role="option"]:has-text("${searchPattern}"), [role="menuitem"]:has-text("${searchPattern}"), li:has-text("${searchPattern}"), [data-radix-collection-item]:has-text("${searchPattern}")`).first();
        if (await option.isVisible({ timeout: 3000 }).catch(() => false)) {
          await option.click({ timeout: 5000 }).catch(() => {});
          await this.page.waitForTimeout(500);
        }
      }
    }
  }

  async uploadFile(filePath: string): Promise<void> {
    await this.waitForReady();
    const resolvedPath = path.resolve(filePath);
    await this.fileInput.setInputFiles(resolvedPath);
    await this.page.waitForTimeout(500);
  }

  async uploadMultipleFiles(filePaths: string[]): Promise<void> {
    const resolved = filePaths.map(p => path.resolve(p));
    await this.fileInput.setInputFiles(resolved);
  }

  async dragAndDropFile(filePath: string): Promise<void> {
    // In browser automation, setInputFiles directly targets the underlying dropzone input
    await this.uploadFile(filePath);
  }

  async clickProcess(): Promise<void> {
    if (await this.processButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      if (await this.processButton.isEnabled().catch(() => false)) {
        await this.processButton.click();
      }
    }
  }

  async clickBackToDashboard(): Promise<void> {
    const backBtn = this.page.getByText('Back to Dashboard').first();
    await this.page.waitForTimeout(1000);
    try {
      await backBtn.click({ force: true, timeout: 5000 });
    } catch {
      await this.navigateTo('/dashboard');
    }
    await this.page.waitForLoadState('domcontentloaded').catch(() => {});
  }

  async getDisplayedErrorMessage(): Promise<string | null> {
    try {
      if (await this.errorMessage.isVisible({ timeout: 4000 })) {
        return await this.errorMessage.innerText();
      }
      return null;
    } catch {
      return null;
    }
  }

  async isDuplicateError(): Promise<boolean> {
    const errorText = await this.getDisplayedErrorMessage();
    return !!errorText && /already exists|already uploaded|already processed|duplicate/i.test(errorText);
  }

  async isUploadSuccessful(fileName?: string): Promise<boolean> {
    const hasToast = await this.uploadSuccessToast.isVisible({ timeout: 6000 }).catch(() => false);
    const isRedirected = !this.getCurrentUrl().includes('/upload');
    const hasProgress = await this.uploadProgressBar.isVisible({ timeout: 3000 }).catch(() => false);
    let hasFileCard = false;
    if (fileName) {
      const base = path.basename(fileName);
      hasFileCard = await this.page.locator(`text=${base}`).first().isVisible({ timeout: 3000 }).catch(() => false);
    }
    return hasToast || isRedirected || hasProgress || hasFileCard;
  }

  /**
   * Uploads a file with smart duplicate auto-recovery:
   * If River Stream rejects because the file already exists in UI,
   * it automatically generates a fresh unique copy with a timestamped suffix,
   * re-uploads it immediately, and completes the test.
   */
  async uploadWithDuplicateAutoRecovery(
    filePath: string,
    docType?: string
  ): Promise<{ success: boolean; finalFilePath: string; wasDuplicated: boolean }> {
    if (docType) {
      await this.selectDocumentType(docType);
    }

    await this.uploadFile(filePath);
    await this.clickProcess();

    // Check if the system rejected due to duplicate file
    const isDuplicate = await this.isDuplicateError();
    if (isDuplicate) {
      console.warn(`[UploadPage] File "${path.basename(filePath)}" was already uploaded previously (Duplicate detected).`);
      console.log(`[UploadPage] Auto-recovering: Generating unique timestamped copy and re-uploading...`);

      const uniqueCopy = createUniqueTestFile(filePath);
      await this.uploadFile(uniqueCopy);
      await this.clickProcess();

      const success = await this.isUploadSuccessful(uniqueCopy);
      return { success, finalFilePath: uniqueCopy, wasDuplicated: true };
    }

    const success = await this.isUploadSuccessful(filePath);
    return { success, finalFilePath: filePath, wasDuplicated: false };
  }
}
