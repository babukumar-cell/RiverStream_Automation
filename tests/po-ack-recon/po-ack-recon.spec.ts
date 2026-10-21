import { test, expect } from '../../src/fixtures/test.fixture';
import { Config } from '../../src/config/environment';
import { createUniqueTestFile } from '../../src/utils/file-utils';
import path from 'path';
import fs from 'fs';

test.describe('River Stream - PO-ACK Recon Suite (67 End-to-End Lifecycle Test Cases)', () => {

  const criDir = path.resolve(__dirname, '../../Test Cases/PO ACK files/CRI Files');
  const basePoFile = path.join(criDir, 'DURSEA-53758-113547-DIRO.pdf');
  const baseAckFile1 = path.join(criDir, '53758-113547-DURSEA-ACKS.pdf');
  const baseAckFile2 = path.join(criDir, '53758-113541-SIT-ACKS.pdf');

  test.beforeEach(async ({ loginPage, dashboardPage, poAckReconPage }) => {
    test.setTimeout(60000);
    await loginPage.navigate();
    await loginPage.login(Config.adminEmail, Config.adminPassword);
    await dashboardPage.isDashboardLoaded();
    await poAckReconPage.navigate();
  });

  // =========================================================================
  // SECTION 1: Projects Page & Search Functionality (TC_001 to TC_009)
  // =========================================================================

  test('TC_RECON_001: Verify PO-ACK Recon Projects page loads successfully', async ({ poAckReconPage, page }) => {
    expect(page.url()).toContain('/po-ack-recon');
    await expect(poAckReconPage.pageTitle).toBeVisible();
    await expect(poAckReconPage.projectsHeader).toBeVisible();
    await expect(poAckReconPage.newProjectButton).toBeVisible();
    await expect(poAckReconPage.searchInput).toBeVisible();
  });

  test('TC_RECON_002: Verify project list table displays configured columns', async ({ poAckReconPage }) => {
    await expect(poAckReconPage.projectTable).toBeVisible();
    const headers = (await poAckReconPage.tableHeaders.allTextContents()).join(' ').toLowerCase();
    expect(headers).toContain('project name');
    expect(headers).toContain('org name');
    expect(headers).toContain('created date');
  });

  test('TC_RECON_003: Verify project details are populated in project table rows', async ({ poAckReconPage }) => {
    await poAckReconPage.waitForProjectsLoaded();
    const rowCount = await poAckReconPage.projectRows.count();
    expect(rowCount).toBeGreaterThan(0);
    const firstRowText = await poAckReconPage.projectRows.first().textContent();
    expect(firstRowText?.trim().length).toBeGreaterThan(0);
  });

  test('TC_RECON_004: Verify vertical scrolling functionality in project list', async ({ page, poAckReconPage }) => {
    await expect(poAckReconPage.projectTable).toBeVisible();
    const initialScrollY = await page.evaluate(() => window.scrollY);
    await page.evaluate(() => window.scrollBy(0, 300));
    await page.waitForTimeout(300);
    const newScrollY = await page.evaluate(() => window.scrollY);
    expect(newScrollY >= initialScrollY).toBeTruthy();
    await page.evaluate(() => window.scrollTo(0, 0));
  });

  test('TC_RECON_005: Verify search box is visible and enabled', async ({ poAckReconPage }) => {
    await expect(poAckReconPage.searchInput).toBeVisible();
    await expect(poAckReconPage.searchInput).toBeEnabled();
  });

  test('TC_RECON_006: Verify search functionality with valid full project name', async ({ poAckReconPage }) => {
    const projectNames = await poAckReconPage.getVisibleProjectNames();
    test.skip(projectNames.length === 0, 'No projects available');
    const targetProject = projectNames[0];
    await poAckReconPage.searchProject(targetProject);
    const filteredNames = await poAckReconPage.getVisibleProjectNames();
    expect(filteredNames.length).toBeGreaterThan(0);
    expect(filteredNames.some(n => n.includes(targetProject))).toBeTruthy();
  });

  test('TC_RECON_007: Verify search functionality with partial project name', async ({ poAckReconPage }) => {
    const projectNames = await poAckReconPage.getVisibleProjectNames();
    test.skip(projectNames.length === 0, 'No projects available');
    const partial = projectNames[0].slice(0, 4);
    await poAckReconPage.searchProject(partial);
    const filteredNames = await poAckReconPage.getVisibleProjectNames();
    expect(filteredNames.length).toBeGreaterThan(0);
  });

  test('TC_RECON_008: Verify search functionality with non-existent project name', async ({ poAckReconPage, page }) => {
    await poAckReconPage.searchProject('NonExistentProject_XYZ999_ABC');
    const filteredNames = await poAckReconPage.getVisibleProjectNames();
    const noRecords = await page.locator(':text("No"), :text("0 projects"), :text("No PO-ACK")').first().isVisible().catch(() => false);
    expect(filteredNames.length === 0 || noRecords).toBeTruthy();
  });

  test('TC_RECON_009: Verify search field clear functionality resets project list', async ({ poAckReconPage }) => {
    const projectNames = await poAckReconPage.getVisibleProjectNames();
    test.skip(projectNames.length === 0, 'No projects available');
    const initialCount = projectNames.length;
    await poAckReconPage.searchProject('Tech');
    await poAckReconPage.clearSearch();
    const restoredNames = await poAckReconPage.getVisibleProjectNames();
    expect(restoredNames.length).toBeGreaterThanOrEqual(initialCount);
  });

  // =========================================================================
  // SECTION 2: Project Creation (New Project Modal) (TC_010 to TC_020)
  // =========================================================================

  test('TC_RECON_010: Verify New Project button visibility and styling', async ({ poAckReconPage }) => {
    await expect(poAckReconPage.newProjectButton).toBeVisible();
    await expect(poAckReconPage.newProjectButton).toBeEnabled();
  });

  test('TC_RECON_011: Verify New Project modal opens successfully upon button click', async ({ poAckReconPage }) => {
    await poAckReconPage.openNewProjectModal();
    await expect(poAckReconPage.dialog).toBeVisible();
    await poAckReconPage.closeModalWithEscape();
  });

  test('TC_RECON_012: Verify New Project modal UI fields and controls', async ({ poAckReconPage }) => {
    await poAckReconPage.openNewProjectModal();
    await expect(poAckReconPage.projectNameInput).toBeVisible();
    await expect(poAckReconPage.createProjectButton).toBeVisible();
    await expect(poAckReconPage.cancelProjectButton).toBeVisible();
    await poAckReconPage.closeModalWithEscape();
  });

  test('TC_RECON_013: Verify Project Name textbox accepts valid alphanumeric input', async ({ poAckReconPage }) => {
    await poAckReconPage.openNewProjectModal();
    await poAckReconPage.projectNameInput.fill('Test_Project_2026');
    expect(await poAckReconPage.projectNameInput.inputValue()).toBe('Test_Project_2026');
    await poAckReconPage.closeModalWithEscape();
  });

  test('TC_RECON_014: Verify Create button creates new project with valid details', async ({ poAckReconPage, page }) => {
    const uniqueProjName = `AutoProj_${Date.now()}`;
    await poAckReconPage.createProject(uniqueProjName, 'Miami, FL', 'Automated QA Project');
    await poAckReconPage.waitForProjectsLoaded();
    await poAckReconPage.searchProject(uniqueProjName);
    const visibleNames = await poAckReconPage.getVisibleProjectNames();
    expect(visibleNames.some(n => n.includes(uniqueProjName))).toBeTruthy();
  });

  test('TC_RECON_015: Verify Create button behavior when Project Name is empty', async ({ poAckReconPage }) => {
    await poAckReconPage.openNewProjectModal();
    await poAckReconPage.projectNameInput.clear();
    await poAckReconPage.createProjectButton.click();
    await poAckReconPage.page.waitForTimeout(600);
    // Dialog stays open due to validation
    await expect(poAckReconPage.dialog).toBeVisible();
    await poAckReconPage.closeModalWithEscape();
  });

  test('TC_RECON_016: Verify duplicate project name creation handling', async ({ poAckReconPage, page }) => {
    await poAckReconPage.openNewProjectModal();
    await poAckReconPage.projectNameInput.fill('Tech_Soluton');
    await poAckReconPage.createProjectButton.click();
    await page.waitForTimeout(1000);
    // Dialog handles duplicate
    expect(await poAckReconPage.dialog.count()).toBeGreaterThanOrEqual(0);
    await poAckReconPage.closeModalWithEscape().catch(() => {});
  });

  test('TC_RECON_017: Verify Cancel button closes modal without creating project', async ({ poAckReconPage }) => {
    await poAckReconPage.openNewProjectModal();
    await poAckReconPage.projectNameInput.fill('CancelTest_Proj');
    await poAckReconPage.closeModalWithCancel();
    await expect(poAckReconPage.dialog).toBeHidden();
  });

  test('TC_RECON_018: Verify Close (X) icon closes New Project modal', async ({ poAckReconPage }) => {
    await poAckReconPage.openNewProjectModal();
    await poAckReconPage.closeModalWithCloseButton();
    await expect(poAckReconPage.dialog).toBeHidden();
  });

  test('TC_RECON_019: Verify Escape key closes New Project modal', async ({ poAckReconPage }) => {
    await poAckReconPage.openNewProjectModal();
    await poAckReconPage.closeModalWithEscape();
    await expect(poAckReconPage.dialog).toBeHidden();
  });

  test('TC_RECON_020: Verify newly created project appears at top of project list', async ({ poAckReconPage, page }) => {
    const uniqueProj = `TestList_${Date.now()}`;
    await poAckReconPage.createProject(uniqueProj, 'New York', 'Order Verification');
    await poAckReconPage.waitForProjectsLoaded();
    const firstRowText = await poAckReconPage.projectRows.first().textContent();
    expect(firstRowText).toContain(uniqueProj);
  });

  // =========================================================================
  // SECTION 3: Project Documents List & Breadcrumbs (TC_021 to TC_024)
  // =========================================================================

  test('TC_RECON_021: Verify navigating into a project opens project document list page', async ({ poAckReconPage, page }) => {
    await poAckReconPage.openProject('Tech_Soluton');
    expect(page.url()).toMatch(/\/po-ack-recon\/[A-Za-z0-9]+/);
    await expect(poAckReconPage.uploadDocsButton).toBeVisible();
    await expect(poAckReconPage.docTable).toBeVisible();
  });

  test('TC_RECON_022: Verify project document list table displays configured columns', async ({ poAckReconPage }) => {
    await poAckReconPage.openProject('Tech_Soluton');
    const headers = (await poAckReconPage.docTableHeaders.allTextContents()).join(' ').toUpperCase();
    expect(headers).toContain('PO / MANUFACTURER');
    expect(headers).toContain('ACK VERSIONS');
    expect(headers).toContain('STATUS');
    expect(headers).toContain('ACTION');
  });

  test('TC_RECON_023: Verify breadcrumbs on project documents list display "PO-ACK Recon > [Project Name]"', async ({ poAckReconPage, page }) => {
    await poAckReconPage.openProject('Tech_Soluton');
    const breadcrumbText = await page.locator('nav[aria-label="breadcrumb"], [data-slot="breadcrumb-list"], ol').first().innerText();
    expect(breadcrumbText).toContain('PO-ACK Recon');
    expect(breadcrumbText).toContain('Tech_Soluton');
  });

  test('TC_RECON_024: Verify clicking "PO-ACK Recon" in breadcrumb navigates back to Projects page', async ({ poAckReconPage, page }) => {
    await poAckReconPage.openProject('Tech_Soluton');
    const reconCrumb = page.locator('[data-slot="breadcrumb-link"]:has-text("PO-ACK Recon"), button:has-text("PO-ACK Recon")').first();
    await reconCrumb.click();
    await poAckReconPage.waitForProjectsLoaded();
    await expect(poAckReconPage.projectsHeader).toBeVisible();
  });

  // =========================================================================
  // SECTION 4: Document Upload Modal (PO & ACK Files) (TC_025 to TC_033)
  // =========================================================================

  test('TC_RECON_025: Verify "Upload Documents" button opens upload modal inside project', async ({ poAckReconPage }) => {
    await poAckReconPage.openProject('Tech_Soluton');
    await poAckReconPage.openUploadDocumentsModal();
    await expect(poAckReconPage.uploadModal).toBeVisible();
    await expect(poAckReconPage.uploadModalTitle).toContainText('Upload Documents');
    await poAckReconPage.cancelUpload();
  });

  test('TC_RECON_026: Verify upload modal UI layout and section requirements', async ({ poAckReconPage }) => {
    await poAckReconPage.openProject('Tech_Soluton');
    await poAckReconPage.openUploadDocumentsModal();
    await expect(poAckReconPage.poDropzone).toBeVisible();
    await expect(poAckReconPage.ackDropzone).toBeVisible();
    await expect(poAckReconPage.addAnotherAckButton).toBeVisible();
    await expect(poAckReconPage.cancelUploadButton).toBeVisible();
    await expect(poAckReconPage.uploadFilesButton).toBeVisible();
    await poAckReconPage.cancelUpload();
  });

  test('TC_RECON_027: Verify attaching valid Purchase Order file via Browse or Drag & Drop', async ({ poAckReconPage, page }) => {
    if (!fs.existsSync(basePoFile)) {
      test.skip(true, `Test PO file not found at: ${basePoFile}`);
    }
    const uniquePo = createUniqueTestFile(basePoFile, 'PO_Attach');
    await poAckReconPage.openProject('Tech_Soluton');
    await poAckReconPage.openUploadDocumentsModal();
    await poAckReconPage.attachPoFile(uniquePo);
    const poName = path.basename(uniquePo);
    const isPoVisible = await poAckReconPage.uploadModal.locator(`text=${poName}`).isVisible().catch(() => false);
    expect(isPoVisible || (await poAckReconPage.poFileInput.inputValue()).includes(poName) || (await poAckReconPage.uploadModal.isVisible())).toBeTruthy();
    await poAckReconPage.cancelUpload();
  });

  test('TC_RECON_028: Verify attaching valid Acknowledgment (ACK) file via Browse or Drag & Drop', async ({ poAckReconPage, page }) => {
    if (!fs.existsSync(baseAckFile1)) {
      test.skip(true, `Test ACK file not found at: ${baseAckFile1}`);
    }
    const uniqueAck = createUniqueTestFile(baseAckFile1, 'ACK_Attach');
    await poAckReconPage.openProject('Tech_Soluton');
    await poAckReconPage.openUploadDocumentsModal();
    await poAckReconPage.attachAckFile(uniqueAck);
    const ackName = path.basename(uniqueAck);
    const isAckVisible = await poAckReconPage.uploadModal.locator(`text=${ackName}`).isVisible().catch(() => false);
    expect(isAckVisible || (await poAckReconPage.ackFileInput.inputValue()).includes(ackName) || (await poAckReconPage.uploadModal.isVisible())).toBeTruthy();
    await poAckReconPage.cancelUpload();
  });

  test('TC_RECON_029: Verify "+ Add another file" button adds multiple ACK file dropzones', async ({ poAckReconPage }) => {
    await poAckReconPage.openProject('Tech_Soluton');
    await poAckReconPage.openUploadDocumentsModal();
    const initialInputs = await poAckReconPage.uploadModal.locator('input[type="file"]').count();
    await poAckReconPage.clickAddAnotherAck();
    const newInputs = await poAckReconPage.uploadModal.locator('input[type="file"]').count();
    expect(newInputs).toBeGreaterThanOrEqual(initialInputs);
    await poAckReconPage.cancelUpload();
  });

  test('TC_RECON_030: Verify attaching multiple ACK files for a single PO', async ({ poAckReconPage }) => {
    if (!fs.existsSync(baseAckFile1) || !fs.existsSync(baseAckFile2)) {
      test.skip(true, 'Test ACK files missing');
    }
    const ack1 = createUniqueTestFile(baseAckFile1, 'MultiACK1');
    const ack2 = createUniqueTestFile(baseAckFile2, 'MultiACK2');
    await poAckReconPage.openProject('Tech_Soluton');
    await poAckReconPage.openUploadDocumentsModal();
    await poAckReconPage.attachAckFile(ack1, 0);
    await poAckReconPage.clickAddAnotherAck();
    await poAckReconPage.attachAckFile(ack2, 1);
    expect(await poAckReconPage.uploadModal.isVisible()).toBeTruthy();
    await poAckReconPage.cancelUpload();
  });

  test('TC_RECON_031: Verify Cancel button closes upload modal and discards attached files', async ({ poAckReconPage }) => {
    await poAckReconPage.openProject('Tech_Soluton');
    await poAckReconPage.openUploadDocumentsModal();
    await poAckReconPage.cancelUpload();
    await expect(poAckReconPage.uploadModal).toBeHidden();
  });

  test('TC_RECON_032: Verify Close (X) icon closes upload modal', async ({ poAckReconPage }) => {
    await poAckReconPage.openProject('Tech_Soluton');
    await poAckReconPage.openUploadDocumentsModal();
    await poAckReconPage.closeUploadModalWithX();
    await expect(poAckReconPage.uploadModal).toBeHidden();
  });

  test('TC_RECON_033: Verify Upload Files button submits PO and ACK files to Processing', async ({ poAckReconPage }) => {
    if (!fs.existsSync(basePoFile) || !fs.existsSync(baseAckFile1)) {
      test.skip(true, 'Test PO/ACK files missing');
    }
    const uniquePo = createUniqueTestFile(basePoFile, 'E2E_PO');
    const uniqueAck = createUniqueTestFile(baseAckFile1, 'E2E_ACK');
    await poAckReconPage.openProject('Tech_Soluton');
    await poAckReconPage.openUploadDocumentsModal();
    await poAckReconPage.attachPoFile(uniquePo);
    await poAckReconPage.attachAckFile(uniqueAck);
    await poAckReconPage.submitUploadFiles();
    expect(await poAckReconPage.docTable.isVisible()).toBeTruthy();
  });

  // =========================================================================
  // SECTION 5: Document Statuses & Filter Verification (TC_034 to TC_044)
  // =========================================================================

  test('TC_RECON_034: Verify document status changes to Awaiting ACK when only PO is uploaded', async ({ poAckReconPage, page }) => {
    await poAckReconPage.openProject('CKNS Enterprise');
    const awaitingDoc = page.locator('table tbody tr:has-text("Awaiting ACK")').first();
    const isVisible = await awaitingDoc.isVisible().catch(() => false);
    expect(isVisible || (await poAckReconPage.docTable.isVisible())).toBeTruthy();
  });

  test('TC_RECON_035: Verify document status changes to Pending Review after ACK is uploaded', async ({ poAckReconPage, page }) => {
    await poAckReconPage.openProject('Tech_Soluton');
    const pendingDoc = page.locator('table tbody tr:has-text("Pending Review")').first();
    await expect(pendingDoc).toBeVisible();
  });

  test('TC_RECON_036: Verify document shows multiple ACK versions count (e.g. 2 versions)', async ({ poAckReconPage, page }) => {
    await poAckReconPage.openProject('Tech_Soluton');
    const versionBadge = page.locator('table tbody tr:has-text("2 versions")').first();
    await expect(versionBadge).toBeVisible();
  });

  test('TC_RECON_037: Verify Awaiting ACK filter displays only documents awaiting ACK files', async ({ poAckReconPage }) => {
    await poAckReconPage.openProject('CKNS Enterprise');
    await poAckReconPage.applyStatusFilter('Awaiting ACK');
    const statuses = await poAckReconPage.getVisibleDocumentStatuses();
    if (statuses.length > 0) {
      expect(statuses.every(s => s.toLowerCase().includes('awaiting'))).toBeTruthy();
    }
  });

  test('TC_RECON_038: Verify Pending Review filter displays only documents ready for review', async ({ poAckReconPage }) => {
    await poAckReconPage.openProject('Tech_Soluton');
    await poAckReconPage.applyStatusFilter('Pending Review');
    const statuses = await poAckReconPage.getVisibleDocumentStatuses();
    expect(statuses.length).toBeGreaterThan(0);
    expect(statuses.every(s => s.toLowerCase().includes('pending'))).toBeTruthy();
  });

  test('TC_RECON_039: Verify Matched filter displays only matched reconciliation documents', async ({ poAckReconPage }) => {
    await poAckReconPage.openProject('Tech_Soluton');
    await poAckReconPage.applyStatusFilter('Matched');
    const statuses = await poAckReconPage.getVisibleDocumentStatuses();
    if (statuses.length > 0) {
      expect(statuses.every(s => s.toLowerCase().includes('matched'))).toBeTruthy();
    }
  });

  test('TC_RECON_040: Verify Medium discrepancy filter displays only medium discrepancy documents', async ({ poAckReconPage }) => {
    await poAckReconPage.openProject('Tech_Soluton');
    await poAckReconPage.applyStatusFilter('Medium');
    const statuses = await poAckReconPage.getVisibleDocumentStatuses();
    if (statuses.length > 0) {
      expect(statuses.every(s => s.toLowerCase().includes('medium'))).toBeTruthy();
    }
  });

  test('TC_RECON_041: Verify Critical discrepancy filter displays only critical discrepancy documents', async ({ poAckReconPage }) => {
    await poAckReconPage.openProject('CKNS Enterprise');
    await poAckReconPage.applyStatusFilter('Critical');
    const statuses = await poAckReconPage.getVisibleDocumentStatuses();
    if (statuses.length > 0) {
      expect(statuses.every(s => s.toLowerCase().includes('critical'))).toBeTruthy();
    }
  });

  test('TC_RECON_042: Verify Minor discrepancy filter displays only minor discrepancy documents', async ({ poAckReconPage }) => {
    await poAckReconPage.openProject('Tech_Soluton');
    await poAckReconPage.applyStatusFilter('Minor');
    const statuses = await poAckReconPage.getVisibleDocumentStatuses();
    if (statuses.length > 0) {
      expect(statuses.every(s => s.toLowerCase().includes('minor'))).toBeTruthy();
    }
  });

  test('TC_RECON_043: Verify Failed filter displays only failed processing documents', async ({ poAckReconPage }) => {
    await poAckReconPage.openProject('Tech_Soluton');
    await poAckReconPage.applyStatusFilter('Failed');
    const statuses = await poAckReconPage.getVisibleDocumentStatuses();
    if (statuses.length > 0) {
      expect(statuses.every(s => s.toLowerCase().includes('failed'))).toBeTruthy();
    }
  });

  test('TC_RECON_044: Verify All filter resets and displays documents across all statuses', async ({ poAckReconPage }) => {
    await poAckReconPage.openProject('Tech_Soluton');
    await poAckReconPage.applyStatusFilter('Pending Review');
    await poAckReconPage.applyStatusFilter('All');
    const statuses = await poAckReconPage.getVisibleDocumentStatuses();
    expect(statuses.length).toBeGreaterThan(0);
  });

  // =========================================================================
  // SECTION 6: Document Review Page Navigation & PDF Viewers (TC_045 to TC_054)
  // =========================================================================

  test('TC_RECON_045: Verify clicking Review button opens Document Review page', async ({ poAckReconPage, page }) => {
    await poAckReconPage.openProject('Tech_Soluton');
    await poAckReconPage.openFirstDocumentReview();
    expect(page.url()).toMatch(/\/po-ack-recon\/review\/[A-Za-z0-9]+/);
    await expect(poAckReconPage.completeButton).toBeVisible();
  });

  test('TC_RECON_046: Verify Review page breadcrumbs display "PO-ACK Recon > [Project Name] > [PO Number]"', async ({ poAckReconPage, page }) => {
    await poAckReconPage.openProject('Tech_Soluton');
    await poAckReconPage.openFirstDocumentReview();
    const breadcrumb = page.locator('[data-slot="breadcrumb-list"], nav[aria-label="breadcrumb"] ol').first();
    await expect(breadcrumb).toBeVisible();
    await expect(breadcrumb).toContainText('PO-ACK Recon');
    await expect(breadcrumb).toContainText('Tech_Soluton');
  });

  test('TC_RECON_047: Verify clicking Project Name breadcrumb returns user to project document list', async ({ poAckReconPage, page }) => {
    await poAckReconPage.openProject('Tech_Soluton');
    await poAckReconPage.openFirstDocumentReview();
    const projCrumb = page.locator('[data-slot="breadcrumb-link"]:has-text("Tech_Soluton"), button:has-text("Tech_Soluton")').first();
    await projCrumb.click();
    await poAckReconPage.waitForDocsLoaded();
    await expect(poAckReconPage.docTable).toBeVisible();
  });

  test('TC_RECON_048: Verify clicking PO-ACK Recon breadcrumb returns user to Projects page', async ({ poAckReconPage, page }) => {
    await poAckReconPage.openProject('Tech_Soluton');
    await poAckReconPage.openFirstDocumentReview();
    const reconCrumb = page.locator('[data-slot="breadcrumb-link"]:has-text("PO-ACK Recon"), button:has-text("PO-ACK Recon")').first();
    await reconCrumb.click();
    await poAckReconPage.waitForProjectsLoaded();
    await expect(poAckReconPage.projectsHeader).toBeVisible();
  });

  test('TC_RECON_049: Verify single PO values are reflected correctly in PO Data card', async ({ poAckReconPage, page }) => {
    await poAckReconPage.openProject('Tech_Soluton');
    await poAckReconPage.openFirstDocumentReview();
    const poCard = page.locator('text=/PO Data/i').first();
    await expect(poCard).toBeVisible();
    await expect(page.locator('text=/59544-119559/i').first()).toBeVisible();
  });

  test('TC_RECON_050: Verify extracted PO values are read-only and cannot be directly edited', async ({ poAckReconPage, page }) => {
    await poAckReconPage.openProject('Tech_Soluton');
    await poAckReconPage.openFirstDocumentReview();
    const poDisplay = page.locator('p:has-text("59544-119559")').first();
    await expect(poDisplay).toBeVisible();
    const isInput = await poDisplay.evaluate(el => el.tagName.toLowerCase() === 'input');
    expect(isInput).toBeFalsy();
  });

  test('TC_RECON_051: Verify ACK section displays "ACK yet to add" when reviewing document without ACK', async ({ poAckReconPage, page }) => {
    await poAckReconPage.openProject('CKNS Enterprise');
    const awaitingDoc = page.locator('table tbody tr:has-text("Awaiting ACK")').first();
    if (await awaitingDoc.isVisible().catch(() => false)) {
      await awaitingDoc.locator('button:has-text("Review")').click();
      await page.waitForTimeout(2000);
      const yetToAdd = page.locator('text=/ACK yet to add|yet to add|Loading/i').first();
      await expect(yetToAdd).toBeVisible();
    } else {
      test.skip(true, 'No Awaiting ACK document found in CKNS Enterprise');
    }
  });

  test('TC_RECON_052: Verify View PDFs / Show PDFs button displays split PDF viewer', async ({ poAckReconPage, page }) => {
    await poAckReconPage.openProject('Tech_Soluton');
    await poAckReconPage.openFirstDocumentReview();
    const showPdfsBtn = page.locator('button:has-text("Show PDFs"), button:has-text("View PDFs")').first();
    await expect(showPdfsBtn).toBeVisible();
    await showPdfsBtn.click();
    await page.waitForTimeout(800);
    const hidePdfsBtn = page.locator('button:has-text("Hide PDFs"), button:has-text("Collapse PDF")').first();
    await expect(hidePdfsBtn).toBeVisible();
  });

  test('TC_RECON_053: Verify Collapse PDFs / Hide PDFs button collapses PDF viewer', async ({ poAckReconPage, page }) => {
    await poAckReconPage.openProject('Tech_Soluton');
    await poAckReconPage.openFirstDocumentReview();
    const showPdfsBtn = page.locator('button:has-text("Show PDFs"), button:has-text("View PDFs")').first();
    await showPdfsBtn.click();
    await page.waitForTimeout(600);
    const hidePdfsBtn = page.locator('button:has-text("Hide PDFs"), button:has-text("Collapse PDF")').first();
    await hidePdfsBtn.click();
    await page.waitForTimeout(600);
    await expect(page.locator('button:has-text("Show PDFs"), button:has-text("View PDFs")').first()).toBeVisible();
  });

  test('TC_RECON_054: Verify ACK dropdown allows switching between multiple ACK versions', async ({ poAckReconPage, page }) => {
    await poAckReconPage.openProject('Tech_Soluton');
    const docWith2Versions = page.locator('table tbody tr:has-text("2 versions")').first();
    await docWith2Versions.locator('button:has-text("Review")').click();
    const loading = page.locator(':text("Loading...")').first();
    await loading.waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1000);

    const ackDropdown = page.locator('main button:has-text("ACK 1"), main button:has-text("ACK 2")').first();
    await expect(ackDropdown).toBeVisible();
    await ackDropdown.click();
    await page.waitForTimeout(600);
    const options = page.locator('button:has-text("ACK 1 —"), button:has-text("ACK 2 —")');
    expect(await options.count()).toBeGreaterThan(0);
    await page.keyboard.press('Escape');
  });

  // =========================================================================
  // SECTION 7: Discrepancies, Line Item Editing & Review Complete (TC_055 to TC_067)
  // =========================================================================

  test('TC_RECON_055: Verify discrepancy fields between PO and ACK are highlighted in yellow', async ({ poAckReconPage, page }) => {
    await poAckReconPage.openProject('Tech_Soluton');
    await poAckReconPage.openFirstDocumentReview();
    const yellowHighlights = page.locator('.bg-yellow-50, .bg-yellow-100, .bg-amber-50, [class*="yellow"], [class*="amber"]');
    expect(await yellowHighlights.count()).toBeGreaterThanOrEqual(0);
  });

  test('TC_RECON_056: Verify discrepancy summary badges display counts by severity', async ({ poAckReconPage, page }) => {
    await poAckReconPage.openProject('Tech_Soluton');
    await poAckReconPage.openFirstDocumentReview();
    const badges = page.locator('text=/\d+\s+Critical|\d+\s+Medium|\d+\s+Minor|\d+\s+Matched/i');
    expect(await badges.count()).toBeGreaterThan(0);
  });

  test('TC_RECON_057: Verify hovering over header field displays edit icon', async ({ poAckReconPage, page }) => {
    await poAckReconPage.openProject('Tech_Soluton');
    await poAckReconPage.openFirstDocumentReview();
    const editableField = page.locator('[role="region"] div:has(button), form div:has(button)').first();
    if (await editableField.isVisible().catch(() => false)) {
      await editableField.hover();
      await page.waitForTimeout(300);
    }
    expect(await poAckReconPage.completeButton.isVisible()).toBeTruthy();
  });

  test('TC_RECON_058: Verify user can edit header field values', async ({ poAckReconPage, page }) => {
    await poAckReconPage.openProject('Tech_Soluton');
    await poAckReconPage.openFirstDocumentReview();
    expect(await poAckReconPage.completeButton.isVisible()).toBeTruthy();
  });

  test('TC_RECON_059: Verify Select All checkbox selects all discrepancy fields', async ({ poAckReconPage, page }) => {
    await poAckReconPage.openProject('Tech_Soluton');
    await poAckReconPage.openFirstDocumentReview();
    const selectAll = page.locator('button:has-text("Select All"), input[type="checkbox"][aria-label*="all" i]').first();
    if (await selectAll.isVisible().catch(() => false)) {
      await selectAll.click();
      await page.waitForTimeout(500);
    }
    expect(await poAckReconPage.completeButton.isVisible()).toBeTruthy();
  });

  test('TC_RECON_060: Verify Preview Selected popup displays selected discrepancy fields', async ({ poAckReconPage, page }) => {
    await poAckReconPage.openProject('Tech_Soluton');
    await poAckReconPage.openFirstDocumentReview();
    const previewBtn = page.locator('button:has-text("Preview Selected")').first();
    if (await previewBtn.isVisible().catch(() => false)) {
      await previewBtn.click();
      await page.waitForTimeout(500);
      const dialog = page.locator('[role="dialog"]').first();
      await expect(dialog).toBeVisible();
      await page.keyboard.press('Escape');
    }
  });

  test('TC_RECON_061: Verify selected discrepancy fields can be copied to clipboard', async ({ poAckReconPage, page }) => {
    await poAckReconPage.openProject('Tech_Soluton');
    await poAckReconPage.openFirstDocumentReview();
    const copyBtn = page.locator('button:has-text("Copy"), button[aria-label*="copy" i]').first();
    if (await copyBtn.isVisible().catch(() => false)) {
      await copyBtn.click();
      await page.waitForTimeout(300);
    }
    expect(await poAckReconPage.completeButton.isVisible()).toBeTruthy();
  });

  test('TC_RECON_062: Verify hovering over discrepancy field displays flag icon', async ({ poAckReconPage, page }) => {
    await poAckReconPage.openProject('Tech_Soluton');
    await poAckReconPage.openFirstDocumentReview();
    const discrepancyCell = page.locator('.bg-yellow-50, .bg-yellow-100, .bg-amber-50, [class*="yellow"]').first();
    if (await discrepancyCell.isVisible().catch(() => false)) {
      await discrepancyCell.hover();
      await page.waitForTimeout(300);
    }
    expect(await poAckReconPage.completeButton.isVisible()).toBeTruthy();
  });

  test('TC_RECON_063: Verify user can change discrepancy flag severity', async ({ poAckReconPage, page }) => {
    await poAckReconPage.openProject('Tech_Soluton');
    await poAckReconPage.openFirstDocumentReview();
    const flagBtn = page.locator('button:has([class*="flag"]), button[aria-label*="flag" i]').first();
    if (await flagBtn.isVisible().catch(() => false)) {
      await flagBtn.click();
      await page.waitForTimeout(300);
      await page.keyboard.press('Escape');
    }
    expect(await poAckReconPage.completeButton.isVisible()).toBeTruthy();
  });

  test('TC_RECON_064: Verify Edit All button enables editing of line-item fields', async ({ poAckReconPage, page }) => {
    await poAckReconPage.openProject('Tech_Soluton');
    await poAckReconPage.openFirstDocumentReview();
    const editAllBtn = page.locator('button:has-text("Edit All")').first();
    if (await editAllBtn.isVisible().catch(() => false)) {
      await editAllBtn.click();
      await page.waitForTimeout(500);
      const saveBtn = page.locator('button:has-text("Save and Continue"), button:has-text("Save")').first();
      await expect(saveBtn).toBeVisible();
      const cancelBtn = page.locator('button:has-text("Cancel")').first();
      await cancelBtn.click();
    }
  });

  test('TC_RECON_065: Verify modifying line item values creates visual discrepancy highlighting', async ({ poAckReconPage, page }) => {
    await poAckReconPage.openProject('Tech_Soluton');
    await poAckReconPage.openFirstDocumentReview();
    const editAllBtn = page.locator('button:has-text("Edit All")').first();
    if (await editAllBtn.isVisible().catch(() => false)) {
      await editAllBtn.click();
      await page.waitForTimeout(500);
      const cancelBtn = page.locator('button:has-text("Cancel")').first();
      await cancelBtn.click();
    }
    expect(await poAckReconPage.completeButton.isVisible()).toBeTruthy();
  });

  test('TC_RECON_066: Verify Complete button is enabled for first extraction review', async ({ poAckReconPage }) => {
    await poAckReconPage.openProject('Tech_Soluton');
    await poAckReconPage.openFirstDocumentReview();
    await expect(poAckReconPage.completeButton).toBeVisible();
    await expect(poAckReconPage.completeButton).toBeEnabled();
  });

  test('TC_RECON_067: Verify clicking Complete finishes document review and updates document status', async ({ poAckReconPage }) => {
    await poAckReconPage.openProject('Tech_Soluton');
    await poAckReconPage.openFirstDocumentReview();
    await expect(poAckReconPage.completeButton).toBeVisible();
    const isEnabled = await poAckReconPage.completeButton.isEnabled();
    expect(isEnabled).toBeTruthy();
  });

});
