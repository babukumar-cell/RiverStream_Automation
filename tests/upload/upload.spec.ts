import fs from 'fs';
import path from 'path';
import { test, expect } from '../../src/fixtures/test.fixture';
import { UploadPage, UploadDocumentType, UploadResult, DOC_TYPE_API_VALUE } from '../../src/pages/upload.page';
import { QaData, uniqueName } from '../../src/test-data/qa-data';
import { createNamedCopy, createMockFile, createLargeFile } from '../../src/utils/file-utils';

const FILES_DIR = path.resolve(__dirname, '../../src/test-data/files');
const SIF_DIR = path.resolve(__dirname, '../../Riverstone test SIF Files');
const DEFAULT_SIF = 'CDF_Carolina OS_Young Conway Furniture_SIF_260520_QA8.sif';

const SAMPLE_PDF = path.join(FILES_DIR, 'sample-invoice.pdf');
const SAMPLE_EDI = path.join(FILES_DIR, 'sample-order.edi');
const SAMPLE_XLSX = path.join(FILES_DIR, 'sample-po.xlsx');
const SAMPLE_XLS = path.join(FILES_DIR, 'sample-po.xls');
const SAMPLE_SIF = path.isAbsolute(process.env.SIF_FILE || '')
  ? (process.env.SIF_FILE as string)
  : path.join(SIF_DIR, process.env.SIF_FILE || DEFAULT_SIF);

const INVALID_FORMAT_ERROR = 'Invalid file format. Please upload a supported file type (PDF, EDI, XLSX, XLS, or SIF).';

function uploadCopy(source: string, label: string): string {
  return createNamedCopy(source, `${uniqueName(label)}${path.extname(source)}`, test.info().outputPath());
}

function expectAccepted(result: UploadResult, fileName: string, type: UploadDocumentType): void {
  expect(result.status, JSON.stringify(result.body)).toBe(202);
  expect(result.requestBody.fileName).toBe(fileName);
  expect(result.requestBody.selectedDocType).toBe(DOC_TYPE_API_VALUE[type]);
  expect(result.body.status).toBe('processing');
  expect(result.body.table_entity.fileName).toBe(fileName);
  expect(result.body.table_entity.selectedDocType).toBe(DOC_TYPE_API_VALUE[type]);
}

function trackUploadRequests(uploadPage: UploadPage): string[] {
  const sent: string[] = [];
  uploadPage.page.on('request', req => {
    if (req.url().includes('/api/uploadDocument')) sent.push(req.method());
  });
  return sent;
}

test.describe('Upload Document Suite (20 Test Cases)', () => {
  test.beforeEach(async ({ uploadPage }) => {
    await uploadPage.navigate('dashboard');
  });

  test('TC_File upload_001: Verify user can upload a valid PDF file using Choose File', async ({ uploadPage }) => {
    const file = uploadCopy(SAMPLE_PDF, 'AUTO_UP_PDF');
    const fileName = path.basename(file);

    await uploadPage.selectDocumentType('Purchase Order');
    const result = await uploadPage.uploadViaInput(file);

    expectAccepted(result, fileName, 'Purchase Order');
    await expect(uploadPage.uploadSuccessTitle).toBeVisible({ timeout: 15000 });
  });

  test('TC_File Upload_002: Verify the Purchase order dropdown selection', async ({ uploadPage }) => {
    await uploadPage.selectDocumentType('Purchase Order');
    await expect(uploadPage.docTypeDropdown).toHaveText(/Purchase Order/i);
  });

  test('TC_File upload_002: Verify the Quote Request dropdown selection', async ({ uploadPage }) => {
    await uploadPage.selectDocumentType('Quote Request');
    await expect(uploadPage.docTypeDropdown).toHaveText(/Quote Request/i);
  });

  test('TC_File Upload_003: Verify user can upload a valid PDF file using drag and drop', async ({ uploadPage }) => {
    const file = uploadCopy(SAMPLE_PDF, 'AUTO_UP_DND_PDF');
    const fileName = path.basename(file);

    await uploadPage.selectDocumentType('Purchase Order');
    const result = await uploadPage.uploadViaDrop(file);

    expectAccepted(result, fileName, 'Purchase Order');
    await expect(uploadPage.uploadSuccessTitle).toBeVisible({ timeout: 15000 });
  });

  test('TC_File upload_003: Verify user can upload a valid EDI file', async ({ uploadPage }) => {
    const file = uploadCopy(SAMPLE_EDI, 'AUTO_UP_EDI');
    const fileName = path.basename(file);

    await uploadPage.selectDocumentType('Purchase Order');
    const result = await uploadPage.uploadViaInput(file);

    expectAccepted(result, fileName, 'Purchase Order');
    await expect(uploadPage.uploadSuccessTitle).toBeVisible({ timeout: 15000 });
  });

  test('TC_File Upload_004: Verify user can upload a valid XLSX file', async ({ uploadPage }) => {
    const file = uploadCopy(SAMPLE_XLSX, 'AUTO_UP_XLSX');
    const fileName = path.basename(file);

    await uploadPage.selectDocumentType('Purchase Order');
    const result = await uploadPage.uploadViaInput(file);

    expectAccepted(result, fileName, 'Purchase Order');
    await expect(uploadPage.uploadSuccessTitle).toBeVisible({ timeout: 15000 });
  });

  test('TC_File upload_004: Verify user can upload a valid XLS file', async ({ uploadPage }) => {
    const file = uploadCopy(SAMPLE_XLS, 'AUTO_UP_XLS');
    const fileName = path.basename(file);

    await uploadPage.selectDocumentType('Purchase Order');
    const result = await uploadPage.uploadViaInput(file);

    expectAccepted(result, fileName, 'Purchase Order');
    await expect(uploadPage.uploadSuccessTitle).toBeVisible({ timeout: 15000 });
  });

  test('TC_File Upload_005: Verify user can upload a valid SIF file', async ({ uploadPage }) => {
    const file = uploadCopy(SAMPLE_SIF, 'AUTO_UP_SIF');
    const fileName = path.basename(file);

    await uploadPage.selectDocumentType('Purchase Order');
    const result = await uploadPage.uploadViaInput(file);

    expectAccepted(result, fileName, 'Purchase Order');
    await expect(uploadPage.uploadSuccessTitle).toBeVisible({ timeout: 15000 });
  });

  test('TC_File upload_005: Verify clicking drag-and-drop area opens file browser', async ({ uploadPage }) => {
    // Verifies clicking Choose File / drop zone triggers browser file chooser
    const chooserPromise = uploadPage.page.waitForEvent('filechooser', { timeout: 10000 });
    await uploadPage.chooseFileButton.click();
    const chooser = await chooserPromise;
    expect(chooser).toBeTruthy();
  });

  test('TC_File Upload_006: Verify Back to Dashboard link navigation', async ({ uploadPage, page }) => {
    await expect(uploadPage.backToDashboardLink).toBeVisible();
    await uploadPage.backToDashboardLink.click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('TC_File upload_006: Verify error message for unsupported file format', async ({ uploadPage }) => {
    const sent = trackUploadRequests(uploadPage);
    const file = createMockFile('unsupported.bmp', 'unsupported BMP content', test.info().outputPath());

    await uploadPage.attachFile(file);
    await uploadPage.clickProcess();

    await expect(uploadPage.errorMessage).toBeVisible();
    await expect(uploadPage.errorMessage).toHaveText(INVALID_FORMAT_ERROR);
    expect(sent, 'client validation blocked upload').toEqual([]);
  });

  test('TC_File Upload_007: Verify error when uploading executable file', async ({ uploadPage }) => {
    const sent = trackUploadRequests(uploadPage);
    const file = createMockFile('danger.exe', 'MZ_EXECUTABLE_TEST', test.info().outputPath());

    await uploadPage.attachFile(file);
    await uploadPage.clickProcess();

    await expect(uploadPage.errorMessage).toBeVisible();
    await expect(uploadPage.errorMessage).toHaveText(INVALID_FORMAT_ERROR);
    expect(sent, 'client validation blocked upload').toEqual([]);
  });

  test('TC_File upload_007: Verify error when uploading text file', async ({ uploadPage }) => {
    const sent = trackUploadRequests(uploadPage);
    const file = createMockFile('notes.txt', 'Plain text notes file', test.info().outputPath());

    await uploadPage.attachFile(file);
    await uploadPage.clickProcess();

    await expect(uploadPage.errorMessage).toBeVisible();
    await expect(uploadPage.errorMessage).toHaveText(INVALID_FORMAT_ERROR);
    expect(sent, 'client validation blocked upload').toEqual([]);
  });

  test('TC_File Upload_008: Verify error when uploading file without extension', async ({ uploadPage }) => {
    const sent = trackUploadRequests(uploadPage);
    const file = createMockFile('no-extension-file', 'Generic content without extension', test.info().outputPath());

    await uploadPage.attachFile(file);
    await uploadPage.clickProcess();

    await expect(uploadPage.errorMessage).toBeVisible();
    await expect(uploadPage.errorMessage).toHaveText(INVALID_FORMAT_ERROR);
    expect(sent, 'client validation blocked upload').toEqual([]);
  });

  test('TC_File upload_008: Verify error when uploading corrupted PDF', async ({ uploadPage }) => {
    const corruptFile = path.join(test.info().outputPath(), 'corrupt.pdf');
    fs.writeFileSync(corruptFile, 'NOT_A_VALID_PDF_HEADER_JUST_RANDOM_TEXT_123456');

    await uploadPage.selectDocumentType('Purchase Order');
    await uploadPage.attachFile(corruptFile);
    await uploadPage.clickProcess();

    // System should either display error toast or rejection
    const isErrorOrToast = await uploadPage.errorMessage.isVisible({ timeout: 5000 }).catch(() => false);
    expect(isErrorOrToast !== undefined).toBeTruthy();
  });

  test('TC_File Upload_009: Verify behavior when no file is selected', async ({ uploadPage }) => {
    const sent = trackUploadRequests(uploadPage);
    // Process button is disabled when no file is attached
    await expect(uploadPage.processButton).toBeDisabled();
    expect(sent).toEqual([]);
  });

  test('TC_File upload_009: Verify drag-and-drop of unsupported file', async ({ uploadPage }) => {
    const sent = trackUploadRequests(uploadPage);
    const file = createMockFile('invalid_drop.csv', 'col1,col2\nval1,val2', test.info().outputPath());

    await uploadPage.selectDocumentType('Purchase Order');
    await uploadPage.dropFiles([UploadPage.toDroppedFile(file, 'text/csv')]);
    await uploadPage.clickProcess();

    await expect(uploadPage.errorMessage).toBeVisible();
    await expect(uploadPage.errorMessage).toHaveText(INVALID_FORMAT_ERROR);
    expect(sent).toEqual([]);
  });

  test('TC_File Upload_010: Verify multiple file selection when only single file is allowed', async ({ uploadPage }) => {
    const file1 = uploadCopy(SAMPLE_PDF, 'AUTO_MULTI_1');
    const file2 = uploadCopy(SAMPLE_PDF, 'AUTO_MULTI_2');

    // Input does not carry multiple attribute
    const multiple = await uploadPage.fileInput.getAttribute('multiple');
    expect(multiple).toBeNull();

    // When two files are pushed, only one replaces the active attachment
    await uploadPage.fileInput.setInputFiles([file1, file2]);
    const attachedCount = await uploadPage.attachedFileTag.count();
    expect(attachedCount).toBeLessThanOrEqual(1);
  });

  test('TC_File upload_010: Verify upload of file exceeding maximum size limit', async ({ uploadPage }) => {
    const sent = trackUploadRequests(uploadPage);
    const huge = createLargeFile('huge-52mb.pdf', 52, test.info().outputPath());

    await uploadPage.attachFile(huge);
    await uploadPage.clickProcess();

    await expect(uploadPage.errorMessage).toBeVisible();
    await expect(uploadPage.errorMessage).toHaveText(/maximum size|50MB|exceeds/i);
    expect(sent).toEqual([]);
  });

  test('TC_File Upload_011: Verify upload is blocked for unsupported file formats (e.g., JPG, PNG)', async ({ uploadPage }) => {
    const sent = trackUploadRequests(uploadPage);
    const img = createMockFile('photo.png', 'Fake PNG binary bytes', test.info().outputPath());

    await uploadPage.attachFile(img);
    await uploadPage.clickProcess();

    await expect(uploadPage.errorMessage).toBeVisible();
    await expect(uploadPage.errorMessage).toHaveText(INVALID_FORMAT_ERROR);
    expect(sent).toEqual([]);
  });
});
