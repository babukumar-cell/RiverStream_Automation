import fs from 'fs';
import path from 'path';
import { Page } from '@playwright/test';
import { test, expect } from '../../src/fixtures/test.fixture';
import { Config } from '../../src/config/environment';
import { MailService, RetrievedEmail, SentEmail } from '../../src/utils/mail.service';
import { DocumentsPage, LibraryDocument } from '../../src/pages/documents.page';
import {
  ERP_CUSTOMER,
  HEADERS,
  PO_LINE_ITEMS,
  REPLY_WAIT_MS,
  asAttachment,
  attachPageEvidence,
  attachReply,
  buildImageDisguisedAsPdf,
  buildPurchaseOrderPdf,
  buildQuotationPdf,
  fileDateSuffix,
  getBaselineSubmission,
  newToken,
  scenarioTimeout,
  showReply,
  showWaitingForReply,
} from './support/email-scenario';

// No retries: every attempt sends real emails and uses the QA organisation's monthly document quota.
test.describe.configure({ mode: 'parallel', retries: 0 });
// The end-of-test screenshot is the evidence of each test's final state: capture the whole reply, not just the viewport.
// (Must be top-level: screenshot options cannot be changed inside a describe group.)
test.use({ screenshot: { mode: 'on', fullPage: true } });

const PDF = 'application/pdf';
/** TC_017: real multi-page purchase order that takes RiverStream longer than one mailbox check to process. */
const SLOW_PO_SAMPLE = path.resolve(__dirname, '../../src/test-data/files/sample-po-12-pages.pdf');

/**
 * Polls the Documents library until RiverStream has picked up the emailed file `fileName` (searched by `term`).
 * Returns its library record. RiverStream checks its mailbox about once a minute.
 */
async function waitForLibraryDocument(documentsPage: DocumentsPage, term: string, fileName: string, sentAt: Date): Promise<LibraryDocument> {
  const deadline = Date.now() + REPLY_WAIT_MS;
  for (;;) {
    await documentsPage.navigate();
    const doc = (await documentsPage.search(term)).documents.find((d) => d.fileName === fileName);
    if (doc) return doc;
    if (Date.now() > deadline) {
      throw new Error(`RiverStream did not pick up "${fileName}" (sent ${sentAt.toISOString()}) within ${Math.round(REPLY_WAIT_MS / 60000)} min`);
    }
    await documentsPage.page.waitForTimeout(5000);
  }
}

/*
 * Evidence: while waiting, the browser shows the sent email with a running timer; when a reply arrives it is
 * shown in the browser with the checked parts highlighted. The final state of every test is captured by the
 * automatic end-of-test screenshot (full page, see test.use below); earlier steps of multi-step tests are
 * attached as numbered screenshots ("1 - ..."), so no state is captured twice.
 */

/** Shows the reply, checks (and highlights) its heading and the given texts; attaches a screenshot if `evidenceName` is given. */
async function verifyReplyOnScreen(
  page: Page,
  reply: RetrievedEmail,
  heading: RegExp,
  texts: Array<string | RegExp> = [],
  evidenceName?: string,
): Promise<void> {
  await showReply(page, reply);
  await expect(page.getByRole('heading', { name: heading }), 'reply heading').toBeVisible();
  for (const t of texts) {
    await expect(page.getByText(t).first(), `reply shows ${t}`).toBeVisible();
  }
  if (evidenceName) await attachPageEvidence(page, test.info(), evidenceName);
}

async function expectSalesOrderReply(page: Page, reply: RetrievedEmail, fileName: string, evidenceName?: string): Promise<void> {
  const f = reply.fields;
  expect(f.header, 'reply heading').toMatch(HEADERS.salesOrderSummary);
  expect(f.fileName, 'File in reply').toBe(fileName);
  expect(f.status, 'Status in reply').toMatch(/^SalesOrder_(created|partial)$/);
  expect(f.message, 'Message in reply').toMatch(/Sales Order created successfully in ERP/i);
  expect(f.salesOrderNumber, 'Sales Order Number in reply').toMatch(/^SAL-ORD-\d{4}-\d+$/);
  await verifyReplyOnScreen(
    page,
    reply,
    HEADERS.salesOrderSummary,
    [`File: ${fileName}`, /Message:\s*Sales Order created successfully in ERP/i, `Sales Order Number: ${f.salesOrderNumber}`],
    evidenceName,
  );
}

/** Sends an email and shows it (with a waiting timer) in the browser. */
async function sendAndShow(mail: MailService, page: Page, options: Parameters<MailService['sendEmail']>[0]): Promise<SentEmail> {
  const sent = await mail.sendEmail(options);
  await showWaitingForReply(page, [sent]);
  return sent;
}

test.describe('River Stream - Email Flow Suite (16 Test Cases - Riverstone Org)', () => {
  test.beforeAll(async () => {
    const mail = new MailService();
    await mail.verifySmtp();
    await mail.verifyImap();
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

  test('TC_006: Verify the system process the attachment without subject reference.', async ({ mailService, page }, testInfo) => {
    test.setTimeout(scenarioTimeout(1));
    const base = await getBaselineSubmission(mailService, testInfo, (sent) => showWaitingForReply(page, [sent]));
    await attachReply(testInfo, 'reply', base.reply);

    expect(base.subject, 'subject has no document-type keyword').not.toMatch(/purchase|order|quot|estimat|\bPO\b/i);
    await showReply(page, base.reply);
    await expect(page.locator('#rs-mail-subject'), 'reply subject = neutral subject we sent').toContainText(base.subject);
    await expectSalesOrderReply(page, base.reply, base.po.fileName);
  });

  test('TC_007: Verify system differentiates document types correctly when all document types are enabled', async ({ mailService, page }, testInfo) => {
    test.setTimeout(scenarioTimeout(1));
    const poToken = newToken('E7P');
    const quoteToken = newToken('E7Q');
    const po = await buildPurchaseOrderPdf(testInfo, poToken);
    const quote = await buildQuotationPdf(testInfo, quoteToken);

    const [poSent, quoteSent] = await Promise.all([
      mailService.sendEmail({ subject: `Purchase Order ${poToken}`, text: 'Type: Purchase Order', attachments: [asAttachment(po, PDF)] }),
      mailService.sendEmail({ subject: `Quotation/Estimation ${quoteToken}`, text: 'Type: Quotation/Estimation', attachments: [asAttachment(quote, PDF)] }),
    ]);
    await showWaitingForReply(page, [poSent, quoteSent], 'Waiting for both RiverStream replies');
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

    await verifyReplyOnScreen(page, poReply, HEADERS.salesOrderSummary, [`File: ${po.fileName}`], '1 - Purchase Order reply');
    await verifyReplyOnScreen(page, quoteReply, HEADERS.quoteSummary, [`File: ${quote.fileName}`]);
  });

  test("TC_008: Verify Request Type Doesn't Match Attachment Email is Sent When Subject Indicates Quote but Attachment is a Purchase Order", async ({ mailService, page }, testInfo) => {
    test.setTimeout(scenarioTimeout(1));
    const token = newToken('E8');
    const po = await buildPurchaseOrderPdf(testInfo, token);
    const sent = await sendAndShow(mailService, page, {
      subject: `Quotation/Estimation request ${token}`,
      text: 'Type: Quotation/Estimation',
      attachments: [asAttachment(po, PDF)],
    });
    const reply = await mailService.waitForReply({ token, since: sent.sentAt, timeoutMs: REPLY_WAIT_MS });
    await attachReply(testInfo, 'reply', reply);

    expect(reply.fields.header).toMatch(HEADERS.typeMismatch);
    // Not processed: no sales order and no Review in Stream link
    expect(reply.fields.salesOrderNumber, 'no sales order is created').toBeUndefined();
    expect(reply.fields.reviewInStreamUrl, 'no Review in Stream link').toBeUndefined();
    expect(reply.plain).toMatch(/Your email indicated:\s*Quotation\/Estimation/i);
    expect(reply.plain).toMatch(/Your attachment looks like:\s*Purchase Order/i);
    expect(reply.plain, 'instructions to fix the request').toMatch(/reply with the correct attachment/i);

    await verifyReplyOnScreen(page, reply, HEADERS.typeMismatch, [
      /Your email indicated:\s*Quotation\/Estimation/i,
      /Your attachment looks like:\s*Purchase Order/i,
      /reply with the correct attachment/i,
    ]);
  });

  test('TC_009: Verify "No Attachment Found" reply for email without attachments from a known user', async ({ mailService, page }, testInfo) => {
    test.setTimeout(scenarioTimeout(1));
    const token = newToken('E9');
    const sent = await sendAndShow(mailService, page, { subject: `AUTO no attachment ${token}`, text: 'Please process the attached order.' });
    const reply = await mailService.waitForReply({ token, since: sent.sentAt, timeoutMs: REPLY_WAIT_MS });
    await attachReply(testInfo, 'reply', reply);

    expect(reply.fields.header).toMatch(HEADERS.noAttachment);
    expect(reply.fields.reviewInStreamUrl).toBeUndefined();
    await verifyReplyOnScreen(page, reply, HEADERS.noAttachment, [/did not include any supported attachments/i]);
  });

  test('TC_010: Verify user attaching an attachment for No attachment found reply.', async ({ mailService, page }, testInfo) => {
    test.setTimeout(scenarioTimeout(2));
    const token = newToken('E10');
    const first = await sendAndShow(mailService, page, { subject: `AUTO no attachment ${token}`, text: 'Order to follow.' });
    const noAttachment = await mailService.waitForReply({ token, since: first.sentAt, timeoutMs: REPLY_WAIT_MS });
    await attachReply(testInfo, 'no-attachment-reply', noAttachment);
    expect(noAttachment.fields.header).toMatch(HEADERS.noAttachment);
    await verifyReplyOnScreen(page, noAttachment, HEADERS.noAttachment, [], '1 - No Attachment Found reply');

    const po = await buildPurchaseOrderPdf(testInfo, token);
    const answer = await sendAndShow(mailService, page, {
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
    await expectSalesOrderReply(page, processed, po.fileName);
  });

  test('TC_011: Verify the reply mail', async ({ mailService, page }, testInfo) => {
    test.setTimeout(scenarioTimeout(1));
    const base = await getBaselineSubmission(mailService, testInfo, (sent) => showWaitingForReply(page, [sent]));
    await attachReply(testInfo, 'reply', base.reply);
    const f = base.reply.fields;

    expect(f.reviewInStreamUrl).toMatch(
      new RegExp(`^${Config.baseUrl.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}review/[A-Za-z0-9]+$`),
    );
    expect(f.status).toMatch(/^SalesOrder_(created|partial)$/);
    expect(f.customerName).toBe(ERP_CUSTOMER);
    expect(f.documentDate).toBe(base.po.date);
    expect(f.orderLineItems.map((i) => i.productCode), 'order line items = lines of the PO we sent').toEqual(
      PO_LINE_ITEMS.map((i) => i.code),
    );

    // Review in Stream button, Status and Order line items must be visible in the reply
    await showReply(page, base.reply);
    await expect(page.getByRole('heading', { name: HEADERS.salesOrderSummary })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Review in Stream' })).toBeVisible();
    await expect(page.getByText(`Status: ${f.status}`).first()).toBeVisible();
    await expect(page.getByText(`Customer Name: ${ERP_CUSTOMER}`).first()).toBeVisible();
    await expect(page.getByText(`Document Date: ${base.po.date}`).first()).toBeVisible();
    const lineItems = page.locator('table').filter({ has: page.locator('th', { hasText: 'Product Code' }) });
    await expect(lineItems).toBeVisible();
    await expect(lineItems.locator('tr')).toHaveCount(PO_LINE_ITEMS.length + 1);
  });

  test('TC_012: Verify the Review in Stream Button functionality.', async ({ mailService, page, reviewPage }, testInfo) => {
    test.setTimeout(scenarioTimeout(1));
    const base = await getBaselineSubmission(mailService, testInfo, (sent) => showWaitingForReply(page, [sent]));
    const reviewUrl = base.reply.fields.reviewInStreamUrl;
    expect(reviewUrl, 'Review in Stream link in the reply').toBeTruthy();

    // Click the button in the reply itself
    await showReply(page, base.reply);
    const button = page.getByRole('link', { name: 'Review in Stream' });
    await expect(button).toBeVisible();
    await expect(button).toHaveAttribute('href', reviewUrl!);
    await attachPageEvidence(page, testInfo, '1 - Review in Stream button in the reply');
    await button.click();

    // It must open the review page of this file
    await expect(page).toHaveURL(reviewUrl!);
    await reviewPage.waitForReviewLoaded();
    await expect(page.getByRole('heading', { name: base.po.fileName })).toBeVisible({ timeout: 45_000 });
    // Let the PDF preview finish rendering for the screenshot: the viewer draws the page into a <canvas>
    // (until then it shows a spinner and the zoom reads 0%)
    await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 45_000 });
  });

  test('TC_013: Verify "Too Many Attachments" reply when more than two attachments are sent', async () => {
    test.skip(true, 'Send only one file for email flow test cases as requested');
  });

  test("TC_015: Verify \"Attachment Couldn't Be Read\" reply for unreadable attachment", async ({ mailService, page }, testInfo) => {
    test.setTimeout(scenarioTimeout(1));
    const token = newToken('E15');
    const image = await buildImageDisguisedAsPdf(testInfo, token);
    const sent = await sendAndShow(mailService, page, { subject: `AUTO unreadable attachment ${token}`, attachments: [asAttachment(image, PDF)] });
    const reply = await mailService.waitForReply({ token, since: sent.sentAt, timeoutMs: REPLY_WAIT_MS });
    await attachReply(testInfo, 'reply', reply);

    expect(reply.fields.header).toMatch(HEADERS.unreadable);
    expect(reply.fields.salesOrderNumber).toBeUndefined();
    expect(reply.plain, 'reply names the unreadable file').toContain(image.fileName);
    await verifyReplyOnScreen(page, reply, HEADERS.unreadable, [/could not be opened/i]);
  });

  test('TC_016: Verify "Document Already Processed" reply for previously processed document', async ({ mailService, page }, testInfo) => {
    test.setTimeout(scenarioTimeout(2));
    const token1 = newToken('E16A');
    const po = await buildPurchaseOrderPdf(testInfo, token1);

    const sent1 = await sendAndShow(mailService, page, { subject: `AUTO first submission ${token1}`, attachments: [asAttachment(po, PDF)] });
    const first = await mailService.waitForReply({ token: token1, since: sent1.sentAt, timeoutMs: REPLY_WAIT_MS });
    await attachReply(testInfo, 'first-reply', first);
    await expectSalesOrderReply(page, first, po.fileName, '1 - First submission reply');

    const token2 = newToken('E16B');
    const sent2 = await sendAndShow(mailService, page, { subject: `AUTO same file again ${token2}`, attachments: [asAttachment(po, PDF)] });
    const second = await mailService.waitForReply({ token: token2, since: sent2.sentAt, timeoutMs: REPLY_WAIT_MS });
    await attachReply(testInfo, 'second-reply', second);

    expect(second.fields.header).toMatch(HEADERS.alreadyProcessed);
    expect(second.plain).toContain(`already received and successfully processed ${po.fileName}`);
    expect(second.fields.reviewInStreamUrl).toBe(first.fields.reviewInStreamUrl);

    // The reply carries the already-processed file's content and links to the same review page
    await showReply(page, second);
    await expect(page.getByRole('heading', { name: HEADERS.alreadyProcessed })).toBeVisible();
    await expect(page.getByText(`already received and successfully processed ${po.fileName}`).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Review in Stream' })).toHaveAttribute('href', first.fields.reviewInStreamUrl!);
    await expect(page.getByText(`File: ${po.fileName}`).first()).toBeVisible();
  });

  test('TC_017: Verify "Document Already in Processing" reply for a document currently being processed', async ({ mailService, page, documentsPage }, testInfo) => {
    test.setTimeout(scenarioTimeout(2));
    const tokenA = newToken('E17A');
    const tokenB = newToken('E17B');
    // A real 12-page purchase order: RiverStream needs longer than one mailbox check (~1 min) to process it,
    // so the second email is picked up while the first one is still processing. (The 1-page synthetic PO is
    // finished in ~40 s, before the next check.) Unique file name per run so the duplicate check starts clean.
    const fileName = `AUTO_PO12_${tokenA}_${fileDateSuffix()}.pdf`;
    const filePath = testInfo.outputPath(fileName);
    fs.copyFileSync(SLOW_PO_SAMPLE, filePath);
    const file = asAttachment({ path: filePath, fileName }, PDF);

    // 1. Send file A
    const sentA = await sendAndShow(mailService, page, { subject: `AUTO in-flight A ${tokenA}`, attachments: [file] });
    // 2. Wait until RiverStream has picked up A (its document is in the library with status "processing").
    //    Waiting for this instead of a fixed 10-20 s keeps A and B out of the same mailbox check.
    const docA = await waitForLibraryDocument(documentsPage, tokenA, fileName, sentA.sentAt);
    expect(docA.status, `"${fileName}" must still be processing when the same file is sent again`).toBe('processing');
    // 3. Send the same file again as a new email while A is still processing
    const sentB = await sendAndShow(mailService, page, { subject: `AUTO in-flight B ${tokenB}`, attachments: [file] });

    // 4. The second email gets the "Document Already in Processing" reply
    const reply = await mailService.waitForReply({ token: tokenB, since: sentB.sentAt, timeoutMs: REPLY_WAIT_MS });
    await attachReply(testInfo, 'reply', reply);
    expect(reply.fields.header).toMatch(HEADERS.alreadyInProcessing);
    expect(reply.plain).toContain(`already received ${fileName} and it is currently being processed`);

    await verifyReplyOnScreen(page, reply, HEADERS.alreadyInProcessing, [/currently being processed/i]);
  });
});
