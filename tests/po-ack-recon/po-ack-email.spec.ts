import fs from 'fs';
import path from 'path';
import { test, expect } from '../../src/fixtures/test.fixture';
import { MailService } from '../../src/utils/mail.service';
import { CRI_DIR, PROCESSING_TIMEOUT_MS } from './support/recon-suite';
import {
  EMAIL_CASE_TIMEOUT,
  EMAIL_PAIR,
  REPLY_WAIT_MS,
  countNavigations,
  emailProject,
  emailSubject,
  fetchThreadEmail,
  acknowledgementOf,
  isComparisonReport,
  newEmailToken,
  poAckMailAccount,
  readEmailState,
  reportSummary,
  requireMailbox,
  requires,
  sendAckReply,
  stored,
  criFile,
  updateEmailState,
  versionsText,
  waitForPoDocument,
  waitForThreadReply,
} from './support/recon-email';
import { attachPageEvidence, attachReply, showReply, showWaitingForReply } from '../po-quote-request/support/email-scenario';

/*
 * River Stream - PO-ACK Recon Email Process (TC_PO-ACK_104 - TC_PO-ACK_114), part of the PO-ACK Recon suite
 * (project po-ack, `npm run test:recon`).
 *
 * A Riverstonetech user emails a PO with "Project: <name>" in the body and replies in the same email thread with
 * ACK documents. One thread per run, in order:
 *   PO (104 acknowledgement, 105 PO in the project), ACK 1 (106 processed, 107 acknowledgement),
 *   ACK 2 sent while the project page is open (108 shown without refresh), comparison report (109 email,
 *   110 discrepancies vs the review page), ACK 3 (111 one acknowledgement per ACK, 112 all ACKs in the UI),
 *   113 Review in Stream opens the PO review page,
 *   114 the same PO number emailed again (new thread, another file name) is listed as a new row.
 * The Riverstonetech mailbox and the other options are set in .env (see support/recon-email.ts); without
 * PO_ACK_MAIL_USER / PO_ACK_MAIL_APP_PASSWORD the cases are skipped with that reason.
 */

const mailbox = () => new MailService(poAckMailAccount());

test.describe('River Stream - PO-ACK Recon Email Process (TC_PO-ACK_104 - TC_PO-ACK_114)', () => {
  // In order on one worker; a step that needs an earlier one is skipped with the reason (requires)
  test.describe.configure({ mode: 'default', retries: 0 });

  test.beforeEach(async () => {
    requireMailbox();
    test.setTimeout(EMAIL_CASE_TIMEOUT);
  });

  test('TC_PO-ACK_104: Verify PO email acknowledgement', async ({ poAckReconPage: recon, page }, testInfo) => {
    const mail = mailbox();
    const project = await emailProject(recon);
    const token = newEmailToken();
    const subject = emailSubject(token);
    const po = criFile(EMAIL_PAIR.po, 'PO', testInfo);

    // 1. PO by email, project name in the body
    const sent = await mail.sendEmail({
      subject,
      text: `Hi,\n\nPlease find the purchase order attached.\n\nProject: ${project.name}\n`,
      attachments: [{ filename: path.basename(po), path: po, contentType: 'application/pdf' }],
    });
    expect(sent.accepted, 'the PO email is accepted for delivery').toContain(mail.account.ingestionEmail.toLowerCase());
    updateEmailState((s) => {
      s.token = token;
      s.subject = subject;
      s.po = { fileName: path.basename(po), messageId: sent.messageId, sentAt: sent.sentAt.toISOString() };
      s.acks = [];
      delete s.report;
    });
    testInfo.annotations.push({ type: 'note', description: `Subject "${subject}", project "${project.name}", file ${path.basename(po)}` });
    await showWaitingForReply(page, [sent], 'Waiting for the PO acknowledgement email');

    // 2. Reply: the PO document has been received
    const ack = await waitForThreadReply(mail, { token, since: sent.sentAt, predicate: acknowledgementOf(path.basename(po)), what: 'acknowledgement email for the PO' });
    updateEmailState((s) => {
      s.po!.acknowledgement = stored(ack);
    });
    await attachReply(testInfo, 'PO acknowledgement email', ack);
    await showReply(page, ack);
    await expect(page.locator('#rs-mail-subject')).toContainText(token);
    await expect(page.getByText(/receiv/i).first(), 'the email confirms the PO was received').toBeVisible();
  });

  test('TC_PO-ACK_105: Verify PO document in the UI', async ({ poAckReconPage: recon }, testInfo) => {
    const s = readEmailState();
    requires(s.po, 'the PO email (TC_PO-ACK_104)');
    // 2-3. The emailed PO is listed under the project named in the email
    const { row, doc } = await waitForPoDocument(recon, () => true);
    testInfo.annotations.push({ type: 'note', description: `${doc.fileName}: status ${doc.status}` });
    await expect(recon.breadcrumbs).toContainText(s.projectName!);
    await expect(row).toContainText(EMAIL_PAIR.poNumber);
    await expect(recon.statusCell(row)).not.toHaveText('');
  });

  test('TC_PO-ACK_106: Verify ACK attachment submission', async ({ poAckReconPage: recon }, testInfo) => {
    const mail = mailbox();
    const s = readEmailState();
    requires(s.po, 'the PO email (TC_PO-ACK_104)');
    // 1-3. Reply in the PO thread with the first ACK
    const ack = criFile(EMAIL_PAIR.ack, 'ACK1', testInfo);
    const sent = await sendAckReply(mail, ack, s);
    updateEmailState((st) => {
      st.acks.push({ fileName: path.basename(ack), messageId: sent.messageId, sentAt: sent.sentAt.toISOString() });
    });
    // The ACK is received and reconciled with the PO: 1 ACK version, no longer Awaiting ACK / Processing
    const { row } = await waitForPoDocument(
      recon,
      (doc, status) => doc.version_count >= 1 && !!status && !/^(Processing|Awaiting ACK)$/i.test(status),
      REPLY_WAIT_MS + PROCESSING_TIMEOUT_MS,
    );
    await expect(row.locator('td').nth(1)).toHaveText(versionsText(1));
    await expect(recon.statusCell(row)).not.toHaveText(/^(Processing|Awaiting ACK)$/i);
  });

  test('TC_PO-ACK_107: Verify ACK receipt acknowledgement email', async ({ page }, testInfo) => {
    const mail = mailbox();
    const s = readEmailState();
    requires(s.acks[0], 'the first ACK email (TC_PO-ACK_106)');
    // 2-3. Reply: the ACK document has been received
    const ack = await waitForThreadReply(mail, {
      token: s.token!,
      since: new Date(s.acks[0].sentAt),
      predicate: acknowledgementOf(EMAIL_PAIR.ack),
      exclude: [s.po!.acknowledgement?.messageId ?? ''],
      what: 'acknowledgement email for the ACK',
    });
    updateEmailState((st) => {
      st.acks[0].acknowledgement = stored(ack);
    });
    await attachReply(testInfo, 'ACK acknowledgement email', ack);
    await showReply(page, ack);
    await expect(page.locator('#rs-mail-subject')).toContainText(s.token!);
    await expect(page.getByText(/receiv/i).first(), 'the email confirms the ACK was received').toBeVisible();
  });

  test('TC_PO-ACK_108: Verify ACK document appears in the UI without refreshing', async ({ poAckReconPage: recon, page }, testInfo) => {
    const mail = mailbox();
    const s = readEmailState();
    requires(s.acks[0], 'the first ACK email (TC_PO-ACK_106)');
    // 1. Project page open, the PO with its first ACK
    const { doc } = await waitForPoDocument(recon, (d, status) => d.version_count >= 1 && !/^(Processing|Awaiting ACK)$/i.test(status));
    const poRow = recon.rows.filter({ hasText: doc.po_number.trim() });
    await expect(poRow.first().locator('td').nth(1)).toHaveText(versionsText(doc.version_count));
    const navigations = countNavigations(page);
    // 2. Another ACK in the PO thread
    const ack = criFile(EMAIL_PAIR.ack, 'ACK2', testInfo);
    const sent = await sendAckReply(mail, ack, s);
    updateEmailState((st) => {
      st.acks.push({ fileName: path.basename(ack), messageId: sent.messageId, sentAt: sent.sentAt.toISOString() });
    });
    // 3-4. The new ACK version appears on the open page, without a refresh
    await expect(poRow.filter({ hasText: versionsText(doc.version_count + 1) }).first(), 'new ACK version shown without refreshing').toBeVisible({
      timeout: REPLY_WAIT_MS + PROCESSING_TIMEOUT_MS,
    });
    expect(navigations(), 'the page was not reloaded or navigated').toBe(0);
  });

  test('TC_PO-ACK_109: Verify comparison report email', async ({ page }, testInfo) => {
    const mail = mailbox();
    const s = readEmailState();
    requires(s.acks[0], 'the first ACK email (TC_PO-ACK_106)');
    // 3-4. Report sent once the PO and the ACK are reconciled
    const report = await waitForThreadReply(mail, {
      token: s.token!,
      since: new Date(s.acks[0].sentAt),
      predicate: isComparisonReport,
      what: 'comparison report email (with Review in Stream)',
    });
    updateEmailState((st) => {
      st.report = stored(report);
    });
    await attachReply(testInfo, 'Comparison report email', report);
    await showReply(page, report);
    await expect(page.locator('#rs-mail-subject')).toContainText(s.token!);
    await expect(page.getByRole('link', { name: /Review in Stream/i }).first(), 'Review in Stream button').toBeVisible();
  });

  test(
    'TC_PO-ACK_110: Verify discrepancies in the comparison report',
    {
      annotation: {
        type: 'issue',
        description:
          'Known bug: the comparison report total (Critical 3 + Moderate 5 + Not in PO 4 = 12) differs from the review page (11 discrepancies against PO + 2 unmatched lines = 13).',
      },
    },
    async ({ poAckReconPage: recon, page }, testInfo) => {
    const mail = mailbox();
    const s = readEmailState();
    requires(s.report, 'the comparison report email (TC_PO-ACK_109)');
    const report = await fetchThreadEmail(mail, s, s.report!);
    // 2. Discrepancies in the report's Comparison Summary: every row except Matched (Critical, Moderate, Not in PO, ...)
    const summary = reportSummary(report);
    expect(summary.length, 'the report has a Comparison Summary table').toBeGreaterThan(0);
    const discrepancyRows = summary.filter((r) => !/^Matched$/i.test(r.status));
    const reportTotal = discrepancyRows.reduce((sum, r) => sum + r.count, 0);
    const breakdown = discrepancyRows.map((r) => `${r.status} ${r.count}`).join(' + ');
    testInfo.annotations.push({ type: 'note', description: `Report: ${breakdown} = ${reportTotal} (${summary.map((r) => `${r.status} ${r.count}`).join(', ')})` });
    await showReply(page, report);
    await expect(page.getByText('Comparison Summary', { exact: false }).first()).toBeVisible();
    // Status cells carry a marker ("● Critical", "NEW Not in PO"): the row is found by the cell ending with the status
    for (const r of discrepancyRows) {
      const row = page.locator('tr').filter({ has: page.locator('td', { hasText: new RegExp(`${r.status}\\s*$`) }) }).first();
      await expect(row, `${r.status} row`).toContainText(String(r.count));
    }
    await attachPageEvidence(page, testInfo, `1 - Comparison report: ${breakdown} = ${reportTotal} discrepancies`);

    // 3. The Stream review page (opened from the report): discrepancies against PO + unmatched lines = report total.
    // The ACKs of the thread are copies of one file, so the latest ACK version gives the reported discrepancies.
    await page.goto(report.fields.reviewInStreamUrl!);
    await recon.waitForReviewLoaded();
    await expect(recon.discrepancySummary).toBeVisible();
    const summaryText = await recon.discrepancySummary.innerText();
    const pageDiscrepancies = parseInt(summaryText.match(/(\d+) discrepanc/)![1], 10);
    const unmatchedLines = parseInt(summaryText.match(/(\d+) unmatched line/)?.[1] ?? '0', 10);
    testInfo.annotations.push({ type: 'note', description: `Review page: "${summaryText.trim()}" = ${pageDiscrepancies + unmatchedLines}` });
    await expect(recon.discrepancySummary).toBeVisible();
    expect(
      pageDiscrepancies + unmatchedLines,
      `review page "${summaryText.trim()}" (${pageDiscrepancies} + ${unmatchedLines}) = report total (${breakdown} = ${reportTotal})`,
    ).toBe(reportTotal);
    },
  );

  test('TC_PO-ACK_111: Verify multiple ACK submissions', async ({ page }, testInfo) => {
    const mail = mailbox();
    let s = readEmailState();
    requires(s.acks[1], 'the second ACK email (TC_PO-ACK_108)');
    // 4. Another ACK in the same thread
    const ackFile = criFile(EMAIL_PAIR.ack, 'ACK3', testInfo);
    const sent = await sendAckReply(mail, ackFile, s);
    s = updateEmailState((st) => {
      st.acks.push({ fileName: path.basename(ackFile), messageId: sent.messageId, sentAt: sent.sentAt.toISOString() });
    });
    // 5. One acknowledgement email per ACK submission
    for (let i = 0; i < s.acks.length; i++) {
      if (s.acks[i].acknowledgement) continue;
      const used = [s.po!.acknowledgement?.messageId ?? '', ...s.acks.map((a) => a.acknowledgement?.messageId ?? '')];
      const reply = await waitForThreadReply(mail, {
        token: s.token!,
        since: new Date(s.acks[i].sentAt),
        predicate: acknowledgementOf(EMAIL_PAIR.ack),
        exclude: used,
        what: `acknowledgement email for ACK ${i + 1} (${s.acks[i].fileName})`,
      });
      s = updateEmailState((st) => {
        st.acks[i].acknowledgement = stored(reply);
      });
      await attachReply(testInfo, `ACK ${i + 1} acknowledgement email`, reply);
    }
    const ids = s.acks.map((a) => a.acknowledgement!.messageId);
    expect(new Set(ids).size, 'a separate acknowledgement email for each ACK').toBe(s.acks.length);
    const last = await fetchThreadEmail(mail, s, s.acks[s.acks.length - 1].acknowledgement!);
    await showReply(page, last);
    await expect(page.locator('#rs-mail-subject')).toContainText(s.token!);
    await expect(page.getByText(/receiv/i).first(), `acknowledgement for ACK ${s.acks.length}`).toBeVisible();
  });

  test('TC_PO-ACK_112: Verify multiple ACK documents in the UI', async ({ poAckReconPage: recon, page }) => {
    const s = readEmailState();
    requires(s.acks[2], 'the third ACK email (TC_PO-ACK_111)');
    const count = s.acks.length;
    // 1-3. Every ACK sent in the thread is filed under the PO in the project
    const { row, doc } = await waitForPoDocument(recon, (d) => d.version_count >= count, REPLY_WAIT_MS + PROCESSING_TIMEOUT_MS);
    expect(doc.version_count, 'ACK versions of the PO').toBe(count);
    await expect(row.locator('td').nth(1)).toHaveText(versionsText(count));
    await recon.openReview(row);
    await recon.ackSelector.click();
    const options = page.getByRole('button', { name: /^ACK \d+ — / });
    await expect(options).toHaveCount(count);
    for (let i = 1; i <= count; i++) await expect(options.nth(i - 1)).toHaveText(new RegExp(`^ACK ${i} — `));
  });

  test('TC_PO-ACK_113: Verify the Review in Stream button', async ({ poAckReconPage: recon, page }, testInfo) => {
    const mail = mailbox();
    const s = readEmailState();
    requires(s.report, 'the comparison report email (TC_PO-ACK_109)');
    const report = await fetchThreadEmail(mail, s, s.report!);
    // 1. The comparison report email
    await showReply(page, report);
    const button = page.getByRole('link', { name: /Review in Stream/i }).first();
    await expect(button).toBeVisible();
    await attachPageEvidence(page, testInfo, '1 - Review in Stream button in the comparison report');
    // 2. Review in Stream opens the PO review page in Stream (same tab)
    await button.evaluate((a) => a.removeAttribute('target'));
    await button.click();
    await expect(page).toHaveURL(/\/po-ack-recon\/review\//, { timeout: 60_000 });
    await recon.waitForReviewLoaded();
    // Opened from the email, the review page has a "Back to Dashboard" header (PO number + page title), no breadcrumbs
    await expect(page.getByText('PO-ACK Recon Document Review', { exact: true })).toBeVisible();
    await expect(page.getByText(EMAIL_PAIR.poNumber, { exact: true }).first()).toBeVisible();
    await expect(recon.fieldValue(recon.poDataCard, 'Po Number')).toHaveText(new RegExp(`^${EMAIL_PAIR.poNumber}`));
  });

  test('TC_PO-ACK_114: Verify a PO emailed again with an existing PO number is listed as a new row', async ({ poAckReconPage: recon, page }, testInfo) => {
    const mail = mailbox();
    const s = readEmailState();
    requires(s.po, 'the PO email (TC_PO-ACK_104)');
    // 1. The project already holds the PO number (TC_PO-ACK_104)
    const before = (await recon.openProjectById(s.projectId!)).documents.filter((d) => d.po_number.trim().startsWith(EMAIL_PAIR.poNumber));
    expect(before.length, `PO ${EMAIL_PAIR.poNumber} is already in ${s.projectName}`).toBeGreaterThan(0);

    // 2. The same PO number in a new email (new thread), under another file name
    const token = newEmailToken();
    const fileName = `AUTO_${token}_${EMAIL_PAIR.po}`;
    const file = testInfo.outputPath('PO_AGAIN', fileName);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.copyFileSync(path.join(CRI_DIR, EMAIL_PAIR.po), file);
    const sent = await mail.sendEmail({
      subject: emailSubject(token),
      text: `Hi,

Please find the purchase order attached.

Project: ${s.projectName}
`,
      attachments: [{ filename: fileName, path: file, contentType: 'application/pdf' }],
    });
    testInfo.annotations.push({ type: 'note', description: `Emailed ${fileName} (PO ${EMAIL_PAIR.poNumber}); rows of that PO before: ${before.length}` });
    const ack = await waitForThreadReply(mail, { token, since: sent.sentAt, predicate: acknowledgementOf(fileName), what: 'acknowledgement email for the PO sent again' });
    await attachReply(testInfo, 'Acknowledgement of the PO sent again', ack);
    await showReply(page, ack);
    await expect(page.getByText(/has been received/i).first()).toBeVisible();
    await attachPageEvidence(page, testInfo, '1 - Acknowledgement of the PO sent again');

    // 3. Expected: a new row for the emailed file (one more row of that PO number), not an update of the existing row
    let rows = before;
    let newRow = -1;
    await expect(async () => {
      const list = await recon.openProjectById(s.projectId!);
      rows = list.documents.filter((d) => d.po_number.trim().startsWith(EMAIL_PAIR.poNumber));
      newRow = list.documents.findIndex((d) => d.fileName === fileName);
      expect(newRow, `${fileName} has its own row in ${s.projectName}`).toBeGreaterThanOrEqual(0);
    })
      .toPass({ timeout: PROCESSING_TIMEOUT_MS, intervals: [15_000, 20_000, 30_000] })
      .catch((err: Error) => {
        const summary = rows.map((d) => `${d.fileName} (${d.status}, ${d.version_count} versions, updated ${d.updatedDate})`).join('; ');
        throw new Error(`${err.message.split(/\r?\n/)[0]}. Rows of PO ${EMAIL_PAIR.poNumber}: ${summary}`);
      });
    expect(rows.length, `rows of PO ${EMAIL_PAIR.poNumber}: one more than before`).toBe(before.length + 1);
    await expect(recon.rows.nth(newRow)).toContainText(EMAIL_PAIR.poNumber);
  });
});
