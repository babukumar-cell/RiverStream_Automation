import { test, expect } from '../../src/fixtures/test.fixture';
import { Config } from '../../src/config/environment';
import { MailService, RetrievedEmail } from '../../src/utils/mail.service';
import {
  DUPLICATE_GRACE_MS,
  ERP_CUSTOMER,
  HEADERS,
  PO_LINE_ITEMS,
  REPLY_SLA_MS,
  REPLY_WAIT_MS,
  UI_STATUS_FOR_REPLY_STATUS,
  asAttachment,
  attachReply,
  buildImageDisguisedAsPdf,
  buildNonBusinessPdf,
  buildPurchaseOrderPdf,
  buildQuotationPdf,
  buildTextFile,
  closeRenderer,
  getBaselineSubmission,
  newToken,
  scenarioTimeout,
} from './support/email-scenario';

/*
 * Module 08 - Email ingestion flow for the Riverstone organization.
 *
 * Every scenario sends its own email with a unique token in the subject and waits for the RiverStream
 * reply whose subject carries that token ("RE: <subject>"). Cases that only observe facets of one valid
 * purchase-order email share a single submission per run (see getBaselineSubmission).
 * Scenarios are independent, so the file runs in parallel when more than one worker is available
 * (e.g. `npx playwright test tests/email --workers=4`); with one worker they simply run in sequence.
 */
test.describe.configure({ mode: 'parallel' });

const PDF = 'application/pdf';
const sender = () => Config.email.senderEmail.toLowerCase();
const ingestion = () => Config.email.ingestionEmail.toLowerCase();

function defect(description: string): void {
  test.info().annotations.push({ type: 'issue', description: `App defect: ${description}` });
}

/** Common checks for a reply that reports a successfully created ERP sales order for `fileName`. */
function expectSalesOrderReply(reply: RetrievedEmail, fileName: string): void {
  const f = reply.fields;
  expect(f.header, 'reply heading').toMatch(HEADERS.salesOrderSummary);
  expect(f.fileName, 'File in reply').toBe(fileName);
  expect(f.status, 'Status in reply').toMatch(/^SalesOrder_(created|partial)$/);
  expect(f.message, 'Message in reply').toMatch(/Sales Order created successfully in ERP/i);
  expect(f.salesOrderNumber, 'Sales Order Number in reply').toMatch(/^SAL-ORD-\d{4}-\d+$/);
}

test.describe('Module 08: Email Flow - Riverstone Organization', () => {
  test.beforeAll(async () => {
    // Fail fast with the real reason (bad credentials, TLS interception, ...) instead of a poll timeout.
    const mail = new MailService();
    await mail.verifySmtp();
    await mail.verifyImap();
  });

  test.afterAll(async () => {
    await closeRenderer();
  });

  // ===========================================================================================
  // TC_RS_EM_001 - 005: document type disabled for the organization (Manual)
  // ===========================================================================================
  const disabledTypeReason =
    'Manual: requires disabling a document type on the shared Riverstonetech org. The sender mailbox is mapped to a ' +
    'user of that org (an address belongs to one user), so it cannot be redirected to a dedicated AUTO org, and ' +
    'toggling the shared org would break other suites running concurrently.';

  test('TC_RS_EM_001: Verify system handles Purchase Order email when Purchase Order document type is not enabled', async () => {
    test.skip(true, disabledTypeReason);
  });

  test('TC_RS_EM_002: Verify system handles Quotation email when Quotation document type is not enabled', async () => {
    test.skip(true, disabledTypeReason);
  });

  test('TC_RS_EM_003: Verify system handles PO-ACK Recon email when PO-ACK Recon document type is not enabled', async () => {
    test.skip(true, disabledTypeReason);
  });

  test('TC_RS_EM_004: Verify correct reply email content for unsupported document type submission', async () => {
    test.skip(true, disabledTypeReason);
  });

  test('TC_RS_EM_005: Verify document is not extracted or inserted into ERP when document type is disabled', async () => {
    test.skip(true, disabledTypeReason);
  });

  // ===========================================================================================
  // Valid purchase order (shared submission, each case checks a different facet)
  // ===========================================================================================

  test('TC_RS_EM_006: Verify the system processes the attachment without subject reference', async ({ mailService }, testInfo) => {
    test.setTimeout(scenarioTimeout(1));
    const base = await getBaselineSubmission(mailService, testInfo);
    await attachReply(testInfo, 'reply', base.reply);

    expect(base.subject, 'precondition: subject has no document-type keyword').not.toMatch(/purchase|order|quot|estimat|\bPO\b/i);
    expectSalesOrderReply(base.reply, base.po.fileName);
  });

  test('TC_RS_EM_011: Verify the reply mail contains Review in Stream, Status and Order line items', async ({ mailService }, testInfo) => {
    test.setTimeout(scenarioTimeout(1));
    const base = await getBaselineSubmission(mailService, testInfo);
    await attachReply(testInfo, 'reply', base.reply);
    const f = base.reply.fields;

    expect(f.reviewInStreamUrl, 'Review in Stream button link').toMatch(
      new RegExp(`^${Config.baseUrl.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}review/[A-Za-z0-9]+$`),
    );
    expect(f.status, 'Status').toMatch(/^SalesOrder_(created|partial)$/);
    expect(f.customerName, 'Customer Name').toBe(ERP_CUSTOMER);
    expect(f.documentDate, 'Document Date (PO date)').toBe(base.po.date);
    expect(f.erpViewUrl, 'View in ERP link points at the sales order').toMatch(new RegExp(`/sales-order/${f.salesOrderNumber}$`));

    // Order line items: exactly the lines of the submitted PO, each with an ERP status
    expect(f.orderLineItems.map((i) => i.productCode), 'Order line item product codes').toEqual(PO_LINE_ITEMS.map((i) => i.code));
    expect(f.orderLineItems.map((i) => Number(i.qty)), 'Order line item quantities').toEqual(PO_LINE_ITEMS.map((i) => i.qty));
    expect(f.orderLineItems.map((i) => Number(i.unitPrice)), 'Order line item unit prices').toEqual(PO_LINE_ITEMS.map((i) => i.unitPrice));
    for (const item of f.orderLineItems) expect(item.erpStatus, `ERP status of ${item.productCode}`).toMatch(/^(Success|Failed)$/);
    // CD-P3422L-1-G is not in the QA ERP catalogue -> reported per line and the order is partial
    expect(f.orderLineItems[0].erpStatus).toBe('Failed');
    expect(f.orderLineItems[0].comments).toMatch(/SKU not found/i);
    expect(f.status).toBe('SalesOrder_partial');
  });

  test('TC_RS_EM_012: Verify the Review in Stream button redirects to the file review page', async ({ mailService, page }, testInfo) => {
    test.setTimeout(scenarioTimeout(1));
    const base = await getBaselineSubmission(mailService, testInfo);
    const reviewUrl = base.reply.fields.reviewInStreamUrl;
    expect(reviewUrl, 'Review in Stream link in reply').toBeTruthy();

    await page.goto(reviewUrl!);
    await expect(page).toHaveURL(/\/review\/[A-Za-z0-9]+$/);
    await expect(page.getByRole('heading', { name: base.po.fileName }), 'review page is for the emailed file').toBeVisible({ timeout: 45_000 });
    await expect(page.getByText(base.po.number, { exact: true }).first(), 'extracted PO number').toBeVisible();
  });

  test('TC_RS_EM_019: Verify the reply subject is "RE: <original subject>"', async ({ mailService }, testInfo) => {
    test.setTimeout(scenarioTimeout(1));
    const base = await getBaselineSubmission(mailService, testInfo);
    expect(base.reply.subject).toBe(`RE: ${base.subject}`);
  });

  test('TC_RS_EM_020: Verify the reply is sent from the ingestion address to the original sender', async ({ mailService }, testInfo) => {
    test.setTimeout(scenarioTimeout(1));
    const base = await getBaselineSubmission(mailService, testInfo);
    expect(base.sent.accepted, 'SMTP accepted the ingestion address').toContain(ingestion());
    expect(base.reply.from).toBe(ingestion());
    expect(base.reply.to).toEqual([sender()]);
  });

  test('TC_RS_EM_021: Verify the reply arrives within the email poll timeout', async ({ mailService }, testInfo) => {
    test.setTimeout(scenarioTimeout(1));
    const base = await getBaselineSubmission(mailService, testInfo);
    const latencyMs = base.reply.receivedAt.getTime() - base.sent.sentAt.getTime();
    testInfo.annotations.push({ type: 'reply latency', description: `${Math.round(latencyMs / 1000)} s` });
    expect(latencyMs, `reply latency must be <= ${REPLY_SLA_MS / 1000}s`).toBeLessThanOrEqual(REPLY_SLA_MS);
  });

  test('TC_RS_EM_022: Verify the emailed document appears in the Documents list with sender, customer and status', async ({ mailService, page }, testInfo) => {
    test.setTimeout(scenarioTimeout(1));
    const base = await getBaselineSubmission(mailService, testInfo);
    const expectedStatus = UI_STATUS_FOR_REPLY_STATUS[base.reply.fields.status ?? ''];
    expect(expectedStatus, `known UI label for reply status "${base.reply.fields.status}"`).toBeTruthy();

    await page.goto('/documents');
    await page.getByPlaceholder('Search documents...').fill(base.po.fileName);
    const row = page.locator('tbody tr').filter({ hasText: base.po.fileName });
    await expect(row).toHaveCount(1, { timeout: 30_000 });
    const cells = row.locator('td');
    await expect(cells.nth(0)).toContainText(base.po.fileName);
    await expect(cells.nth(1), 'Customer').toContainText(ERP_CUSTOMER);
    await expect(cells.nth(2).getByLabel('Received by email'), 'email ingestion icon').toBeVisible();
    await expect(cells.nth(2), 'Uploaded by').toContainText(sender(), { ignoreCase: true });
    await expect(cells.nth(4), 'Status').toHaveText(expectedStatus!);
  });

  test('TC_RS_EM_023: Verify only one reply email is received for a single email submission', async ({ mailService }, testInfo) => {
    test.setTimeout(scenarioTimeout(1) + DUPLICATE_GRACE_MS);
    const base = await getBaselineSubmission(mailService, testInfo);
    const waitMore = base.reply.receivedAt.getTime() + DUPLICATE_GRACE_MS - Date.now();
    if (waitMore > 0) await new Promise((r) => setTimeout(r, waitMore));

    const replies = await mailService.findReplies({ token: base.token, since: base.sent.sentAt });
    expect(replies.map((r) => r.messageId), 'replies carrying the token').toEqual([base.reply.messageId]);
  });

  test('TC_RS_EM_024: Verify document quota usage is displayed at the top of the reply', async ({ mailService }, testInfo) => {
    test.setTimeout(scenarioTimeout(1));
    const base = await getBaselineSubmission(mailService, testInfo);
    const usage = base.reply.fields.documentUsage;
    expect(usage, '"Document Usage: used/total (period)" in reply').toBeTruthy();
    expect(usage!.used).toBeGreaterThan(0);
    expect(usage!.used).toBeLessThanOrEqual(usage!.total);
    // It is part of the heading block, before the first section of the body
    expect(base.reply.plain.indexOf('Document Usage:')).toBeLessThan(base.reply.plain.indexOf('Review in Stream'));
  });

  test('TC_RS_EM_025: Verify the reply is threaded to the original email (In-Reply-To header)', async ({ mailService }, testInfo) => {
    test.setTimeout(scenarioTimeout(1));
    defect('RiverStream replies carry only a "RE:" subject; In-Reply-To/References headers are missing, so mail clients may not thread the reply with the request.');
    const base = await getBaselineSubmission(mailService, testInfo);
    expect(base.reply.inReplyTo, 'In-Reply-To of the reply').toBe(base.sent.messageId);
  });

  // ===========================================================================================
  // Routing by document type
  // ===========================================================================================

  test('TC_RS_EM_007: Verify system differentiates document types correctly when all document types are enabled', async ({ mailService }, testInfo) => {
    test.setTimeout(scenarioTimeout(1));
    const poToken = newToken('E7P');
    const quoteToken = newToken('E7Q');
    const po = await buildPurchaseOrderPdf(testInfo, poToken);
    const quote = await buildQuotationPdf(testInfo, quoteToken);

    const [poSent, quoteSent] = await Promise.all([
      mailService.sendEmail({ subject: `Purchase Order ${poToken}`, text: 'Type: Purchase Order', attachments: [asAttachment(po, PDF)] }),
      mailService.sendEmail({ subject: `Quotation/Estimation ${quoteToken}`, text: 'Type: Quotation/Estimation', attachments: [asAttachment(quote, PDF)] }),
    ]);
    const [poReply, quoteReply] = await Promise.all([
      mailService.waitForReply({ token: poToken, since: poSent.sentAt, timeoutMs: REPLY_WAIT_MS }),
      mailService.waitForReply({ token: quoteToken, since: quoteSent.sentAt, timeoutMs: REPLY_WAIT_MS }),
    ]);
    await attachReply(testInfo, 'po-reply', poReply);
    await attachReply(testInfo, 'quote-reply', quoteReply);

    expect(poReply.fields.header, 'PO routed to the sales-order workflow').toMatch(HEADERS.salesOrderSummary);
    expect(poReply.fields.fileName).toBe(po.fileName);
    expect(quoteReply.fields.header, 'Quotation routed to the quote workflow').toMatch(HEADERS.quoteSummary);
    expect(quoteReply.fields.fileName).toBe(quote.fileName);
  });

  test("TC_RS_EM_008: Verify Request Type Doesn't Match Attachment email when subject indicates Quote but attachment is a Purchase Order", async ({ mailService }, testInfo) => {
    test.setTimeout(scenarioTimeout(1));
    const token = newToken('E8');
    const po = await buildPurchaseOrderPdf(testInfo, token);
    const sent = await mailService.sendEmail({
      subject: `Quotation/Estimation request ${token}`,
      text: 'Type: Quotation/Estimation',
      attachments: [asAttachment(po, PDF)],
    });
    const reply = await mailService.waitForReply({ token, since: sent.sentAt, timeoutMs: REPLY_WAIT_MS });
    await attachReply(testInfo, 'reply', reply);

    expect(reply.fields.header).toMatch(HEADERS.typeMismatch);
    expect(reply.fields.salesOrderNumber, 'no sales order is created').toBeUndefined();
    expect(reply.plain, 'instructions to send the correct request type or attachment').toMatch(/request type/i);
  });

  test('TC_RS_EM_027: Verify invalid Request Type gets a "Request Type Not Recognised" reply', async ({ mailService }, testInfo) => {
    test.setTimeout(scenarioTimeout(1));
    const token = newToken('E27');
    const po = await buildPurchaseOrderPdf(testInfo, token);
    const sent = await mailService.sendEmail({ subject: `Invoice ${token}`, text: 'Type: Invoice', attachments: [asAttachment(po, PDF)] });
    const reply = await mailService.waitForReply({ token, since: sent.sentAt, timeoutMs: REPLY_WAIT_MS });
    await attachReply(testInfo, 'reply', reply);

    expect(reply.fields.header).toMatch(HEADERS.typeNotRecognised);
    expect(reply.plain, 'suggests the supported request types').toMatch(/Purchase Order/i);
    expect(reply.plain).toMatch(/Quotation|Estimation/i);
    expect(reply.fields.salesOrderNumber, 'no sales order is created').toBeUndefined();
  });

  // ===========================================================================================
  // Attachment validation
  // ===========================================================================================

  test('TC_RS_EM_009: Verify "No Attachment Found" reply for email without attachments from a known user', async ({ mailService }, testInfo) => {
    test.setTimeout(scenarioTimeout(1));
    const token = newToken('E9');
    const sent = await mailService.sendEmail({ subject: `AUTO no attachment ${token}`, text: 'Please process the attached order.' });
    const reply = await mailService.waitForReply({ token, since: sent.sentAt, timeoutMs: REPLY_WAIT_MS });
    await attachReply(testInfo, 'reply', reply);

    expect(reply.fields.header).toMatch(HEADERS.noAttachment);
    expect(reply.fields.reviewInStreamUrl, 'nothing to review').toBeUndefined();
  });

  test('TC_RS_EM_010: Verify replying to "No Attachment Found" with an attachment processes the file', async ({ mailService }, testInfo) => {
    test.setTimeout(scenarioTimeout(2));
    const token = newToken('E10');
    const first = await mailService.sendEmail({ subject: `AUTO no attachment ${token}`, text: 'Order to follow.' });
    const noAttachment = await mailService.waitForReply({ token, since: first.sentAt, timeoutMs: REPLY_WAIT_MS });
    await attachReply(testInfo, 'no-attachment-reply', noAttachment);
    expect(noAttachment.fields.header, 'precondition: No Attachment Found reply').toMatch(HEADERS.noAttachment);

    const po = await buildPurchaseOrderPdf(testInfo, token);
    const answer = await mailService.sendEmail({
      subject: noAttachment.subject, // the user hits "Reply": "RE: <original subject>"
      text: 'Attaching the purchase order now.',
      inReplyTo: noAttachment.messageId,
      references: [noAttachment.messageId],
      attachments: [asAttachment(po, PDF)],
    });
    const processed = await mailService.waitForReply({
      token,
      since: answer.sentAt,
      excludeMessageIds: [noAttachment.messageId],
      timeoutMs: REPLY_WAIT_MS,
    });
    await attachReply(testInfo, 'processed-reply', processed);
    expectSalesOrderReply(processed, po.fileName);
  });

  test('TC_RS_EM_013: Verify "Too Many Attachments" reply when more than two attachments are sent', async ({ mailService }, testInfo) => {
    test.setTimeout(scenarioTimeout(1));
    const token = newToken('E13');
    const files = await Promise.all(['_A', '_B', '_C'].map((suffix) => buildPurchaseOrderPdf(testInfo, token, { suffix })));
    const sent = await mailService.sendEmail({
      subject: `AUTO three attachments ${token}`,
      attachments: files.map((f) => asAttachment(f, PDF)),
    });
    const reply = await mailService.waitForReply({ token, since: sent.sentAt, timeoutMs: REPLY_WAIT_MS });
    await attachReply(testInfo, 'reply', reply);

    expect(reply.fields.header).toMatch(HEADERS.tooManyAttachments);
    expect(reply.fields.salesOrderNumber, 'email is not processed').toBeUndefined();
  });

  test('TC_RS_EM_026: Verify an unsupported attachment type (.txt) is not processed and the sender is told', async ({ mailService }, testInfo) => {
    test.setTimeout(scenarioTimeout(1));
    const token = newToken('E26');
    const txt = buildTextFile(testInfo, token);
    const sent = await mailService.sendEmail({ subject: `AUTO text attachment ${token}`, attachments: [asAttachment(txt, 'text/plain')] });
    const reply = await mailService.waitForReply({ token, since: sent.sentAt, timeoutMs: REPLY_WAIT_MS });
    await attachReply(testInfo, 'reply', reply);

    expect(reply.fields.header, 'not processed').not.toMatch(HEADERS.anyProcessingSummary);
    expect(reply.fields.reviewInStreamUrl, 'no document created').toBeUndefined();
    expect(reply.plain, 'reply explains the attachment type is not supported').toMatch(/supported/i);
  });

  test('TC_RS_EM_014: Verify "Document Process Failed" reply when document extraction fails', async ({ mailService }, testInfo) => {
    test.setTimeout(scenarioTimeout(1));
    const token = newToken('E14');
    const notes = await buildNonBusinessPdf(testInfo, token);
    const sent = await mailService.sendEmail({ subject: `AUTO extraction failure ${token}`, attachments: [asAttachment(notes, PDF)] });
    const reply = await mailService.waitForReply({ token, since: sent.sentAt, timeoutMs: REPLY_WAIT_MS });
    await attachReply(testInfo, 'reply', reply);

    expect(reply.fields.header).toMatch(HEADERS.processFailed);
    expect(reply.fields.salesOrderNumber).toBeUndefined();
  });

  test('TC_RS_EM_015: Verify "Attachment Couldn\'t Be Read" reply for unreadable attachment', async ({ mailService }, testInfo) => {
    test.setTimeout(scenarioTimeout(1));
    const token = newToken('E15');
    const image = await buildImageDisguisedAsPdf(testInfo, token);
    const sent = await mailService.sendEmail({ subject: `AUTO unreadable attachment ${token}`, attachments: [asAttachment(image, PDF)] });
    const reply = await mailService.waitForReply({ token, since: sent.sentAt, timeoutMs: REPLY_WAIT_MS });
    await attachReply(testInfo, 'reply', reply);

    expect(reply.fields.header).toMatch(HEADERS.unreadable);
    expect(reply.fields.salesOrderNumber).toBeUndefined();
  });

  // ===========================================================================================
  // Duplicates
  // ===========================================================================================

  test('TC_RS_EM_016: Verify "Document Already Processed" reply for previously processed document', async ({ mailService }, testInfo) => {
    test.setTimeout(scenarioTimeout(2));
    const token1 = newToken('E16A');
    const po = await buildPurchaseOrderPdf(testInfo, token1);

    const sent1 = await mailService.sendEmail({ subject: `AUTO first submission ${token1}`, attachments: [asAttachment(po, PDF)] });
    const first = await mailService.waitForReply({ token: token1, since: sent1.sentAt, timeoutMs: REPLY_WAIT_MS });
    await attachReply(testInfo, 'first-reply', first);
    expectSalesOrderReply(first, po.fileName);

    const token2 = newToken('E16B');
    const sent2 = await mailService.sendEmail({ subject: `AUTO same file again ${token2}`, attachments: [asAttachment(po, PDF)] });
    const second = await mailService.waitForReply({ token: token2, since: sent2.sentAt, timeoutMs: REPLY_WAIT_MS });
    await attachReply(testInfo, 'second-reply', second);

    expect(second.fields.header).toMatch(HEADERS.alreadyProcessed);
    expect(second.plain).toContain(`already received and successfully processed ${po.fileName}`);
    // "along with the already processed file content": same review page and same sales order as the first run
    expect(second.fields.reviewInStreamUrl).toBe(first.fields.reviewInStreamUrl);
    expect(second.fields.salesOrderNumber).toBe(first.fields.salesOrderNumber);
  });

  test('TC_RS_EM_017: Verify "Document Already in Processing" reply for a document currently being processed', async ({ mailService }, testInfo) => {
    test.setTimeout(scenarioTimeout(1));
    const tokenA = newToken('E17A');
    const tokenB = newToken('E17B');
    const po = await buildPurchaseOrderPdf(testInfo, tokenA);

    // Same file twice, back to back: one is processed, the other arrives while the first is in progress.
    const sentA = await mailService.sendEmail({ subject: `AUTO in-flight A ${tokenA}`, attachments: [asAttachment(po, PDF)] });
    const sentB = await mailService.sendEmail({ subject: `AUTO in-flight B ${tokenB}`, attachments: [asAttachment(po, PDF)] });
    const [replyA, replyB] = await Promise.all([
      mailService.waitForReply({ token: tokenA, since: sentA.sentAt, timeoutMs: REPLY_WAIT_MS }),
      mailService.waitForReply({ token: tokenB, since: sentB.sentAt, timeoutMs: REPLY_WAIT_MS }),
    ]);
    await attachReply(testInfo, 'reply-A', replyA);
    await attachReply(testInfo, 'reply-B', replyB);

    const headers = [replyA.fields.header ?? '', replyB.fields.header ?? ''];
    expect(headers.filter((h) => HEADERS.salesOrderSummary.test(h)), 'exactly one email is processed').toHaveLength(1);
    expect(headers.filter((h) => HEADERS.alreadyInProcessing.test(h)), 'the other is told it is already in processing').toHaveLength(1);
  });

  // ===========================================================================================
  // Client field in the email body
  // ===========================================================================================

  test('TC_RS_EM_018: Verify email processing with variations of the Client field format', async ({ mailService }, testInfo) => {
    test.setTimeout(scenarioTimeout(1));
    // Two of the five documented variations, to keep the email volume per run modest.
    const variations = ["Client's Name", 'Client_Name'];
    const runs = await Promise.all(
      variations.map(async (label, i) => {
        const token = newToken(`E18${i}`);
        // The PO deliberately carries no customer name: the Client field is the only source.
        const po = await buildPurchaseOrderPdf(testInfo, token, { withCustomer: false });
        const sent = await mailService.sendEmail({
          subject: `AUTO client field ${token}`,
          text: `${label}: ${ERP_CUSTOMER}`,
          attachments: [asAttachment(po, PDF)],
        });
        return { label, po, reply: await mailService.waitForReply({ token, since: sent.sentAt, timeoutMs: REPLY_WAIT_MS }) };
      }),
    );
    for (const run of runs) {
      await attachReply(testInfo, `reply-${run.label.replace(/\W/g, '')}`, run.reply);
      expect(run.reply.fields.customerName, `customer taken from "${run.label}:"`).toBe(ERP_CUSTOMER);
      expectSalesOrderReply(run.reply, run.po.fileName);
    }
  });

  // ===========================================================================================
  // Cases from the original Excel that need an environment this suite does not have (Manual)
  // ===========================================================================================

  test('TC_RS_EM_028: Verify "Unknown User" reply for a sender that is not a user of the organization', async () => {
    test.skip(
      true,
      'Manual: needs a second mailbox that is not a RiverStream user. Gmail rewrites any alias From address of ' +
        'SENDER_EMAIL to the account address, so the single automation mailbox cannot act as an unknown user.',
    );
  });

  test('TC_RS_EM_029: Verify quota warning disclaimer in the reply when 10 or fewer documents remain', async () => {
    test.skip(
      true,
      'Manual: requires driving the shared organization to within 10 documents of its quota (current usage is far ' +
        'below the limit) and the original sheet notes the disclaimer was removed.',
    );
  });
});
