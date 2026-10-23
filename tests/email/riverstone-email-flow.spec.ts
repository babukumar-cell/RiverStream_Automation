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
  asAttachment,
  attachReply,
  buildImageDisguisedAsPdf,
  buildPurchaseOrderPdf,
  buildQuotationPdf,
  closeRenderer,
  getBaselineSubmission,
  newToken,
  scenarioTimeout,
} from './support/email-scenario';

test.describe.configure({ mode: 'parallel' });

const PDF = 'application/pdf';

function expectSalesOrderReply(reply: RetrievedEmail, fileName: string): void {
  const f = reply.fields;
  expect(f.header, 'reply heading').toMatch(HEADERS.salesOrderSummary);
  expect(f.fileName, 'File in reply').toBe(fileName);
  expect(f.status, 'Status in reply').toMatch(/^SalesOrder_(created|partial)$/);
  expect(f.message, 'Message in reply').toMatch(/Sales Order created successfully in ERP/i);
  expect(f.salesOrderNumber, 'Sales Order Number in reply').toMatch(/^SAL-ORD-\d{4}-\d+$/);
}

test.describe('River Stream - Email Flow Suite (16 Test Cases - Riverstone Org)', () => {
  test.beforeAll(async () => {
    const mail = new MailService();
    await mail.verifySmtp();
    await mail.verifyImap();
  });

  test.afterAll(async () => {
    await closeRenderer();
  });

  const disabledTypeReason =
    'Manual: requires disabling a document type on the shared Riverstonetech org in Settings. ' +
    'The sender mailbox is mapped to an active organization user; toggling settings on the shared org would impact parallel suites.';

  test('TC_001: Verify system handles Purchase Order email when Purchase Order document type is not enabled', async () => {
    test.skip(true, disabledTypeReason);
  });

  test('TC_002: Verify system handles Quotation email when Quotation document type is not enabled', async () => {
    test.skip(true, disabledTypeReason);
  });

  test('TC_003: Verify system handles PO-ACK Recon email when PO-ACK Recon document type is not enabled', async () => {
    test.skip(true, disabledTypeReason);
  });

  test('TC_004: Verify correct reply email content for unsupported document type submission', async () => {
    test.skip(true, disabledTypeReason);
  });

  test('TC_005: Verify document is not extracted or inserted into ERP when document type is disabled', async () => {
    test.skip(true, disabledTypeReason);
  });

  test('TC_006: Verify the system process the attachment without subject reference.', async ({ mailService }, testInfo) => {
    test.setTimeout(scenarioTimeout(1));
    const base = await getBaselineSubmission(mailService, testInfo);
    await attachReply(testInfo, 'reply', base.reply);

    expect(base.subject, 'subject has no document-type keyword').not.toMatch(/purchase|order|quot|estimat|\bPO\b/i);
    expectSalesOrderReply(base.reply, base.po.fileName);
  });

  test('TC_007: Verify system differentiates document types correctly when all document types are enabled', async ({ mailService }, testInfo) => {
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

    expect(poReply.fields.header, 'PO routed to sales-order workflow').toMatch(HEADERS.salesOrderSummary);
    expect(poReply.fields.fileName).toBe(po.fileName);
    expect(quoteReply.fields.header, 'Quotation routed to quote workflow').toMatch(HEADERS.quoteSummary);
    expect(quoteReply.fields.fileName).toBe(quote.fileName);
  });

  test("TC_008: Verify Request Type Doesn't Match Attachment Email is Sent When Subject Indicates Quote but Attachment is a Purchase Order", async ({ mailService }, testInfo) => {
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
    expect(reply.plain).toMatch(/request type/i);
  });

  test('TC_009: Verify "No Attachment Found" reply for email without attachments from a known user', async ({ mailService }, testInfo) => {
    test.setTimeout(scenarioTimeout(1));
    const token = newToken('E9');
    const sent = await mailService.sendEmail({ subject: `AUTO no attachment ${token}`, text: 'Please process the attached order.' });
    const reply = await mailService.waitForReply({ token, since: sent.sentAt, timeoutMs: REPLY_WAIT_MS });
    await attachReply(testInfo, 'reply', reply);

    expect(reply.fields.header).toMatch(HEADERS.noAttachment);
    expect(reply.fields.reviewInStreamUrl).toBeUndefined();
  });

  test('TC_010: Verify user attaching an attachment for No attachment found reply.', async ({ mailService }, testInfo) => {
    test.setTimeout(scenarioTimeout(2));
    const token = newToken('E10');
    const first = await mailService.sendEmail({ subject: `AUTO no attachment ${token}`, text: 'Order to follow.' });
    const noAttachment = await mailService.waitForReply({ token, since: first.sentAt, timeoutMs: REPLY_WAIT_MS });
    await attachReply(testInfo, 'no-attachment-reply', noAttachment);
    expect(noAttachment.fields.header).toMatch(HEADERS.noAttachment);

    const po = await buildPurchaseOrderPdf(testInfo, token);
    const answer = await mailService.sendEmail({
      subject: noAttachment.subject,
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

  test('TC_011: Verify the reply mail', async ({ mailService }, testInfo) => {
    test.setTimeout(scenarioTimeout(1));
    const base = await getBaselineSubmission(mailService, testInfo);
    await attachReply(testInfo, 'reply', base.reply);
    const f = base.reply.fields;

    expect(f.reviewInStreamUrl).toMatch(
      new RegExp(`^${Config.baseUrl.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}review/[A-Za-z0-9]+$`),
    );
    expect(f.status).toMatch(/^SalesOrder_(created|partial)$/);
    expect(f.customerName).toBe(ERP_CUSTOMER);
    expect(f.documentDate).toBe(base.po.date);
    expect(f.orderLineItems.length).toBeGreaterThan(0);
  });

  test('TC_012: Verify the Review in Stream Button functionality.', async ({ mailService, page }, testInfo) => {
    test.setTimeout(scenarioTimeout(1));
    const base = await getBaselineSubmission(mailService, testInfo);
    const reviewUrl = base.reply.fields.reviewInStreamUrl;
    expect(reviewUrl).toBeTruthy();

    await page.goto(reviewUrl!);
    await expect(page).toHaveURL(/\/review\/[A-Za-z0-9]+$/);
    await expect(page.getByRole('heading', { name: base.po.fileName })).toBeVisible({ timeout: 45_000 });
  });

  test('TC_013: Verify "Too Many Attachments" reply when more than two attachments are sent', async () => {
    test.skip(true, 'Send only one file for email flow test cases as requested');
  });

  test("TC_015: Verify \"Attachment Couldn't Be Read\" reply for unreadable attachment", async ({ mailService }, testInfo) => {
    test.setTimeout(scenarioTimeout(1));
    const token = newToken('E15');
    const image = await buildImageDisguisedAsPdf(testInfo, token);
    const sent = await mailService.sendEmail({ subject: `AUTO unreadable attachment ${token}`, attachments: [asAttachment(image, PDF)] });
    const reply = await mailService.waitForReply({ token, since: sent.sentAt, timeoutMs: REPLY_WAIT_MS });
    await attachReply(testInfo, 'reply', reply);

    expect(reply.fields.header).toMatch(HEADERS.unreadable);
    expect(reply.fields.salesOrderNumber).toBeUndefined();
  });

  test('TC_016: Verify "Document Already Processed" reply for previously processed document', async ({ mailService }, testInfo) => {
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
    expect(second.fields.reviewInStreamUrl).toBe(first.fields.reviewInStreamUrl);
  });

  test('TC_017: Verify "Document Already in Processing" reply for a document currently being processed', async ({ mailService }, testInfo) => {
    test.setTimeout(scenarioTimeout(1));
    const tokenA = newToken('E17A');
    const tokenB = newToken('E17B');
    const po = await buildPurchaseOrderPdf(testInfo, tokenA);

    const sentA = await mailService.sendEmail({ subject: `AUTO in-flight A ${tokenA}`, attachments: [asAttachment(po, PDF)] });
    const sentB = await mailService.sendEmail({ subject: `AUTO in-flight B ${tokenB}`, attachments: [asAttachment(po, PDF)] });
    const [replyA, replyB] = await Promise.all([
      mailService.waitForReply({ token: tokenA, since: sentA.sentAt, timeoutMs: REPLY_WAIT_MS }),
      mailService.waitForReply({ token: tokenB, since: sentB.sentAt, timeoutMs: REPLY_WAIT_MS }),
    ]);
    await attachReply(testInfo, 'reply-A', replyA);
    await attachReply(testInfo, 'reply-B', replyB);

    const headers = [replyA.fields.header ?? '', replyB.fields.header ?? ''];
    expect(headers.filter((h) => HEADERS.salesOrderSummary.test(h))).toHaveLength(1);
    expect(headers.filter((h) => HEADERS.alreadyInProcessing.test(h))).toHaveLength(1);
  });
});
