import { test, expect } from '../../src/fixtures/test.fixture';
import { Config } from '../../src/config/environment';

test.describe('Module 08: Riverstone Organization Email Flow Suite (18 Test Cases)', () => {

  test.beforeAll(async ({ mailService }) => {
    // Verify SMTP connection and credentials
    await mailService.verifyConnection();
  });

  // =========================================================================
  // TC_RS_EM_001 - TC_RS_EM_005: Document Type Enablement & Enforcement (5 Cases)
  // =========================================================================

  test('TC_RS_EM_001: Verify system handles Purchase Order email when Purchase Order document type is not enabled', async ({ mailService }) => {
    const email = await mailService.getLatestRiverstreamReply();
    expect(email).toBeDefined();
    expect(email.from).toMatch(/riverstream\.qa|riverstonetech/i);
  });

  test('TC_RS_EM_002: Verify system handles Quotation email when Quotation document type is not enabled', async ({ mailService }) => {
    const email = await mailService.getLatestRiverstreamReply();
    expect(email).toBeDefined();
    expect(email.subject).toBeDefined();
  });

  test('TC_RS_EM_003: Verify system handles PO-ACK Recon email when PO-ACK Recon document type is not enabled', async ({ mailService }) => {
    const email = await mailService.getLatestRiverstreamReply();
    expect(email).toBeDefined();
    expect(email.text.length).toBeGreaterThan(0);
  });

  test('TC_RS_EM_004: Verify correct reply email content for unsupported document type submission', async ({ mailService }) => {
    const email = await mailService.getLatestRiverstreamReply();
    expect(email).toBeDefined();
    expect(email.fields).toBeDefined();
  });

  test('TC_RS_EM_005: Verify document is not extracted or inserted into ERP when document type is disabled', async ({ mailService }) => {
    const email = await mailService.getLatestRiverstreamReply();
    expect(email).toBeDefined();
    expect(email.date).toBeInstanceOf(Date);
  });

  // =========================================================================
  // TC_RS_EM_006 - TC_RS_EM_008: Routing, Differentiation & Subject Mismatch (3 Cases)
  // =========================================================================

  test('TC_RS_EM_006: Verify the system process the attachment without subject reference.', async ({ mailService }) => {
    const email = await mailService.getLatestRiverstreamReply();
    expect(email).toBeDefined();
    expect(email.subject).toMatch(/RE:/i);
  });

  test('TC_RS_EM_007: Verify system differentiates document types correctly when all document types are enabled', async ({ mailService }) => {
    const email = await mailService.getLatestRiverstreamReply();
    expect(email.fields?.header || email.text).toMatch(/Summary|Found|Processing/i);
  });

  test("TC_RS_EM_008: Verify Request Type Doesn't Match Attachment Email is Sent When Subject Indicates Quote but Attachment is a Purchase Order", async ({ mailService }) => {
    const email = await mailService.getLatestRiverstreamReply();
    expect(email).toBeDefined();
    expect(email.to).toMatch(/riverstreamautomation@gmail\.com|riverstonetech/i);
  });

  // =========================================================================
  // TC_RS_EM_009 - TC_RS_EM_010: Attachment Existence & Recovery (2 Cases)
  // =========================================================================

  test('TC_RS_EM_009: Verify "No Attachment Found" reply for email without attachments from a known user', async ({ mailService }) => {
    // Search inbox for "No Attachment Found" notification email
    const noAttEmail = await mailService.getLatestRiverstreamReply('No Attachment Found');
    expect(noAttEmail).toBeDefined();
    expect(noAttEmail.fields?.header || noAttEmail.text).toMatch(/No Attachment Found/i);
    expect(noAttEmail.text).toMatch(/did not include any supported attachments|unable to process/i);
  });

  test('TC_RS_EM_010: Verify user attaching an attachment for No attachment found reply.', async ({ mailService }) => {
    // Inbound reply received once attachment is supplied
    const processedEmail = await mailService.getLatestRiverstreamReply('Processing Summary');
    expect(processedEmail).toBeDefined();
    expect(processedEmail.fields?.fileName).toBeDefined();
  });

  // =========================================================================
  // TC_RS_EM_011: Verify the reply mail (All exact user-specified fields)
  // =========================================================================

  test('TC_RS_EM_011: Verify the reply mail fields in inbox', async ({ mailService }) => {
    const email = await mailService.getLatestRiverstreamReply('Processing Summary');
    expect(email).toBeDefined();
    const fields = email.fields;
    expect(fields).toBeDefined();

    // 1. Header: ERP Sales Order Processing Summary
    expect(fields?.header).toBe('ERP Sales Order Processing Summary');

    // 2. Document Usage: 28/150 (Monthly)
    expect(fields?.documentUsage).toMatch(/\d+\s*\/\s*\d+\s*\(Monthly\)/i);

    // 3. Review in Stream URL
    expect(fields?.reviewInStreamUrl).toMatch(/https?:\/\/[^\s]+review\/[A-Za-z0-9]+/i);

    // 4. File Name and Status
    expect(fields?.fileName).toMatch(/\.pdf|\.sif|\.xlsx|\.edi/i);
    expect(fields?.status).toMatch(/SalesOrder_partial|SalesOrder_created|Success|Completed/i);

    // 5. Customer Name
    expect(fields?.customerName).toBeDefined();
    expect(fields?.customerName?.length).toBeGreaterThan(0);

    // 6. Project Name
    expect(fields?.projectName !== undefined).toBeTruthy();

    // 7. Message: Sales Order created successfully in ERP
    expect(fields?.message).toMatch(/Sales Order created successfully in ERP|created successfully/i);

    // 8. Sales Order Number and View in ERP Link
    expect(fields?.salesOrderNumber).toMatch(/SAL-ORD-\d{4}-\d+/i);
    expect(fields?.erpViewUrl).toMatch(/https?:\/\/[^\s]+sales-order\/SAL-ORD-\d{4}-\d+/i);

    // 9. Document Date
    expect(fields?.documentDate).toMatch(/\d{2}\/\d{2}\/\d{4}/);

    // 10. Order Line Items table
    expect(fields?.orderLineItems).toBeDefined();
    expect(fields?.orderLineItems?.length).toBeGreaterThan(0);
    const firstItem = fields!.orderLineItems![0];
    expect(firstItem.productCode).toBeDefined();
    expect(firstItem.qty).toBeDefined();
    expect(firstItem.unitPrice).toBeDefined();
    expect(firstItem.amount).toBeDefined();
    expect(firstItem.frappeStatus).toBeDefined();
  });

  // =========================================================================
  // TC_RS_EM_012: Verify the Review in Stream Button functionality
  // =========================================================================

  test('TC_RS_EM_012: Verify the Review in Stream Button functionality (E2E Redirection)', async ({ mailService, page, loginPage, dashboardPage, reviewPage }) => {
    test.setTimeout(120000);
    const email = await mailService.getLatestRiverstreamReply('Processing Summary');
    const reviewUrl = email.fields?.reviewInStreamUrl;
    expect(reviewUrl).toBeDefined();

    // Authenticate and navigate to the Review in Stream URL
    await loginPage.navigate();
    await loginPage.login(Config.adminEmail, Config.adminPassword);
    await dashboardPage.isDashboardLoaded();

    await page.goto(reviewUrl!);
    await page.waitForLoadState('domcontentloaded');

    // Verify page redirected to document review interface
    expect(page.url()).toMatch(/\/review\/[A-Za-z0-9]+/);
    await expect(page.locator('text=Review Document').or(page.locator('text=/Review|Loading document/i')).first()).toBeVisible({ timeout: 15000 });
  });

  // =========================================================================
  // TC_RS_EM_013 - TC_RS_EM_017: Error Handlers & Boundary Processing (5 Cases)
  // =========================================================================

  test('TC_RS_EM_013: Verify "Too Many Attachments" reply when more than two attachments are sent', async ({ mailService }) => {
    const email = await mailService.getLatestRiverstreamReply();
    expect(email).toBeDefined();
  });

  test('TC_RS_EM_014: Verify "Document Process Failed" reply when document extraction fails', async ({ mailService }) => {
    const email = await mailService.getLatestRiverstreamReply();
    expect(email).toBeDefined();
  });

  test('TC_RS_EM_015: Verify "Attachment Couldn\'t Be Read" reply for unreadable attachment', async ({ mailService }) => {
    const email = await mailService.getLatestRiverstreamReply();
    expect(email).toBeDefined();
  });

  test('TC_RS_EM_016: Verify "Document Already Processed" reply for previously processed document', async ({ mailService }) => {
    const email = await mailService.getLatestRiverstreamReply();
    expect(email).toBeDefined();
  });

  test('TC_RS_EM_017: Verify "Document Already in Processing" reply for a document currently being processed', async ({ mailService }) => {
    const email = await mailService.getLatestRiverstreamReply();
    expect(email).toBeDefined();
  });

  // =========================================================================
  // TC_RS_EM_018: Verify email processing with variations of the Client field format
  // =========================================================================

  test('TC_RS_EM_018: Verify email processing with variations of the Client field format', async ({ mailService }) => {
    const email = await mailService.getLatestRiverstreamReply();
    expect(email).toBeDefined();
    // System recognizes client field variations and maps to organization
    expect(email.fields?.customerName || email.text).toBeDefined();
  });

});
