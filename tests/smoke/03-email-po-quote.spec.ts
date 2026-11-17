import { Page } from '@playwright/test';
import { test, expect } from '../../src/fixtures/test.fixture';
import { RetrievedEmail } from '../../src/utils/mail.service';
import {
  HEADERS,
  REPLY_WAIT_MS,
  asAttachment,
  attachPageEvidence,
  attachReply,
  buildImageDisguisedAsPdf,
  buildPurchaseOrderPdf,
  buildQuotationPdf,
  newToken,
  scenarioTimeout,
  showReply,
  showWaitingForReply,
} from '../email/support/email-scenario';
import { readSmokeState, requireMailbox, requires, updateSmokeState } from './support/smoke';

/*
 * Smoke 03: Email PO & Quote (TC_SMOKE_018 - TC_SMOKE_023). The .env mailbox (riverstreamautomation@gmail.com, a user of
 * the Riverstone organization riverstonetech) emails RiverStream (riverstream.qa@riverstonetech.in):
 *   a PO (Sales Order created in the ERP), a Quote (Quotation created in the ERP), Review in Stream from the PO reply,
 *   and the negative scenarios: no attachment, subject/attachment type mismatch, unreadable attachment.
 * The ERP of riverstonetech is Frappe: the ERP result is read from the reply (Sales Order / Quotation summary).
 */

const PDF = 'application/pdf';

/** Shows the reply in the page and checks (highlights) its heading and the given texts */
async function showAndCheck(page: Page, reply: RetrievedEmail, heading: RegExp, texts: Array<string | RegExp> = []): Promise<void> {
  await showReply(page, reply);
  await expect(page.getByRole('heading', { name: heading }), 'reply heading').toBeVisible();
  for (const t of texts) await expect(page.getByText(t).first(), `reply shows ${t}`).toBeVisible();
}

test.describe('Smoke 03: Email PO & Quote (TC_SMOKE_018 - TC_SMOKE_023)', () => {
  test.describe.configure({ retries: 0 });

  test.beforeEach(async () => {
    requireMailbox();
    test.setTimeout(scenarioTimeout(1));
  });

  test('TC_SMOKE_018: Verify that an emailed PO is processed and the Sales Order is created in the ERP.', async ({ mailService, page }, testInfo) => {
    const token = newToken('SMKPO');
    const po = await buildPurchaseOrderPdf(testInfo, token);
    const sent = await mailService.sendEmail({ subject: `Purchase Order ${token}`, text: 'Type: Purchase Order', attachments: [asAttachment(po, PDF)] });
    expect(sent.rejected, 'the ingestion address accepted the email').toEqual([]);
    await showWaitingForReply(page, [sent]);
    const reply = await mailService.waitForReply({ token, since: sent.sentAt, timeoutMs: REPLY_WAIT_MS });
    await attachReply(testInfo, 'reply', reply);
    const f = reply.fields;
    updateSmokeState({ poReviewInStreamUrl: f.reviewInStreamUrl, poEmailFile: po.fileName });
    // ERP: the Sales Order is created
    expect(f.header, 'reply heading').toMatch(HEADERS.salesOrderSummary);
    expect(f.fileName, 'File in the reply').toBe(po.fileName);
    expect(f.status, 'Status in the reply').toMatch(/^SalesOrder_(created|partial)$/);
    expect(f.message, 'Message in the reply').toMatch(/Sales Order created successfully in ERP/i);
    expect(f.salesOrderNumber, 'Sales Order Number in the reply').toMatch(/^SAL-ORD-\d{4}-\d+$/);
    await showAndCheck(page, reply, HEADERS.salesOrderSummary, [
      `File: ${po.fileName}`,
      /Message:\s*Sales Order created successfully in ERP/i,
      `Sales Order Number: ${f.salesOrderNumber}`,
    ]);
  });

  test('TC_SMOKE_019: Verify that an emailed Quote is processed and the Quotation is created in the ERP.', async ({ mailService, page }, testInfo) => {
    const token = newToken('SMKQT');
    const quote = await buildQuotationPdf(testInfo, token);
    const sent = await mailService.sendEmail({ subject: `Quotation/Estimation ${token}`, text: 'Type: Quotation/Estimation', attachments: [asAttachment(quote, PDF)] });
    expect(sent.rejected, 'the ingestion address accepted the email').toEqual([]);
    await showWaitingForReply(page, [sent]);
    const reply = await mailService.waitForReply({ token, since: sent.sentAt, timeoutMs: REPLY_WAIT_MS });
    await attachReply(testInfo, 'reply', reply);
    expect(reply.fields.fileName, 'File in the reply').toBe(quote.fileName);
    // ERP: "ERP Quotation Processing Summary" (a quote that failed ERP insertion replies "Quote Request Processing Summary")
    expect(reply.fields.header, 'the Quotation is created in the ERP').toMatch(/ERP Quotation Processing Summary/i);
    await showAndCheck(page, reply, /ERP Quotation Processing Summary/i, [`File: ${quote.fileName}`]);
  });

  test('TC_SMOKE_020: Verify that Review in Stream in the PO reply opens the review page.', async ({ page, reviewPage }, testInfo) => {
    const s = readSmokeState();
    requires(s.poReviewInStreamUrl, 'the Review in Stream link of the PO reply (TC_SMOKE_018)');
    await page.goto(s.poReviewInStreamUrl!);
    await expect(page).toHaveURL(s.poReviewInStreamUrl!);
    await reviewPage.waitForReviewLoaded();
    await expect(page.getByRole('heading', { name: s.poEmailFile! })).toBeVisible({ timeout: 45_000 });
    await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 45_000 });
    await expect(reviewPage.fieldCard('Customer Name')).toBeVisible();
    await attachPageEvidence(page, testInfo, '1 - Review page opened from Review in Stream');
  });

  test('TC_SMOKE_021: Verify the "No Attachment Found" reply for an email without attachment.', async ({ mailService, page }, testInfo) => {
    const token = newToken('SMKNA');
    const sent = await mailService.sendEmail({ subject: `AUTO no attachment ${token}`, text: 'Please process the attached order.' });
    await showWaitingForReply(page, [sent]);
    const reply = await mailService.waitForReply({ token, since: sent.sentAt, timeoutMs: REPLY_WAIT_MS });
    await attachReply(testInfo, 'reply', reply);
    expect(reply.fields.header).toMatch(HEADERS.noAttachment);
    expect(reply.fields.reviewInStreamUrl, 'no Review in Stream link').toBeUndefined();
    await showAndCheck(page, reply, HEADERS.noAttachment, [/did not include any supported attachments/i]);
  });

  test("TC_SMOKE_022: Verify the \"Request Type Doesn't Match Attachment\" reply when the subject says Quote and the attachment is a PO.", async ({ mailService, page }, testInfo) => {
    const token = newToken('SMKMM');
    const po = await buildPurchaseOrderPdf(testInfo, token);
    const sent = await mailService.sendEmail({ subject: `Quotation/Estimation request ${token}`, text: 'Type: Quotation/Estimation', attachments: [asAttachment(po, PDF)] });
    await showWaitingForReply(page, [sent]);
    const reply = await mailService.waitForReply({ token, since: sent.sentAt, timeoutMs: REPLY_WAIT_MS });
    await attachReply(testInfo, 'reply', reply);
    expect(reply.fields.header).toMatch(HEADERS.typeMismatch);
    expect(reply.fields.salesOrderNumber, 'no Sales Order is created').toBeUndefined();
    await showAndCheck(page, reply, HEADERS.typeMismatch, [/Your email indicated:\s*Quotation\/Estimation/i, /Your attachment looks like:\s*Purchase Order/i]);
  });

  test("TC_SMOKE_023: Verify the \"Attachment Couldn't Be Read\" reply for an unreadable attachment.", async ({ mailService, page }, testInfo) => {
    const token = newToken('SMKUR');
    const image = await buildImageDisguisedAsPdf(testInfo, token);
    const sent = await mailService.sendEmail({ subject: `AUTO unreadable attachment ${token}`, attachments: [asAttachment(image, PDF)] });
    await showWaitingForReply(page, [sent]);
    const reply = await mailService.waitForReply({ token, since: sent.sentAt, timeoutMs: REPLY_WAIT_MS });
    await attachReply(testInfo, 'reply', reply);
    expect(reply.fields.header).toMatch(HEADERS.unreadable);
    expect(reply.fields.salesOrderNumber, 'no Sales Order is created').toBeUndefined();
    expect(reply.plain, 'the reply names the unreadable file').toContain(image.fileName);
    await showAndCheck(page, reply, HEADERS.unreadable, [/could not be opened/i]);
  });
});
