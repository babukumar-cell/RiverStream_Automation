import { Page, Locator, Response, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { BasePage } from './base.page';

export type UploadDocumentType = 'Quote Request' | 'Purchase Order';
export type UploadOrigin = 'dashboard' | 'documents';

/** API value the backend stores for each document type chosen on the Upload page */
export const DOC_TYPE_API_VALUE: Record<UploadDocumentType, string> = {
  'Quote Request': 'QUOTE_REQUEST',
  'Purchase Order': 'PURCHASE_ORDER',
};

/** File handed to the browser for synthetic drag-and-drop */
export interface DroppedFile {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

export interface UploadResult {
  status: number;
  body: any;
  requestBody: any;
}

/**
 * Upload Document page (/upload?from=dashboard|documents).
 *
 * Live flow (Oct 2026): choose a document type, attach one file (Choose File or drag-and-drop),
 * then click "Upload and Process". The button reads "Uploading..." while POST /api/uploadDocument
 * is in flight; on success (HTTP 202) the app redirects back to the page named by `from`.
 * Client-side validation errors and server errors appear in a red banner inside the upload card.
 */
export class UploadPage extends BasePage {
  readonly heading: Locator;
  readonly documentTypeDropdown: Locator;
  readonly fileInput: Locator;
  readonly dropZone: Locator;
  readonly dropZonePrompt: Locator;
  readonly chooseFileButton: Locator;
  readonly removeFileButton: Locator;
  readonly uploadAndProcessButton: Locator;
  readonly uploadingButton: Locator;
  readonly errorMessage: Locator;
  readonly acceptedFormatsHint: Locator;
  readonly selectedFileSize: Locator;
  readonly uploadSuccessToast: Locator;
  readonly backToDashboardButton: Locator;
  readonly backToDocumentsButton: Locator;

  constructor(page: Page) {
    super(page);

    this.heading = page.getByRole('heading', { name: 'Upload Your Document' });
    this.documentTypeDropdown = page.getByLabel('Document type');
    this.fileInput = page.locator('input[type="file"]');
    // The dashed card that wraps the hidden file input is the drop target.
    this.dropZone = page.locator('div.border-dashed').filter({ has: this.fileInput });
    this.dropZonePrompt = page.getByText('Drag and drop your file here', { exact: true });
    this.chooseFileButton = page.getByRole('button', { name: 'Choose File', exact: true });
    this.removeFileButton = page.getByRole('button', { name: 'Remove File', exact: true });
    this.uploadAndProcessButton = page.getByRole('button', { name: 'Upload and Process', exact: true });
    this.uploadingButton = page.getByRole('button', { name: 'Uploading...', exact: true });
    // Red validation / server error banner (it has no role="alert", so it is anchored on its styling).
    this.errorMessage = page.locator('main div.bg-red-50').filter({ has: page.locator('span') });
    this.acceptedFormatsHint = page.getByText(/^Accepted formats:/);
    this.selectedFileSize = this.dropZone.getByText(/^\d+\.\d{2} MB$/);
    this.uploadSuccessToast = page.locator('[data-sonner-toast]').filter({ hasText: /upload|success|processing/i });
    this.backToDashboardButton = page.getByRole('button', { name: 'Back to Dashboard', exact: true });
    this.backToDocumentsButton = page.getByRole('button', { name: 'Back to Documents', exact: true });
  }

  /** Opens /upload and waits until the accepted formats have loaded (files chosen earlier are rejected). */
  async navigate(from: UploadOrigin = 'dashboard'): Promise<void> {
    await this.navigateTo(`/upload?from=${from}`);
    await this.waitForReady();
  }

  async waitForReady(): Promise<void> {
    await expect(this.heading).toBeVisible();
    await expect(this.fileInput).toHaveAttribute('accept', /\.pdf/, { timeout: 20000 });
  }

  documentTypeOption(type: UploadDocumentType | string): Locator {
    return this.page.getByRole('option', { name: type, exact: true });
  }

  async selectDocumentType(type: UploadDocumentType): Promise<void> {
    await this.documentTypeDropdown.click();
    await this.documentTypeOption(type).click();
    await expect(this.documentTypeDropdown).toHaveText(type);
  }

  /** File name shown in the drop zone once a file is attached */
  selectedFileName(fileName: string): Locator {
    return this.dropZone.getByText(fileName, { exact: true });
  }

  /** Attaches a file straight to the hidden input (what the browser does after the OS dialog closes). */
  async attachFile(file: string | DroppedFile): Promise<void> {
    await this.fileInput.setInputFiles(typeof file === 'string' ? path.resolve(file) : file);
  }

  /** Attaches a file the way a user does: click "Choose File" and pick the file in the native dialog. */
  async chooseFileViaDialog(filePath: string): Promise<void> {
    const chooserPromise = this.page.waitForEvent('filechooser');
    await this.chooseFileButton.click();
    const chooser = await chooserPromise;
    await chooser.setFiles(path.resolve(filePath));
  }

  /** Builds a DroppedFile from a file on disk */
  static toDroppedFile(filePath: string, mimeType: string = 'application/octet-stream'): DroppedFile {
    return { name: path.basename(filePath), mimeType, buffer: fs.readFileSync(filePath) };
  }

  /** Dispatches dragenter + dragover on the drop zone with the given files (without dropping). */
  async dragOver(files: DroppedFile[]): Promise<void> {
    const dataTransfer = await this.createDataTransfer(files);
    await this.dropZone.dispatchEvent('dragenter', { dataTransfer });
    await this.dropZone.dispatchEvent('dragover', { dataTransfer });
  }

  async dragLeave(): Promise<void> {
    const dataTransfer = await this.createDataTransfer([]);
    await this.dropZone.dispatchEvent('dragleave', { dataTransfer });
  }

  /** Full drag-and-drop gesture: dragenter, dragover and drop on the drop zone. */
  async dropFiles(files: DroppedFile[]): Promise<void> {
    const dataTransfer = await this.createDataTransfer(files);
    await this.dropZone.dispatchEvent('dragenter', { dataTransfer });
    await this.dropZone.dispatchEvent('dragover', { dataTransfer });
    await this.dropZone.dispatchEvent('drop', { dataTransfer });
  }

  private async createDataTransfer(files: DroppedFile[]) {
    const payload = files.map(f => ({ name: f.name, mimeType: f.mimeType, base64: f.buffer.toString('base64') }));
    return this.page.evaluateHandle(items => {
      const dt = new DataTransfer();
      for (const item of items) {
        const bytes = Uint8Array.from(atob(item.base64), c => c.charCodeAt(0));
        dt.items.add(new File([bytes], item.name, { type: item.mimeType }));
      }
      return dt;
    }, payload);
  }

  /** Background colour of the drop zone, used to detect the drag-over highlight */
  async dropZoneBackground(): Promise<string> {
    return this.dropZone.evaluate(el => getComputedStyle(el).backgroundColor);
  }

  static isUploadRequest(response: Response): boolean {
    return response.url().includes('/api/uploadDocument') && response.request().method() === 'POST';
  }

  /** Clicks "Upload and Process" and returns the uploadDocument API exchange. */
  async submitUpload(): Promise<UploadResult> {
    const responsePromise = this.page.waitForResponse(UploadPage.isUploadRequest, { timeout: 45000 });
    await this.uploadAndProcessButton.click();
    const response = await responsePromise;
    let body: any = null;
    try {
      body = await response.json();
    } catch {
      body = await response.text();
    }
    return { status: response.status(), body, requestBody: response.request().postDataJSON() };
  }

  /**
   * Complete happy-path upload: select type, attach the file, submit, and wait for the redirect
   * back to the origin page. Returns the uploadDocument API exchange.
   */
  async uploadDocument(filePath: string, type: UploadDocumentType, from: UploadOrigin = 'dashboard'): Promise<UploadResult> {
    await this.selectDocumentType(type);
    await this.attachFile(filePath);
    await expect(this.selectedFileName(path.basename(filePath))).toBeVisible();
    const result = await this.submitUpload();
    expect(result.status, `uploadDocument response: ${JSON.stringify(result.body)}`).toBe(202);
    await this.page.waitForURL(`**/${from}`, { timeout: 30000 });
    return result;
  }
}
