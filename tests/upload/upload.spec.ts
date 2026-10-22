import fs from 'fs';
import path from 'path';
import { test, expect } from '../../src/fixtures/test.fixture';
import { UploadPage, UploadDocumentType, UploadResult, DOC_TYPE_API_VALUE } from '../../src/pages/upload.page';
import { QaData, uniqueName } from '../../src/test-data/qa-data';
import { createNamedCopy, createMockFile, createLargeFile } from '../../src/utils/file-utils';

/**
 * Upload Document (TC_UP_001 - TC_UP_037).
 *
 * Every successful upload creates a real document in QA. Uploads are kept to the cases that need
 * one, and every uploaded file is named AUTO_UP<nnn>_... (via uniqueName) so leftovers are
 * traceable. The Document Library has no delete action, so uploaded documents cannot be removed
 * from the UI. Negative cases are validated client-side and never reach the API; tests assert that.
 */

const FILES_DIR = path.resolve(__dirname, '../../src/test-data/files');
const SIF_DIR = path.resolve(__dirname, '../../Riverstone test SIF Files');
const DEFAULT_SIF = 'CDF_Carolina OS_Young Conway Furniture_SIF_260520_QA8.sif';

const SAMPLE_PDF = path.join(FILES_DIR, 'sample-invoice.pdf');
const SAMPLE_EDI = path.join(FILES_DIR, 'sample-order.edi');
const SAMPLE_XLSX = path.join(FILES_DIR, 'sample-po.xlsx');
const SAMPLE_XLS = path.join(FILES_DIR, 'sample-po.xls');
const MULTI_PAGE_PDF = path.join(FILES_DIR, 'sample-po-12-pages.pdf');
const SAMPLE_SIF = path.isAbsolute(process.env.SIF_FILE || '')
  ? (process.env.SIF_FILE as string)
  : path.join(SIF_DIR, process.env.SIF_FILE || DEFAULT_SIF);

const INVALID_FORMAT_ERROR = 'Invalid file format. Please upload a supported file type (PDF, EDI, XLSX, XLS, or SIF).';
const EMPTY_FILE_ERROR = 'The selected file is empty. Please choose a valid file.';
const DUPLICATE_ERROR = 'File with this name already exists.';

/** Copies a fixture into this test's output folder under a unique AUTO_ name. */
function uploadCopy(source: string, label: string): string {
  return createNamedCopy(source, `${uniqueName(label)}${path.extname(source)}`, test.info().outputPath());
}

/** Asserts the uploadDocument API accepted the file for processing with the chosen type. */
function expectAccepted(result: UploadResult, fileName: string, type: UploadDocumentType): void {
  expect(result.status, JSON.stringify(result.body)).toBe(202);
  expect(result.requestBody.fileName).toBe(fileName);
  expect(result.requestBody.selectedDocType).toBe(DOC_TYPE_API_VALUE[type]);
  expect(result.body.status).toBe('processing');
  expect(result.body.table_entity.fileName).toBe(fileName);
  expect(result.body.table_entity.selectedDocType).toBe(DOC_TYPE_API_VALUE[type]);
}

/** Records every uploadDocument request so negative tests can prove nothing was sent. */
function trackUploadRequests(uploadPage: UploadPage): string[] {
  const sent: string[] = [];
  uploadPage.page.on('request', req => {
    if (req.url().includes('/api/uploadDocument')) sent.push(req.method());
  });
  return sent;
}

test.describe('Upload Document', () => {
  test.beforeEach(async ({ uploadPage }) => {
    await uploadPage.navigate('dashboard');
  });

  // ===========================================================================
  // Document type (TC_UP_001 - TC_UP_005)
  // ===========================================================================

  test('TC_UP_001: Verify Document Type dropdown displays configured options', async ({ uploadPage, page }) => {
    await expect(uploadPage.documentTypeDropdown).toHaveText('Choose a document type');
    await uploadPage.documentTypeDropdown.click();
    await expect(page.getByRole('option')).toHaveText(['Quote Request', 'Purchase Order']);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('option')).toHaveCount(0);
  });

  test('TC_UP_002: Verify selection of Quote Request document type', async ({ uploadPage }) => {
    await uploadPage.selectDocumentType('Quote Request');
    await expect(uploadPage.documentTypeDropdown).toHaveText('Quote Request');
  });

  test('TC_UP_003: Verify selection of Purchase Order document type', async ({ uploadPage }) => {
    await uploadPage.selectDocumentType('Purchase Order');
    await expect(uploadPage.documentTypeDropdown).toHaveText('Purchase Order');
  });

  test('TC_UP_004: Verify behavior when uploading without selecting a Document Type', async ({ uploadPage }) => {
    test.info().annotations.push({
      type: 'note',
      description: 'UX gap: a file can be attached before a document type is chosen, and no message explains why "Upload and Process" is disabled.',
    });
    const sent = trackUploadRequests(uploadPage);
    const file = createNamedCopy(SAMPLE_PDF, 'invoice.pdf', test.info().outputPath());

    await uploadPage.attachFile(file);
    await expect(uploadPage.selectedFileName('invoice.pdf')).toBeVisible();
    await expect(uploadPage.documentTypeDropdown).toHaveText('Choose a document type');
    await expect(uploadPage.uploadAndProcessButton).toBeDisabled();

    // Choosing a type is what unlocks the upload.
    await uploadPage.selectDocumentType('Purchase Order');
    await expect(uploadPage.uploadAndProcessButton).toBeEnabled();
    expect(sent, 'no upload request may be sent without a document type').toHaveLength(0);
  });

  test('TC_UP_005: Verify Document Type persistence when replacing attached file', async ({ uploadPage }) => {
    const out = test.info().outputPath();
    const quote1 = createNamedCopy(SAMPLE_SIF, 'quote1.sif', out);
    const quote2 = createNamedCopy(SAMPLE_SIF, 'quote2.sif', out);

    await uploadPage.selectDocumentType('Quote Request');
    await uploadPage.attachFile(quote1);
    await expect(uploadPage.selectedFileName('quote1.sif')).toBeVisible();
    await uploadPage.attachFile(quote2);

    await expect(uploadPage.selectedFileName('quote2.sif')).toBeVisible();
    await expect(uploadPage.documentTypeDropdown).toHaveText('Quote Request');
  });

  // ===========================================================================
  // Valid uploads via Choose File (TC_UP_006 - TC_UP_011)
  // ===========================================================================

  test('TC_UP_006: Verify user can upload a valid PDF file using Choose File', async ({ uploadPage, page }) => {
    const file = uploadCopy(SAMPLE_PDF, 'UP006_PDF');
    const name = path.basename(file);

    await uploadPage.selectDocumentType('Purchase Order');
    await uploadPage.chooseFileViaDialog(file);
    await expect(uploadPage.selectedFileName(name)).toBeVisible();
    const result = await uploadPage.submitUpload();

    expectAccepted(result, name, 'Purchase Order');
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('TC_UP_007: Verify user can upload a valid EDI file using Choose File', async ({ uploadPage }) => {
    const file = uploadCopy(SAMPLE_EDI, 'UP007_EDI');
    const result = await uploadPage.uploadDocument(file, 'Purchase Order');
    expectAccepted(result, path.basename(file), 'Purchase Order');
  });

  test('TC_UP_008: Verify user can upload a valid modern Excel workbook (.xlsx)', async ({ uploadPage }) => {
    const file = uploadCopy(SAMPLE_XLSX, 'UP008_XLSX');
    const result = await uploadPage.uploadDocument(file, 'Purchase Order');
    expectAccepted(result, path.basename(file), 'Purchase Order');
  });

  test('TC_UP_009: Verify user can upload a valid legacy Excel spreadsheet (.xls)', async ({ uploadPage }) => {
    const file = uploadCopy(SAMPLE_XLS, 'UP009_XLS');
    // Guard the fixture itself: a real BIFF8/OLE2 workbook, not a renamed text file.
    expect(fs.readFileSync(file).subarray(0, 8).toString('hex')).toBe('d0cf11e0a1b11ae1');
    const result = await uploadPage.uploadDocument(file, 'Purchase Order');
    expectAccepted(result, path.basename(file), 'Purchase Order');
  });

  test('TC_UP_010: Verify user can upload a valid Riverstone SIF quotation file (.sif)', async ({ uploadPage }) => {
    const file = uploadCopy(SAMPLE_SIF, 'UP010_SIF');
    const result = await uploadPage.uploadDocument(file, 'Quote Request');
    expectAccepted(result, path.basename(file), 'Quote Request');
  });

  test('TC_UP_011: Verify upload of multi-page complex PDF document (>10 pages)', async ({ uploadPage }) => {
    const file = uploadCopy(MULTI_PAGE_PDF, 'UP011_MultiPage');
    const pageCount = (fs.readFileSync(file, 'latin1').match(/\/Type\s*\/Page(?!s)/g) || []).length;
    expect(pageCount, 'fixture must have more than 10 pages').toBeGreaterThan(10);

    const result = await uploadPage.uploadDocument(file, 'Purchase Order');
    expectAccepted(result, path.basename(file), 'Purchase Order');
  });

  // ===========================================================================
  // Drag and drop (TC_UP_012 - TC_UP_015)
  // ===========================================================================

  test('TC_UP_012: Verify user can upload a valid PDF file using Drag and Drop', async ({ uploadPage, page }) => {
    const file = uploadCopy(SAMPLE_PDF, 'UP012_DragPDF');
    const name = path.basename(file);

    await uploadPage.selectDocumentType('Purchase Order');
    await uploadPage.dropFiles([UploadPage.toDroppedFile(file, 'application/pdf')]);
    await expect(uploadPage.selectedFileName(name)).toBeVisible();
    const result = await uploadPage.submitUpload();

    expectAccepted(result, name, 'Purchase Order');
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('TC_UP_013: Verify user can upload a valid SIF file using Drag and Drop', async ({ uploadPage, page }) => {
    const file = uploadCopy(SAMPLE_SIF, 'UP013_DragSIF');
    const name = path.basename(file);

    await uploadPage.selectDocumentType('Quote Request');
    await uploadPage.dropFiles([UploadPage.toDroppedFile(file)]);
    await expect(uploadPage.selectedFileName(name)).toBeVisible();
    const result = await uploadPage.submitUpload();

    expectAccepted(result, name, 'Quote Request');
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('TC_UP_014: Verify file selection browser trigger in upload container', async ({ uploadPage, page }) => {
    // The Choose File button inside the container opens a single-file chooser.
    const buttonChooser = page.waitForEvent('filechooser');
    await uploadPage.chooseFileButton.click();
    const chooser = await buttonChooser;
    expect(chooser.isMultiple()).toBe(false);
    await expect(uploadPage.dropZone).toBeVisible();
  });

  test('TC_UP_015: Verify visual border highlight state when dragging file over dropzone', async ({ uploadPage }) => {
    const idle = await uploadPage.dropZoneBackground();
    await uploadPage.dragOver([{ name: 'invoice.pdf', mimeType: 'application/pdf', buffer: fs.readFileSync(SAMPLE_PDF) }]);
    await expect.poll(() => uploadPage.dropZoneBackground(), { message: 'drop zone should highlight on drag-over' }).not.toBe(idle);

    await uploadPage.dragLeave();
    await expect.poll(() => uploadPage.dropZoneBackground(), { message: 'highlight should clear on drag-leave' }).toBe(idle);
  });

  // ===========================================================================
  // File selection, replacement and removal (TC_UP_016 - TC_UP_018)
  // ===========================================================================

  test('TC_UP_016: Verify selected file name and size display before clicking Process', async ({ uploadPage }) => {
    const file = createNamedCopy(SAMPLE_XLS, 'report.xls', test.info().outputPath());
    const expectedSize = `${(fs.statSync(file).size / (1024 * 1024)).toFixed(2)} MB`;

    await uploadPage.attachFile(file);

    await expect(uploadPage.selectedFileName('report.xls')).toBeVisible();
    await expect(uploadPage.selectedFileSize).toHaveText(expectedSize);
    await expect(uploadPage.uploadAndProcessButton).toBeVisible();
  });

  test('TC_UP_017: Verify replacing attached file with a different file before processing', async ({ uploadPage }) => {
    const out = test.info().outputPath();
    const fileA = createNamedCopy(SAMPLE_PDF, 'fileA.pdf', out);
    const fileB = createNamedCopy(SAMPLE_EDI, 'fileB.edi', out);

    await uploadPage.attachFile(fileA);
    await expect(uploadPage.selectedFileName('fileA.pdf')).toBeVisible();
    await uploadPage.attachFile(fileB);

    await expect(uploadPage.selectedFileName('fileB.edi')).toBeVisible();
    await expect(uploadPage.selectedFileName('fileA.pdf')).toHaveCount(0);
  });

  test('TC_UP_018: Verify removal of attached file prior to submission', async ({ uploadPage }) => {
    const file = createNamedCopy(SAMPLE_PDF, 'invoice.pdf', test.info().outputPath());
    await uploadPage.attachFile(file);
    await expect(uploadPage.selectedFileName('invoice.pdf')).toBeVisible();

    await uploadPage.removeFileButton.click();

    await expect(uploadPage.selectedFileName('invoice.pdf')).toHaveCount(0);
    await expect(uploadPage.dropZonePrompt).toBeVisible();
    await expect(uploadPage.chooseFileButton).toBeVisible();
    await expect(uploadPage.uploadAndProcessButton).toHaveCount(0);
  });

  // ===========================================================================
  // Validation and error handling (TC_UP_019 - TC_UP_027)
  // ===========================================================================

  test('TC_UP_019: Verify error when uploading image formats (JPG, PNG)', async ({ uploadPage }) => {
    const sent = trackUploadRequests(uploadPage);
    const out = test.info().outputPath();
    await uploadPage.selectDocumentType('Purchase Order');

    for (const file of [
      createMockFile('photo.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), out),
      createMockFile('scan.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), out),
    ]) {
      await uploadPage.attachFile(file);
      await expect(uploadPage.errorMessage).toHaveText(INVALID_FORMAT_ERROR);
      await expect(uploadPage.uploadAndProcessButton).toHaveCount(0);
    }
    expect(sent).toHaveLength(0);
  });

  test('TC_UP_020: Verify error when uploading executable file (.exe, .bat)', async ({ uploadPage }) => {
    const sent = trackUploadRequests(uploadPage);
    const out = test.info().outputPath();
    await uploadPage.selectDocumentType('Purchase Order');

    for (const file of [
      createMockFile('setup.exe', Buffer.from([0x4d, 0x5a, 0x90, 0x00]), out),
      createMockFile('install.bat', '@echo off\r\necho test\r\n', out),
    ]) {
      await uploadPage.attachFile(file);
      await expect(uploadPage.errorMessage).toHaveText(INVALID_FORMAT_ERROR);
      await expect(uploadPage.uploadAndProcessButton).toHaveCount(0);
    }
    expect(sent).toHaveLength(0);
  });

  test('TC_UP_021: Verify error when uploading plain text file (.txt)', async ({ uploadPage }) => {
    const sent = trackUploadRequests(uploadPage);
    await uploadPage.selectDocumentType('Purchase Order');
    await uploadPage.attachFile(createMockFile('notes.txt', 'This is a sample plain text notes file.', test.info().outputPath()));

    await expect(uploadPage.errorMessage).toHaveText(INVALID_FORMAT_ERROR);
    await expect(uploadPage.uploadAndProcessButton).toHaveCount(0);
    expect(sent).toHaveLength(0);
  });

  test('TC_UP_022: Verify error when uploading file without file extension', async ({ uploadPage }) => {
    const sent = trackUploadRequests(uploadPage);
    await uploadPage.selectDocumentType('Purchase Order');
    await uploadPage.attachFile(createMockFile('invoice_no_ext', '%PDF-1.4 invoice data without extension', test.info().outputPath()));

    await expect(uploadPage.errorMessage).toHaveText(INVALID_FORMAT_ERROR);
    await expect(uploadPage.uploadAndProcessButton).toHaveCount(0);
    expect(sent).toHaveLength(0);
  });

  test('TC_UP_023: Verify error when uploading zero-byte (empty) file', async ({ uploadPage }) => {
    const sent = trackUploadRequests(uploadPage);
    await uploadPage.selectDocumentType('Purchase Order');
    await uploadPage.attachFile(createMockFile('empty.pdf', Buffer.alloc(0), test.info().outputPath()));

    await expect(uploadPage.errorMessage).toHaveText(EMPTY_FILE_ERROR);
    await expect(uploadPage.uploadAndProcessButton).toHaveCount(0);
    expect(sent).toHaveLength(0);
  });

  test('TC_UP_024: Verify error when uploading corrupted PDF file', async ({ uploadPage, documentsPage }) => {
    test.setTimeout(180000);
    // The file has a PDF header but no readable structure, so it passes client validation and
    // must be reported as an extraction failure once the backend tries to read it.
    const name = `${uniqueName('UP024_Corrupt')}.pdf`;
    const file = createMockFile(name, '%PDF-1.4\n1 0 obj << /Type /Catalog >> garbage\n%%EOF_CORRUPTED', test.info().outputPath());
    const result = await uploadPage.uploadDocument(file, 'Purchase Order');
    expectAccepted(result, name, 'Purchase Order');

    const row = documentsPage.rowByName(name);
    await expect(async () => {
      await documentsPage.navigate();
      await documentsPage.searchDocument(name);
      await expect(documentsPage.statusBadge(row)).toHaveText('Extraction Failed', { timeout: 5000 });
    }).toPass({ timeout: 150000, intervals: [5000] });
    await expect(documentsPage.reExtractButton(row)).toBeEnabled();
  });

  test('TC_UP_025: Verify upload block for files exceeding maximum size limit (>50MB)', async ({ uploadPage }) => {
    const sent = trackUploadRequests(uploadPage);
    await expect(uploadPage.acceptedFormatsHint).toHaveText('Accepted formats: PDF, EDI, XLSX, XLS, SIF · Max file size: 50MB');
    await uploadPage.selectDocumentType('Purchase Order');
    await uploadPage.attachFile(createLargeFile('oversized.pdf', 51, test.info().outputPath()));

    await expect(uploadPage.errorMessage).toHaveText('File is too large (51.00 MB). Maximum file size is 50MB.');
    await expect(uploadPage.uploadAndProcessButton).toHaveCount(0);
    expect(sent).toHaveLength(0);
  });

  test('TC_UP_026: Verify multi-file selection rejection when only single file allowed', async ({ uploadPage, page }) => {
    // The file chooser only allows a single file...
    const chooserPromise = page.waitForEvent('filechooser');
    await uploadPage.chooseFileButton.click();
    expect((await chooserPromise).isMultiple()).toBe(false);

    // ...and dropping two files attaches only one of them.
    const pdf = fs.readFileSync(SAMPLE_PDF);
    await uploadPage.dropFiles([
      { name: 'file1.pdf', mimeType: 'application/pdf', buffer: pdf },
      { name: 'file2.pdf', mimeType: 'application/pdf', buffer: pdf },
    ]);
    await expect(uploadPage.selectedFileName('file1.pdf')).toBeVisible();
    await expect(uploadPage.selectedFileName('file2.pdf')).toHaveCount(0);
  });

  test('TC_UP_027: Verify duplicate file name collision detection and handling', async ({ uploadPage, documentsPage, page }) => {
    test.setTimeout(120000);
    // Reuse a PDF this suite uploaded earlier when one exists; otherwise upload one first.
    await documentsPage.navigate();
    const previous = await documentsPage.searchDocument(`${QaData.testPrefix}_UP006_PDF`);
    let existingName = previous.documents.map(d => d.fileName).find(n => n.endsWith('.pdf'));
    if (!existingName) {
      const seed = uploadCopy(SAMPLE_PDF, 'UP006_PDF');
      await uploadPage.navigate('dashboard');
      await uploadPage.uploadDocument(seed, 'Purchase Order');
      existingName = path.basename(seed);
    }

    await uploadPage.navigate('dashboard');
    await uploadPage.selectDocumentType('Purchase Order');
    await uploadPage.attachFile(createNamedCopy(SAMPLE_PDF, existingName, test.info().outputPath()));
    const result = await uploadPage.submitUpload();

    expect(result.status).toBe(409);
    await expect(uploadPage.errorMessage).toHaveText(DUPLICATE_ERROR);
    await expect(page).toHaveURL(/\/upload\?from=dashboard$/);
  });

  // ===========================================================================
  // Processing states and navigation (TC_UP_028 - TC_UP_032)
  // ===========================================================================

  test('TC_UP_028: Verify Process button state before file attachment', async ({ uploadPage }) => {
    await expect(uploadPage.chooseFileButton).toBeVisible();
    await expect(uploadPage.uploadAndProcessButton).toHaveCount(0);

    // Choosing a document type alone does not offer the upload action either.
    await uploadPage.selectDocumentType('Purchase Order');
    await expect(uploadPage.uploadAndProcessButton).toHaveCount(0);
  });

  test('TC_UP_029: Verify upload progress bar / loading indicator during upload', async ({ uploadPage, page }) => {
    // Hold the upload request so the in-flight state can be observed, then abort it so no
    // document is created.
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/uploadDocument', async route => {
      await held;
      await route.abort('failed');
    });

    await uploadPage.selectDocumentType('Purchase Order');
    await uploadPage.attachFile(createNamedCopy(SAMPLE_PDF, 'valid.pdf', test.info().outputPath()));
    await uploadPage.uploadAndProcessButton.click();

    await expect(uploadPage.uploadingButton).toBeVisible();
    await expect(uploadPage.uploadingButton).toBeDisabled();
    await expect(uploadPage.removeFileButton).toBeDisabled();
    release();
    await expect(uploadPage.uploadingButton).toHaveCount(0);
  });

  test('TC_UP_030: Verify success notification toast message upon upload completion', async ({ uploadPage, page }) => {
    test.info().annotations.push({
      type: 'issue',
      description: 'Non-critical UI observation: no success toast/confirmation is shown after an upload; the app redirects to the origin page.',
    });
    // The toast is a client reaction to a successful API response, so the response is stubbed
    // with the real 202 payload shape instead of creating another document in QA.
    const fileName = 'valid.sif';
    await page.route('**/api/uploadDocument', route => route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'processing',
        table_entity: { fileName, selectedDocType: 'QUOTE_REQUEST', fileProcessedFrom: 'web', status: 'processing' },
      }),
    }));

    await uploadPage.selectDocumentType('Quote Request');
    await uploadPage.attachFile(createNamedCopy(SAMPLE_SIF, fileName, test.info().outputPath()));
    await uploadPage.uploadAndProcessButton.click();

    await expect(uploadPage.uploadSuccessToast).toBeVisible();
  });

  test('TC_UP_031: Verify "Back to Dashboard" navigation link', async ({ uploadPage, dashboardPage, page }) => {
    await expect(uploadPage.backToDocumentsButton).toHaveCount(0);
    await uploadPage.backToDashboardButton.click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(dashboardPage.headerTitle).toHaveText('Dashboard');
  });

  test('TC_UP_032: Verify newly uploaded document appears in Document Library table', async ({ uploadPage, documentsPage, page }) => {
    test.setTimeout(120000);
    const file = uploadCopy(SAMPLE_PDF, 'UP032_Library');
    const name = path.basename(file);

    // Start from the Document Library so the upload returns there.
    await documentsPage.navigate();
    await documentsPage.uploadNewFileButton.click();
    await expect(page).toHaveURL(/\/upload\?from=documents$/);
    await uploadPage.waitForReady();
    const result = await uploadPage.uploadDocument(file, 'Purchase Order', 'documents');
    expectAccepted(result, name, 'Purchase Order');

    // Listed with the right format and type (filters) and an in-progress or finished status.
    await documentsPage.waitForTableLoaded();
    await documentsPage.expandFilters();
    await documentsPage.formatButton('PDF').click();
    await documentsPage.documentTypeButton('Purchase order').click();
    await documentsPage.applyFilters(req => !!req.fileTypeFilter?.includes('PDF') && !!req.docTypeFilter?.includes('PURCHASE_ORDER'));
    const listed = await documentsPage.searchDocument(name);

    expect(listed.request.fileTypeFilter).toEqual(['PDF']);
    expect(listed.request.docTypeFilter).toEqual(['PURCHASE_ORDER']);
    expect(listed.documents.map(d => d.fileName)).toContain(name);
    const row = documentsPage.rowByName(name);
    await expect(row).toHaveCount(1);
    await expect(documentsPage.statusBadge(row)).toHaveText(/^(Processing|Extracted)$/);
    await expect(documentsPage.uploadDateCell(row)).toHaveText(await documentsPage.formatUploadDate(new Date().toISOString()));
  });

  // ===========================================================================
  // Additional cases (TC_UP_033 - TC_UP_037)
  // ===========================================================================

  test('TC_UP_033: Verify batch upload of real Riverstone customer SIF files', async ({ uploadPage, documentsPage }, testInfo) => {
    test.setTimeout(240000);
    const count = parseInt(process.env.UPLOAD_COUNT || '2', 10);
    const sources = fs.readdirSync(SIF_DIR).filter(f => f.endsWith('.sif')).slice(0, count);
    expect(sources.length, `need ${count} SIF files in ${SIF_DIR}`).toBe(count);

    const uploaded: string[] = [];
    for (const [i, source] of sources.entries()) {
      const file = uploadCopy(path.join(SIF_DIR, source), `UP033_Batch${i + 1}`);
      if (i > 0) await uploadPage.navigate('dashboard');
      const result = await uploadPage.uploadDocument(file, 'Quote Request');
      expectAccepted(result, path.basename(file), 'Quote Request');
      uploaded.push(path.basename(file));
    }

    await documentsPage.navigate();
    const listed = await documentsPage.searchDocument(`${QaData.testPrefix}_UP033_Batch`);
    for (const name of uploaded) {
      expect(listed.documents.map(d => d.fileName)).toContain(name);
      await expect(documentsPage.rowByName(name)).toHaveCount(1);
    }
    await testInfo.attach('uploaded-files.json', { body: JSON.stringify(uploaded, null, 2), contentType: 'application/json' });
  });

  test('TC_UP_034: Verify error when an unsupported file is dropped onto the dropzone', async ({ uploadPage }) => {
    const sent = trackUploadRequests(uploadPage);
    await uploadPage.selectDocumentType('Purchase Order');

    await uploadPage.dropFiles([{ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('plain text') }]);
    await expect(uploadPage.errorMessage).toHaveText(INVALID_FORMAT_ERROR);
    await expect(uploadPage.selectedFileName('notes.txt')).toHaveCount(0);
    await expect(uploadPage.uploadAndProcessButton).toHaveCount(0);
    expect(sent).toHaveLength(0);
  });

  test('TC_UP_035: Verify a file just under the 50MB limit is accepted for upload', async ({ uploadPage }) => {
    // Validation only; the file is not submitted.
    await uploadPage.selectDocumentType('Purchase Order');
    await uploadPage.attachFile(createLargeFile('large_but_allowed.pdf', 49.5, test.info().outputPath()));

    await expect(uploadPage.selectedFileName('large_but_allowed.pdf')).toBeVisible();
    await expect(uploadPage.selectedFileSize).toHaveText('49.50 MB');
    await expect(uploadPage.errorMessage).toHaveCount(0);
    await expect(uploadPage.uploadAndProcessButton).toBeEnabled();
  });

  test('TC_UP_036: Verify "Back to Documents" link when Upload is opened from the Document Library', async ({ uploadPage, documentsPage, page }) => {
    await documentsPage.navigate();
    await documentsPage.uploadNewFileButton.click();
    await expect(page).toHaveURL(/\/upload\?from=documents$/);
    await uploadPage.waitForReady();

    await expect(uploadPage.backToDashboardButton).toHaveCount(0);
    await uploadPage.backToDocumentsButton.click();
    await expect(page).toHaveURL(/\/documents$/);
    await expect(documentsPage.pageHeading).toBeVisible();
  });

  test('TC_UP_037: Verify error message when the upload request fails', async ({ uploadPage, page }) => {
    // Simulated network failure; nothing reaches the server.
    await page.route('**/api/uploadDocument', route => route.abort('failed'));

    await uploadPage.selectDocumentType('Purchase Order');
    await uploadPage.attachFile(createNamedCopy(SAMPLE_PDF, 'invoice.pdf', test.info().outputPath()));
    await uploadPage.uploadAndProcessButton.click();

    await expect(uploadPage.errorMessage).toHaveText('Upload failed');
    await expect(page).toHaveURL(/\/upload\?from=dashboard$/);
    // The user can retry: file stays attached and the button is usable again.
    await expect(uploadPage.selectedFileName('invoice.pdf')).toBeVisible();
    await expect(uploadPage.uploadAndProcessButton).toBeEnabled();
  });
});
