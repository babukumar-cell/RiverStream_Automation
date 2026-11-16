import fs from 'fs';
import os from 'os';
import path from 'path';
import { Locator, Page } from '@playwright/test';
import { test, expect } from '../../src/fixtures/test.fixture';
import { UploadPage, UploadDocumentType, UploadResult, DOC_TYPE_API_VALUE } from '../../src/pages/upload.page';
import { DocumentsPage } from '../../src/pages/documents.page';
import { DashboardPage } from '../../src/pages/dashboard.page';
import { uniqueName } from '../../src/test-data/qa-data';
import { createNamedCopy, createMockFile, createLargeFile } from '../../src/utils/file-utils';

/*
 * River Stream - Upload Document (TC_UP_001 - TC_UP_031), workbook 03_Upload_Document.xlsx.
 *
 * Runs as the Super Admin (organization riverstonetech). Valid files are uploaded under unique AUTO_UP_* names;
 * the Documents library has no delete, so they stay in the organization. Invalid files are rejected by the Upload
 * page as soon as they are attached (red message, no "Upload and Process" button, no upload request).
 * After "Upload and Process" the app returns to the Dashboard, where the evidence shows the upload notification.
 * TC_UP_027 and TC_UP_031 reuse the PDF uploaded by TC_UP_006 (skipped with the reason when it did not upload).
 */

const FILES_DIR = path.resolve(__dirname, '../../src/test-data/files');
const SIF_DIR = path.resolve(__dirname, '../../Riverstone test SIF Files');
const SAMPLE_PDF = path.join(FILES_DIR, 'sample-invoice.pdf');
const SAMPLE_MULTIPAGE_PDF = path.join(FILES_DIR, 'sample-po-12-pages.pdf');
const SAMPLE_EDI = path.join(FILES_DIR, 'sample-order.edi');
const SAMPLE_XLSX = path.join(FILES_DIR, 'sample-po.xlsx');
const SAMPLE_XLS = path.join(FILES_DIR, 'sample-po.xls');
const SAMPLE_SIF = path.join(SIF_DIR, 'CDF_Carolina OS_Young Conway Furniture_SIF_260520_QA8.sif');
const SAMPLE_SIF_2 = path.join(SIF_DIR, 'CDF_Office furniture expo_Drawing needed EXPO_SIF_260429-1_QA5.sif');

/** Client chosen for SIF uploads (Client Name is required for SIF files) */
const CLIENT = process.env.UPLOAD_CLIENT || 'Riverstone Corp';
const MAX_SIZE_MB = 50;

const INVALID_FORMAT_ERROR = 'Invalid file format. Please upload a supported file type (PDF, EDI, XLSX, XLS, or SIF).';
const EMPTY_FILE_ERROR = 'The selected file is empty. Please choose a valid file.';
const DUPLICATE_ERROR = 'File with this name already exists.';

/**
 * File name uploaded by TC_UP_006, reused by TC_UP_027 and TC_UP_031. Kept in a file per run: a failed test restarts
 * the worker, which would lose a module variable.
 */
const STATE_FILE = path.join(os.tmpdir(), `riverstream-upload-suite-${process.env.RS_RUN_ID ?? process.ppid}.json`);
const state = {
  get pdfFileName(): string | undefined {
    try {
      return (JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as { pdfFileName?: string }).pdfFileName;
    } catch {
      return undefined;
    }
  },
  set pdfFileName(name: string | undefined) {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ pdfFileName: name }));
  },
};

/** Copy of `source` with a unique AUTO_UP_<label>_... name, in the test's output folder */
function uploadCopy(source: string, label: string): string {
  return createNamedCopy(source, `${uniqueName(`UP_${label}`)}${path.extname(source)}`, test.info().outputPath());
}

function expectAccepted(result: UploadResult, fileName: string, type: UploadDocumentType): void {
  expect(result.status, `uploadDocument: ${JSON.stringify(result.body).slice(0, 300)}`).toBe(202);
  expect(result.requestBody.fileName).toBe(fileName);
  expect(result.requestBody.selectedDocType).toBe(DOC_TYPE_API_VALUE[type]);
  expect(result.body.status).toBe('processing');
  expect(result.body.table_entity.fileName).toBe(fileName);
}

/** "File uploaded successfully" toast naming the file */
function successToast(page: Page, fileName: string): Locator {
  return page.locator('[data-sonner-toast]').filter({ hasText: 'File uploaded successfully' }).filter({ hasText: fileName });
}

/** Records every uploadDocument request the page sends */
function trackUploadRequests(page: Page): string[] {
  const sent: string[] = [];
  page.on('request', (req) => {
    if (req.url().includes('/api/uploadDocument')) sent.push(req.method());
  });
  return sent;
}

/** Dashboard fully loaded: KPI tabs, list heading and documents (no loading indicator), network idle */
async function waitForDashboardLoaded(page: Page): Promise<void> {
  await page.waitForURL(/\/dashboard(\?|$)/, { timeout: 30000 });
  await new DashboardPage(page).expectLoaded();
  await page.waitForLoadState('networkidle').catch(() => {});
}

type AttachVia = 'choose-file' | 'drop';

/** Chooses the type, attaches the file (Choose File dialog or drag and drop), picks a client for SIF files, uploads */
async function uploadValid(uploadPage: UploadPage, file: string, type: UploadDocumentType, via: AttachVia = 'choose-file'): Promise<string> {
  const fileName = path.basename(file);
  await uploadPage.selectDocumentType(type);
  if (via === 'drop') await uploadPage.dropFiles([UploadPage.toDroppedFile(file)]);
  else await uploadPage.chooseFileViaDialog(file);
  await expect(uploadPage.selectedFileName(fileName)).toBeVisible();
  if (path.extname(file).toLowerCase() === '.sif') await uploadPage.selectClient(CLIENT);
  await expect(uploadPage.processButton).toBeEnabled();
  const result = await uploadPage.submitUpload();
  expectAccepted(result, fileName, type);
  // The app returns to the Dashboard (opened from there) and shows the notification
  await waitForDashboardLoaded(uploadPage.page);
  await expect(successToast(uploadPage.page, fileName)).toBeVisible({ timeout: 15000 });
  return fileName;
}

/** The file is rejected as soon as it is attached: the message, no upload button, empty drop zone, nothing sent */
async function expectRejectedOnAttach(uploadPage: UploadPage, file: string, message: string | RegExp): Promise<void> {
  const sent = trackUploadRequests(uploadPage.page);
  await uploadPage.attachFile(file);
  await expect(uploadPage.errorMessage).toHaveText(message);
  await expect(uploadPage.processButton, 'no Upload and Process button for a rejected file').toHaveCount(0);
  await expect(uploadPage.dropZonePrompt).toBeVisible();
  expect(sent, 'no upload request is sent').toEqual([]);
}

test.describe('River Stream - Upload Document (TC_UP_001 - TC_UP_031)', () => {
  test.describe.configure({ retries: 0 });

  test.beforeEach(async ({ uploadPage }) => {
    await uploadPage.navigate('dashboard');
  });

  // =========================================================================
  // Document type
  // =========================================================================

  test('TC_UP_001: Verify Document Type dropdown displays configured options (Quote Request, Purchase Order)', async ({ uploadPage, page }) => {
    await uploadPage.docTypeDropdown.click();
    await expect(page.getByRole('option')).toHaveText(['Purchase Order', 'Quote Request']);
    await expect(uploadPage.documentTypeOption('Quote Request')).toBeVisible();
    await expect(uploadPage.documentTypeOption('Purchase Order')).toBeVisible();
  });

  test("TC_UP_002: Verify selection of 'Quote Request' document type", async ({ uploadPage }) => {
    await uploadPage.selectDocumentType('Quote Request');
    await expect(uploadPage.docTypeDropdown).toHaveText('Quote Request');
  });

  test("TC_UP_003: Verify selection of 'Purchase Order' document type", async ({ uploadPage }) => {
    await uploadPage.selectDocumentType('Purchase Order');
    await expect(uploadPage.docTypeDropdown).toHaveText('Purchase Order');
  });

  test('TC_UP_004: Verify behavior when uploading without selecting a Document Type', async ({ uploadPage }) => {
    const file = uploadCopy(SAMPLE_PDF, 'NOTYPE');
    await uploadPage.attachFile(file);
    await expect(uploadPage.selectedFileName(path.basename(file))).toBeVisible();
    await expect(uploadPage.docTypeDropdown).toHaveText('Choose a document type');
    // Upload and Process stays disabled until a document type is chosen
    await expect(uploadPage.processButton).toBeDisabled();
  });

  test('TC_UP_005: Verify Document Type persistence when replacing attached file', async ({ uploadPage }) => {
    const fileA = uploadCopy(SAMPLE_SIF, 'SIF_A');
    const fileB = uploadCopy(SAMPLE_SIF_2, 'SIF_B');
    await uploadPage.selectDocumentType('Quote Request');
    await uploadPage.chooseFileViaDialog(fileA);
    await expect(uploadPage.selectedFileName(path.basename(fileA))).toBeVisible();
    await uploadPage.removeFileButton.click();
    await uploadPage.chooseFileViaDialog(fileB);
    await expect(uploadPage.selectedFileName(path.basename(fileA))).toHaveCount(0);
    await expect(uploadPage.selectedFileName(path.basename(fileB))).toBeVisible();
    await expect(uploadPage.docTypeDropdown).toHaveText('Quote Request');
  });

  // =========================================================================
  // Valid uploads
  // =========================================================================

  test('TC_UP_006: Verify user can upload a valid PDF file using Choose File', async ({ uploadPage }) => {
    state.pdfFileName = await uploadValid(uploadPage, uploadCopy(SAMPLE_PDF, 'PDF'), 'Purchase Order');
  });

  test('TC_UP_007: Verify user can upload a valid EDI file using Choose File', async ({ uploadPage }) => {
    await uploadValid(uploadPage, uploadCopy(SAMPLE_EDI, 'EDI'), 'Purchase Order');
  });

  test('TC_UP_008: Verify user can upload a valid modern Excel workbook (.xlsx)', async ({ uploadPage }) => {
    await uploadValid(uploadPage, uploadCopy(SAMPLE_XLSX, 'XLSX'), 'Purchase Order');
  });

  test('TC_UP_009: Verify user can upload a valid legacy Excel spreadsheet (.xls)', async ({ uploadPage }) => {
    await uploadValid(uploadPage, uploadCopy(SAMPLE_XLS, 'XLS'), 'Purchase Order');
  });

  test('TC_UP_010: Verify user can upload a valid Riverstone SIF quotation file (.sif)', async ({ uploadPage }) => {
    await uploadValid(uploadPage, uploadCopy(SAMPLE_SIF, 'SIF'), 'Quote Request');
  });

  test('TC_UP_011: Verify upload of multi-page complex PDF document (>10 pages)', async ({ uploadPage }) => {
    await uploadValid(uploadPage, uploadCopy(SAMPLE_MULTIPAGE_PDF, 'PDF12P'), 'Purchase Order');
  });

  test('TC_UP_012: Verify user can upload a valid PDF file using Drag and Drop', async ({ uploadPage }) => {
    await uploadValid(uploadPage, uploadCopy(SAMPLE_PDF, 'DND_PDF'), 'Purchase Order', 'drop');
  });

  test('TC_UP_013: Verify user can upload a valid SIF file using Drag and Drop', async ({ uploadPage }) => {
    await uploadValid(uploadPage, uploadCopy(SAMPLE_SIF, 'DND_SIF'), 'Quote Request', 'drop');
  });

  // =========================================================================
  // Drop zone and attached file
  // =========================================================================

  test('TC_UP_014: Verify clicking drag-and-drop container triggers file selection browser', async ({ uploadPage, page }) => {
    // "or click to browse": the Choose File button inside the dashed area opens the system file chooser
    const file = uploadCopy(SAMPLE_PDF, 'BROWSE');
    const browseButton = uploadPage.dropZone.getByRole('button', { name: 'Choose File', exact: true });
    await expect(uploadPage.dropZonePrompt).toBeVisible();
    const chooserOpened = page.waitForEvent('filechooser', { timeout: 10000 });
    await browseButton.click();
    const chooser = await chooserOpened;
    expect(chooser.isMultiple(), 'the file chooser takes one file').toBe(false);
    // The file picked in the chooser is attached in the dashed area
    await chooser.setFiles(file);
    await expect(uploadPage.selectedFileName(path.basename(file))).toBeVisible();
  });

  test('TC_UP_015: Verify visual border highlight state when dragging file over dropzone', async ({ uploadPage }) => {
    const file = uploadCopy(SAMPLE_PDF, 'DRAG');
    await expect(uploadPage.dropZone).toHaveClass(/border-blue-400/);
    await uploadPage.dragOver([UploadPage.toDroppedFile(file, 'application/pdf')]);
    // Active state: darker border and background while the file is held over the zone
    await expect(uploadPage.dropZone).toHaveClass(/border-blue-500/);
    await expect(uploadPage.dropZone).toHaveClass(/bg-blue-100/);
  });

  test('TC_UP_016: Verify selected file name and size display before clicking Process', async ({ uploadPage }) => {
    const file = uploadCopy(SAMPLE_XLSX, 'NAMESIZE');
    const sizeMb = (fs.statSync(file).size / (1024 * 1024)).toFixed(2);
    await uploadPage.selectDocumentType('Purchase Order');
    await uploadPage.chooseFileViaDialog(file);
    await expect(uploadPage.selectedFileName(path.basename(file))).toBeVisible();
    await expect(uploadPage.selectedFileSize).toHaveText(`${sizeMb} MB`);
  });

  test('TC_UP_017: Verify replacing attached file with a different file before processing', async ({ uploadPage }) => {
    const fileA = uploadCopy(SAMPLE_PDF, 'FILE_A');
    const fileB = uploadCopy(SAMPLE_XLSX, 'FILE_B');
    await uploadPage.selectDocumentType('Purchase Order');
    await uploadPage.chooseFileViaDialog(fileA);
    await expect(uploadPage.selectedFileName(path.basename(fileA))).toBeVisible();
    await uploadPage.removeFileButton.click();
    await uploadPage.chooseFileViaDialog(fileB);
    await expect(uploadPage.selectedFileName(path.basename(fileA))).toHaveCount(0);
    await expect(uploadPage.selectedFileName(path.basename(fileB))).toBeVisible();
  });

  test('TC_UP_018: Verify removal of attached file prior to submission', async ({ uploadPage }) => {
    const file = uploadCopy(SAMPLE_PDF, 'REMOVE');
    await uploadPage.selectDocumentType('Purchase Order');
    await uploadPage.attachFile(file);
    await expect(uploadPage.selectedFileName(path.basename(file))).toBeVisible();
    await uploadPage.removeFileButton.click();
    await expect(uploadPage.selectedFileName(path.basename(file))).toHaveCount(0);
    await expect(uploadPage.processButton).toHaveCount(0);
    await expect(uploadPage.dropZonePrompt).toBeVisible();
    await expect(uploadPage.chooseFileButton).toBeVisible();
  });

  // =========================================================================
  // Rejected files
  // =========================================================================

  test('TC_UP_019: Verify error when uploading image formats (JPG, PNG)', async ({ uploadPage }) => {
    const out = test.info().outputPath();
    await expectRejectedOnAttach(uploadPage, createMockFile('photo.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), out), INVALID_FORMAT_ERROR);
    await expectRejectedOnAttach(uploadPage, createMockFile('photo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), out), INVALID_FORMAT_ERROR);
  });

  test('TC_UP_020: Verify error when uploading executable file (.exe, .bat)', async ({ uploadPage }) => {
    const out = test.info().outputPath();
    await expectRejectedOnAttach(uploadPage, createMockFile('setup.exe', 'MZ_EXECUTABLE_TEST', out), INVALID_FORMAT_ERROR);
    await expectRejectedOnAttach(uploadPage, createMockFile('setup.bat', '@echo off', out), INVALID_FORMAT_ERROR);
  });

  test('TC_UP_021: Verify error when uploading plain text file (.txt)', async ({ uploadPage }) => {
    await expectRejectedOnAttach(uploadPage, createMockFile('notes.txt', 'Plain text notes file', test.info().outputPath()), INVALID_FORMAT_ERROR);
  });

  test('TC_UP_022: Verify error when uploading file without file extension', async ({ uploadPage }) => {
    await expectRejectedOnAttach(uploadPage, createMockFile('invoice_no_ext', 'Generic content without extension', test.info().outputPath()), INVALID_FORMAT_ERROR);
  });

  test('TC_UP_023: Verify error when uploading zero-byte (empty) file', async ({ uploadPage }) => {
    await uploadPage.selectDocumentType('Purchase Order');
    await expectRejectedOnAttach(uploadPage, createMockFile('empty.pdf', '', test.info().outputPath()), EMPTY_FILE_ERROR);
  });

  test(
    'TC_UP_024: Verify error when uploading corrupted PDF file',
    { annotation: { type: 'issue', description: 'Known bug: the Upload page accepts a corrupted PDF (no error; uploadDocument returns 202 "processing").' } },
    async ({ uploadPage }) => {
    // Not a PDF inside, unique name: the Upload page must not let it through (error, no upload accepted)
    const file = createMockFile(`${uniqueName('UP_CORRUPT')}.pdf`, 'NOT_A_VALID_PDF_HEADER_JUST_RANDOM_TEXT_123456', test.info().outputPath());
    await uploadPage.selectDocumentType('Purchase Order');
    await uploadPage.attachFile(file);
    let result: UploadResult | undefined;
    if ((await uploadPage.processButton.count()) > 0 && (await uploadPage.processButton.isEnabled())) {
      result = await uploadPage.submitUpload();
      test.info().annotations.push({ type: 'note', description: `uploadDocument HTTP ${result.status}: ${JSON.stringify(result.body).slice(0, 300)}` });
    }
    await expect(uploadPage.errorMessage, 'the corrupted file is rejected on the Upload page').toBeVisible({ timeout: 15000 });
    expect(result?.status, 'the corrupted file is not accepted for processing').not.toBe(202);
    },
  );

  test(`TC_UP_025: Verify upload block for files exceeding maximum size limit (>${MAX_SIZE_MB}MB)`, async ({ uploadPage }) => {
    const sizeMb = MAX_SIZE_MB + 1;
    const huge = createLargeFile(`oversized-${sizeMb}mb.pdf`, sizeMb, test.info().outputPath());
    await uploadPage.selectDocumentType('Purchase Order');
    await expectRejectedOnAttach(uploadPage, huge, `File is too large (${sizeMb}.00 MB). Maximum file size is ${MAX_SIZE_MB}MB.`);
    await expect(uploadPage.acceptedFormatsHint).toContainText(`Max file size: ${MAX_SIZE_MB}MB`);
  });

  test('TC_UP_026: Verify multi-file selection rejection when only single file allowed', async ({ uploadPage }) => {
    const file1 = uploadCopy(SAMPLE_PDF, 'MULTI_1');
    const file2 = uploadCopy(SAMPLE_PDF, 'MULTI_2');
    // The file input takes a single file
    expect(await uploadPage.fileInput.getAttribute('multiple'), 'file input has no "multiple" attribute').toBeNull();
    await uploadPage.selectDocumentType('Purchase Order');
    // Two files dropped at once: only one is kept
    await uploadPage.dropFiles([UploadPage.toDroppedFile(file1, 'application/pdf'), UploadPage.toDroppedFile(file2, 'application/pdf')]);
    await expect(uploadPage.selectedFileName(path.basename(file1))).toBeVisible();
    await expect(uploadPage.selectedFileName(path.basename(file2))).toHaveCount(0);
    await expect(uploadPage.removeFileButton).toHaveCount(1);
  });

  test('TC_UP_027: Verify duplicate file name collision detection and handling', async ({ uploadPage }) => {
    test.skip(!state.pdfFileName, 'Needs the PDF uploaded by TC_UP_006, which did not upload in this run');
    // A file with exactly the name TC_UP_006 uploaded
    const again = createNamedCopy(SAMPLE_PDF, state.pdfFileName!, test.info().outputPath());
    await uploadPage.selectDocumentType('Purchase Order');
    await uploadPage.attachFile(again);
    await expect(uploadPage.selectedFileName(state.pdfFileName!)).toBeVisible();
    const result = await uploadPage.submitUpload();
    expect(result.status, `uploadDocument: ${JSON.stringify(result.body).slice(0, 300)}`).not.toBe(202);
    await expect(uploadPage.errorMessage).toHaveText(DUPLICATE_ERROR);
  });

  // =========================================================================
  // Upload button, progress, notification, navigation, library
  // =========================================================================

  test('TC_UP_028: Verify Process button state before file attachment', async ({ uploadPage }) => {
    const sent = trackUploadRequests(uploadPage.page);
    await uploadPage.selectDocumentType('Purchase Order');
    // No file: no Upload and Process button, the drop zone asks for a file
    await expect(uploadPage.processButton).toHaveCount(0);
    await expect(uploadPage.dropZonePrompt).toBeVisible();
    await expect(uploadPage.chooseFileButton).toBeVisible();
    expect(sent).toEqual([]);
  });

  test('TC_UP_029: Verify success notification toast message upon upload completion', async ({ uploadPage, page }) => {
    const fileName = await uploadValid(uploadPage, uploadCopy(SAMPLE_SIF, 'TOAST'), 'Quote Request');
    const toast = successToast(page, fileName);
    await expect(toast).toContainText(`"${fileName}" has been uploaded and is now being processed.`);
  });

  test("TC_UP_030: Verify 'Back to Dashboard' navigation link", async ({ uploadPage, page }) => {
    await expect(uploadPage.backToDashboardLink).toBeVisible();
    await uploadPage.backToDashboardLink.click();
    // Screenshot once the Dashboard has fully loaded
    await waitForDashboardLoaded(page);
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('button', { name: 'Upload New File', exact: true })).toBeVisible();
  });

  test('TC_UP_031: Verify newly uploaded document appears in Document Library table', async ({ page }) => {
    test.skip(!state.pdfFileName, 'Needs the PDF uploaded by TC_UP_006, which did not upload in this run');
    const documents = new DocumentsPage(page);
    await documents.navigate();
    await documents.searchDocument(state.pdfFileName!);
    const row = documents.rowByName(state.pdfFileName!);
    await expect(row).toHaveCount(1);
    await expect(documents.nameCell(row)).toContainText(state.pdfFileName!);
    await expect(documents.statusBadge(row)).toHaveText(/^(Processing|Extracted|Reviewed|Failed)$/i);
  });
});
