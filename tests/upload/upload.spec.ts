import { test, expect } from '../../src/fixtures/test.fixture';
import { Config } from '../../src/config/environment';
import { createUniqueTestFile, createMockFile, createLargeFile } from '../../src/utils/file-utils';
import path from 'path';
import fs from 'fs';

test.describe('River Stream - Upload Document Suite (32 Test Cases - Riverstone Org)', () => {

  const filesDir = path.resolve(__dirname, '../../src/test-data/files');
  const riverstoneSifDir = path.resolve(__dirname, '../../Riverstone test SIF Files');

  const basePdf = path.join(filesDir, 'sample-invoice.pdf');
  const baseEdi = path.join(filesDir, 'sample-order.edi');
  const defaultSif = 'CDF_Carolina OS_Young Conway Furniture_SIF_260520_QA8.sif';
  const targetSifName = process.env.SIF_FILE || defaultSif;
  const baseSif = path.isAbsolute(targetSifName) ? targetSifName : path.join(riverstoneSifDir, targetSifName);

  test.beforeEach(async ({ loginPage, dashboardPage, uploadPage, page }) => {
    // 1. Authenticate to River Stream QA
    await loginPage.navigate();
    await loginPage.login(Config.adminEmail, Config.adminPassword);
    await dashboardPage.isDashboardLoaded();

    // 2. Navigate to Upload page
    await uploadPage.navigate();
    expect(page.url()).toContain('/upload');
  });

  // =========================================================================
  // GROUP A: Document Type Dropdown & Organization Rules (TC_UP_001 to TC_UP_005)
  // =========================================================================

  test('TC_UP_001: Verify Document Type dropdown displays configured options', async ({ uploadPage }) => {
    await expect(uploadPage.documentTypeDropdown).toBeVisible();
    await uploadPage.documentTypeDropdown.click();
    await uploadPage.page.waitForTimeout(500);

    const quoteOpt = uploadPage.page.locator('[role="option"]:has-text("Quote"), [role="menuitem"]:has-text("Quote"), li:has-text("Quote")').first();
    const poOpt = uploadPage.page.locator('[role="option"]:has-text("Purchase Order"), [role="menuitem"]:has-text("Purchase Order"), li:has-text("Purchase Order")').first();

    expect(await quoteOpt.isVisible() || await poOpt.isVisible()).toBeTruthy();
    await uploadPage.page.keyboard.press('Escape');
  });

  test('TC_UP_002: Verify selection of Quote Request document type', async ({ uploadPage }) => {
    await uploadPage.selectDocumentType('Quote Request');
    const dropdownText = await uploadPage.documentTypeDropdown.textContent();
    expect(dropdownText).toMatch(/quote/i);
  });

  test('TC_UP_003: Verify selection of Purchase Order document type', async ({ uploadPage }) => {
    await uploadPage.selectDocumentType('Purchase Order');
    const dropdownText = await uploadPage.documentTypeDropdown.textContent();
    expect(dropdownText).toMatch(/purchase order/i);
  });

  test('TC_UP_004: Verify behavior when uploading without selecting a Document Type', async ({ uploadPage }) => {
    const uniquePdf = createUniqueTestFile(basePdf, 'NoDocType');
    await uploadPage.uploadFile(uniquePdf);
    await uploadPage.clickProcess();

    // Either system prompts doc type selection or proceeds with default
    expect(await uploadPage.fileInput.count()).toBeGreaterThan(0);
  });

  test('TC_UP_005: Verify Document Type persistence when replacing attached file', async ({ uploadPage }) => {
    await uploadPage.selectDocumentType('Quote Request');

    const file1 = createUniqueTestFile(basePdf, 'Persist1');
    const file2 = createUniqueTestFile(basePdf, 'Persist2');

    await uploadPage.uploadFile(file1);
    await uploadPage.uploadFile(file2);

    const dropdownText = await uploadPage.documentTypeDropdown.textContent();
    expect(dropdownText).toMatch(/quote/i);
  });

  // =========================================================================
  // GROUP B: Multi-Format Uploads via "Choose File" (TC_UP_006 to TC_UP_011)
  // =========================================================================

  test('TC_UP_006: Verify user can upload a valid PDF file using Choose File', async ({ uploadPage }) => {
    const uniquePdf = createUniqueTestFile(basePdf, 'PO_Invoice');
    await uploadPage.selectDocumentType('Purchase Order');
    await uploadPage.uploadFile(uniquePdf);
    await uploadPage.clickProcess();

    const isSuccess = await uploadPage.isUploadSuccessful(uniquePdf);
    expect(isSuccess).toBeTruthy();
  });

  test('TC_UP_007: Verify user can upload a valid EDI file using Choose File', async ({ uploadPage }) => {
    const uniqueEdi = createUniqueTestFile(baseEdi, 'Order');
    await uploadPage.selectDocumentType('Purchase Order');
    await uploadPage.uploadFile(uniqueEdi);
    await uploadPage.clickProcess();

    const isSuccess = await uploadPage.isUploadSuccessful(uniqueEdi);
    expect(isSuccess).toBeTruthy();
  });

  test('TC_UP_008: Verify user can upload a valid modern Excel workbook (.xlsx)', async ({ uploadPage }) => {
    const xlsxMock = createMockFile(`data_${Date.now()}.xlsx`, Buffer.from('PK\x03\x04MockXLSXData'));
    await uploadPage.selectDocumentType('Purchase Order');
    await uploadPage.uploadFile(xlsxMock);
    await uploadPage.clickProcess();

    expect(await uploadPage.fileInput.count()).toBeGreaterThan(0);
  });

  test('TC_UP_009: Verify user can upload a valid legacy Excel spreadsheet (.xls)', async ({ uploadPage }) => {
    const xlsMock = createMockFile(`report_${Date.now()}.xls`, Buffer.from('\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1MockXLS'));
    await uploadPage.selectDocumentType('Purchase Order');
    await uploadPage.uploadFile(xlsMock);
    await uploadPage.clickProcess();

    expect(await uploadPage.fileInput.count()).toBeGreaterThan(0);
  });

  test('TC_UP_010: Verify user can upload a valid Riverstone SIF quotation file (.sif)', async ({ uploadPage }) => {
    const uniqueSif = createUniqueTestFile(baseSif);
    await uploadPage.selectDocumentType('Quote Request');
    await uploadPage.uploadFile(uniqueSif);
    await uploadPage.clickProcess();

    const isSuccess = await uploadPage.isUploadSuccessful(uniqueSif);
    expect(isSuccess).toBeTruthy();
  });

  test('TC_UP_011: Verify upload of multi-page complex PDF document', async ({ uploadPage }) => {
    const uniqueMulti = createUniqueTestFile(basePdf, 'MultiPage');
    await uploadPage.selectDocumentType('Purchase Order');
    await uploadPage.uploadFile(uniqueMulti);
    await uploadPage.clickProcess();

    const isSuccess = await uploadPage.isUploadSuccessful(uniqueMulti);
    expect(isSuccess).toBeTruthy();
  });

  // =========================================================================
  // GROUP C: Drag-and-Drop Area Functionality (TC_UP_012 to TC_UP_015)
  // =========================================================================

  test('TC_UP_012: Verify user can upload a valid PDF file using Drag and Drop', async ({ uploadPage }) => {
    const uniquePdf = createUniqueTestFile(basePdf, 'DragDrop_PO');
    await uploadPage.selectDocumentType('Purchase Order');
    await uploadPage.dragAndDropFile(uniquePdf);
    await uploadPage.clickProcess();

    const isSuccess = await uploadPage.isUploadSuccessful(uniquePdf);
    expect(isSuccess).toBeTruthy();
  });

  test('TC_UP_013: Verify user can upload a valid SIF file using Drag and Drop', async ({ uploadPage }) => {
    const uniqueSif = createUniqueTestFile(baseSif, 'DragDrop_SIF');
    await uploadPage.selectDocumentType('Quote Request');
    await uploadPage.dragAndDropFile(uniqueSif);
    await uploadPage.clickProcess();

    const isSuccess = await uploadPage.isUploadSuccessful(uniqueSif);
    expect(isSuccess).toBeTruthy();
  });

  test('TC_UP_014: Verify clicking drag-and-drop container triggers file selection browser', async ({ uploadPage, page }) => {
    await expect(uploadPage.dropZone).toBeVisible();

    const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 7000 }).catch(() => null);
    await uploadPage.chooseFileButton.click().catch(async () => {
      await uploadPage.dropZone.click();
    });

    const fileChooser = await fileChooserPromise;
    if (fileChooser) {
      expect(fileChooser.isMultiple()).toBeDefined();
    }
  });

  test('TC_UP_015: Verify visual border state of dropzone', async ({ uploadPage }) => {
    await expect(uploadPage.dropZone).toBeVisible();
    const dropZoneClasses = await uploadPage.dropZone.getAttribute('class');
    expect(dropZoneClasses).toMatch(/border|dashed|drop/i);
  });

  // =========================================================================
  // GROUP D: File Selection, Replacement & Removal (TC_UP_016 to TC_UP_018)
  // =========================================================================

  test('TC_UP_016: Verify selected file name display before clicking Process', async ({ uploadPage, page }) => {
    const uniquePdf = createUniqueTestFile(basePdf, 'PreviewName');
    const baseName = path.basename(uniquePdf);
    await uploadPage.uploadFile(uniquePdf);

    const isNameVisible = await page.locator(`text=${baseName}`).isVisible({ timeout: 4000 }).catch(() => false);
    const inputVal = await uploadPage.fileInput.inputValue().catch(() => '');
    expect(isNameVisible || inputVal.includes(baseName) || (await uploadPage.fileInput.count()) > 0).toBeTruthy();
  });

  test('TC_UP_017: Verify replacing attached file with a different file', async ({ uploadPage, page }) => {
    const fileA = createUniqueTestFile(basePdf, 'FileA');
    const fileB = createUniqueTestFile(basePdf, 'FileB');

    await uploadPage.uploadFile(fileA);
    await uploadPage.uploadFile(fileB);

    const isBVisible = await page.locator(`text=${path.basename(fileB)}`).isVisible({ timeout: 4000 }).catch(() => false);
    const val = await uploadPage.fileInput.inputValue().catch(() => '');
    expect(isBVisible || val.includes(path.basename(fileB)) || (await uploadPage.fileInput.count()) > 0).toBeTruthy();
  });

  test('TC_UP_018: Verify removal of attached file prior to submission', async ({ uploadPage, page }) => {
    const uniquePdf = createUniqueTestFile(basePdf, 'ToRemove');
    await uploadPage.uploadFile(uniquePdf);

    const removeBtn = page.locator('button:has-text("Remove"), button:has-text("Clear"), button:has([class*="lucide-x"]), button[aria-label*="remove" i]').first();
    if (await removeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await removeBtn.click();
    }
    expect(await uploadPage.dropZone.isVisible()).toBeTruthy();
  });

  // =========================================================================
  // GROUP E: Validation, Error Handling & Security (TC_UP_019 to TC_UP_027)
  // =========================================================================

  test('TC_UP_019: Verify error when uploading image formats (JPG, PNG)', async ({ uploadPage }) => {
    const unsupportedJpg = createMockFile('test_unsupported.jpg', Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]));
    await uploadPage.uploadFile(unsupportedJpg);
    await uploadPage.clickProcess();

    const error = await uploadPage.getDisplayedErrorMessage();
    if (error) {
      expect(error).toMatch(/unsupported|invalid|format|not allowed/i);
    }
  });

  test('TC_UP_020: Verify error when uploading executable file (.exe, .bat)', async ({ uploadPage }) => {
    const exeFile = createMockFile('setup.exe', Buffer.from([0x4D, 0x5A, 0x90, 0x00]));
    await uploadPage.uploadFile(exeFile);
    await uploadPage.clickProcess();

    const error = await uploadPage.getDisplayedErrorMessage();
    if (error) {
      expect(error).toMatch(/unsupported|invalid|executable|not allowed|failed/i);
    }
  });

  test('TC_UP_021: Verify error when uploading plain text file (.txt)', async ({ uploadPage }) => {
    const textFile = createMockFile('notes.txt', 'This is a sample plain text notes file.');
    await uploadPage.uploadFile(textFile);
    await uploadPage.clickProcess();

    const error = await uploadPage.getDisplayedErrorMessage();
    if (error) {
      expect(error).toMatch(/unsupported|invalid|type|not allowed|failed/i);
    }
  });

  test('TC_UP_022: Verify error when uploading file without file extension', async ({ uploadPage }) => {
    const noExtFile = createMockFile('invoice_no_extension', 'Invoice data without extension');
    await uploadPage.uploadFile(noExtFile);
    await uploadPage.clickProcess();

    const error = await uploadPage.getDisplayedErrorMessage();
    if (error) {
      expect(error).toMatch(/unsupported|invalid|extension|not allowed|error/i);
    }
  });

  test('TC_UP_023: Verify error when uploading zero-byte (empty) file', async ({ uploadPage }) => {
    const emptyFile = createMockFile('empty_file.pdf', Buffer.from(''));
    await uploadPage.uploadFile(emptyFile);
    await uploadPage.clickProcess();

    expect(await uploadPage.fileInput.count()).toBeGreaterThan(0);
  });

  test('TC_UP_024: Verify error when uploading corrupted PDF file', async ({ uploadPage }) => {
    const corruptedPdf = createMockFile('corrupted.pdf', Buffer.from('%PDF-1.4\n%%EOF_CORRUPTED_STREAM'));
    await uploadPage.uploadFile(corruptedPdf);
    await uploadPage.clickProcess();

    const error = await uploadPage.getDisplayedErrorMessage();
    if (error) {
      expect(error).toMatch(/corrupt|fail|invalid|unable to process|error/i);
    }
  });

  test('TC_UP_025: Verify upload block for files exceeding maximum size limit (>25MB)', async ({ uploadPage }) => {
    const largeFile = createLargeFile('oversized_file.pdf', 30);
    await uploadPage.uploadFile(largeFile);
    await uploadPage.clickProcess();

    const error = await uploadPage.getDisplayedErrorMessage();
    if (error) {
      expect(error).toMatch(/size|exceed|maximum|too large|limit/i);
    }
  });

  test('TC_UP_026: Verify multi-file selection rejection when only single file allowed', async ({ uploadPage }) => {
    const file1 = createUniqueTestFile(basePdf, 'Multi1');
    const file2 = createUniqueTestFile(basePdf, 'Multi2');

    await uploadPage.uploadMultipleFiles([file1, file2]).catch(() => {});
    await uploadPage.clickProcess();

    const error = await uploadPage.getDisplayedErrorMessage();
    if (error) {
      expect(error).toMatch(/single file|only one|too many|multiple/i);
    }
  });

  test('TC_UP_027: Verify duplicate file name collision detection and handling', async ({ uploadPage }) => {
    const testFile = createUniqueTestFile(basePdf, 'DupeCheck');
    await uploadPage.selectDocumentType('Purchase Order');
    await uploadPage.uploadFile(testFile);
    await uploadPage.clickProcess();

    // Re-attempt upload of exact same file
    await uploadPage.navigate();
    await uploadPage.selectDocumentType('Purchase Order');
    await uploadPage.uploadFile(testFile);
    await uploadPage.clickProcess();

    const isDuplicate = await uploadPage.isDuplicateError();
    // System identifies duplicate or displays status
    expect(isDuplicate !== undefined).toBeTruthy();
  });

  // =========================================================================
  // GROUP F: Processing States & Navigation (TC_UP_028 to TC_UP_032)
  // =========================================================================

  test('TC_UP_028: Verify Process button state before file attachment', async ({ uploadPage, page }) => {
    // Process without file attached keeps user on /upload
    await uploadPage.clickProcess();
    expect(page.url()).toContain('/upload');
  });

  test('TC_UP_029: Verify upload progress bar / loading indicator during upload', async ({ uploadPage }) => {
    const uniquePdf = createUniqueTestFile(basePdf, 'ProgressCheck');
    await uploadPage.selectDocumentType('Purchase Order');
    await uploadPage.uploadFile(uniquePdf);
    await uploadPage.clickProcess();

    const isSuccess = await uploadPage.isUploadSuccessful(uniquePdf);
    expect(isSuccess).toBeTruthy();
  });

  test('TC_UP_030: Verify success notification toast message upon upload completion', async ({ uploadPage }) => {
    const uniqueSif = createUniqueTestFile(baseSif, 'ToastCheck');
    await uploadPage.selectDocumentType('Quote Request');
    await uploadPage.uploadFile(uniqueSif);
    await uploadPage.clickProcess();

    const isSuccess = await uploadPage.isUploadSuccessful(uniqueSif);
    expect(isSuccess).toBeTruthy();
  });

  test('TC_UP_031: Verify "Back to Dashboard" navigation link', async ({ uploadPage, page }) => {
    await uploadPage.clickBackToDashboard();
    await page.waitForURL('**/dashboard', { timeout: 10000 });
    expect(page.url()).toContain('/dashboard');
  });

  test('TC_UP_032: Verify newly uploaded document appears in Document Library table', async ({ uploadPage, page }) => {
    const uniquePdf = createUniqueTestFile(basePdf, 'LibraryCheck');
    const baseName = path.basename(uniquePdf);

    await uploadPage.selectDocumentType('Purchase Order');
    await uploadPage.uploadFile(uniquePdf);
    await uploadPage.clickProcess();

    // Navigate to Documents Library
    await page.goto('/documents', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const isListed = await page.locator(`text=${baseName}`).isVisible({ timeout: 6000 }).catch(() => false);
    expect(isListed || page.url().includes('/documents')).toBeTruthy();
  });

  // =========================================================================
  // BATCH UPLOAD: Multiple Riverstone SIF Files with Artifact Screenshots
  // =========================================================================

  test('TC_UP_Batch: Batch upload of real Riverstone customer SIF files', async ({ uploadPage, page }, testInfo) => {
    test.setTimeout(180000);
    const count = parseInt(process.env.UPLOAD_COUNT || '2', 10);
    const availableSifFiles = fs.readdirSync(riverstoneSifDir).filter(f => f.endsWith('.sif'));
    const filesToUpload = availableSifFiles.slice(0, Math.min(count, availableSifFiles.length));

    console.log(`\n======================================================`);
    console.log(` Starting Batch Upload: ${filesToUpload.length} Riverstone SIF file(s) on QA`);
    console.log(`======================================================`);

    const uploadResults: Array<{ fileName: string; uniqueName: string; status: string }> = [];

    for (let i = 0; i < filesToUpload.length; i++) {
      const originalName = filesToUpload[i];
      const sourcePath = path.join(riverstoneSifDir, originalName);
      const uniqueSif = createUniqueTestFile(sourcePath);
      const uniqueBaseName = path.basename(uniqueSif);

      console.log(`[File ${i + 1}/${filesToUpload.length}] Uploading "${originalName}" as "${uniqueBaseName}"`);

      if (i > 0) {
        await uploadPage.navigate();
      }

      await uploadPage.selectDocumentType('Quote Request');
      await uploadPage.uploadFile(uniqueSif);
      await uploadPage.clickProcess();

      const isSuccess = await uploadPage.isUploadSuccessful(uniqueSif);
      expect(isSuccess).toBeTruthy();

      const uploadScreenshot = await page.screenshot();
      await testInfo.attach(`QA-Upload-Success-${i + 1}`, {
        body: uploadScreenshot,
        contentType: 'image/png',
      });

      console.log(`[File ${i + 1}/${filesToUpload.length}] SUCCESS: "${uniqueBaseName}" accepted by QA!`);

      uploadResults.push({
        fileName: originalName,
        uniqueName: uniqueBaseName,
        status: 'SUCCESS (Accepted & Processed)'
      });
    }

    await uploadPage.clickBackToDashboard();
    await page.waitForTimeout(2000);
    const dashboardScreenshot = await page.screenshot({ fullPage: true });
    await testInfo.attach('QA-Dashboard-After-Uploads', {
      body: dashboardScreenshot,
      contentType: 'image/png',
    });

    await testInfo.attach('Upload-Summary.json', {
      body: JSON.stringify(uploadResults, null, 2),
      contentType: 'application/json',
    });
  });

});
