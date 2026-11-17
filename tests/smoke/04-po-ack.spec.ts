import path from 'path';
import { test, expect } from '../../src/fixtures/test.fixture';
import { ReconCard } from '../../src/pages/po-ack-recon.page';
import { MailService } from '../../src/utils/mail.service';
import { QaData, uniqueName } from '../../src/test-data/qa-data';
import { CRI_DIR } from '../po-ack-recon/support/recon-suite';
import {
  EmailState,
  acknowledgementOf,
  criFile,
  fetchThreadEmail,
  isComparisonReport,
  newEmailToken,
  poAckMailAccount,
  reportSummary,
  sendAckReply,
  waitForThreadReply,
} from '../po-ack-recon/support/recon-email';
import { attachReply, showReply } from '../email/support/email-scenario';
import { attachEvidence, readSmokeState, requireMailbox, requires, trackErrors, uniqueCopy, updateSmokeState } from './support/smoke';

/*
 * Smoke 04: PO-ACK Recon (TC_SMOKE_024 - TC_SMOKE_029).
 *   Dashboard cards: counts and the list of each card.
 *   Web upload: a PO + ACK pair into the reusable project AUTO_Smoke_Recon, ready for review.
 *   Email flow: a PO emailed with "Project: <name>" (a new project per run), the ACK replied in the same thread,
 *   the "Document Received" replies, the comparison report email, and the report compared with the review page.
 * Emailed ACKs are paired with their PO by the PO number printed in the ACK, so the email flow uses the SPATAB pair
 * (its ACK prints exactly 57226-116400) under the original file names.
 */

const UPLOAD_PAIR = { po: 'SIT-53758-113541-DIRO.pdf', ack: '53758-113541-SIT-ACKS.pdf', poNumber: '53758-113541' };
const EMAIL_PAIR = { po: 'SPATAB-57226-116400-DIRO.pdf', ack: '57226-116400-SPATAB-ACKS.pdf', poNumber: '57226-116400' };
const SMOKE_PROJECT = `${QaData.testPrefix}_Smoke_Recon`;
const CARD_TITLES: Record<Exclude<ReconCard, 'projects'>, string> = {
  critical: 'Discrepancy Critical',
  reviewed: 'Reviewed',
  processing: 'Processing',
  pending: 'Pending Review',
};

const mailbox = () => new MailService(poAckMailAccount());

/** The run's email thread, in the shape the PO-ACK email helpers use */
function thread(): EmailState {
  const s = readSmokeState();
  return {
    token: s.emailToken,
    subject: s.emailSubject,
    projectName: s.emailProjectName,
    projectId: s.emailProjectId,
    po: s.emailPoMessageId
      ? {
          fileName: s.emailPoFile!,
          messageId: s.emailPoMessageId,
          sentAt: s.emailPoSentAt!,
          acknowledgement: s.emailPoAckMessageId ? { messageId: s.emailPoAckMessageId, subject: '', receivedAt: s.emailPoSentAt! } : undefined,
        }
      : undefined,
    acks: s.ackMessageId ? [{ fileName: EMAIL_PAIR.ack, messageId: s.ackMessageId, sentAt: s.ackSentAt! }] : [],
    report: s.reportMessageId ? { messageId: s.reportMessageId, subject: '', receivedAt: s.reportReceivedAt! } : undefined,
  };
}

test.describe('Smoke 04: PO-ACK Recon (TC_SMOKE_024 - TC_SMOKE_029)', () => {
  test.describe.configure({ retries: 0 });

  test('TC_SMOKE_024: Verify that the PO-ACK Recon dashboard cards show the counts.', async ({ poAckReconPage: recon, page }) => {
    const errors = trackErrors(page);
    const summary = await recon.openDashboard();
    const expected: Record<ReconCard, number> = {
      projects: summary.totalProjects,
      critical: summary.critical,
      reviewed: summary.reviewed,
      processing: summary.processing,
      pending: summary.pending,
    };
    for (const [key, count] of Object.entries(expected) as Array<[ReconCard, number]>) {
      await expect(recon.card(key), `${key} card`).toBeVisible();
      await expect(recon.cardCount(key), `${key} card count = summary`).toHaveText(String(count));
    }
    expect(errors, 'no page errors or server errors (5xx)').toEqual([]);
  });

  test('TC_SMOKE_025: Verify that each PO-ACK Recon dashboard card lists its documents.', async ({ poAckReconPage: recon }, testInfo) => {
    const summary = await recon.openDashboard();
    for (const key of Object.keys(CARD_TITLES) as Array<Exclude<ReconCard, 'projects'>>) {
      const docs = (await recon.selectCard(key)) as unknown[];
      await expect(recon.card(key)).toHaveAttribute('aria-selected', 'true');
      await expect(recon.listHeading).toHaveText(CARD_TITLES[key]);
      if (summary[key] === 0) await expect(recon.noCategoryDocsMessage).toBeVisible();
      else {
        expect(docs.length, `${CARD_TITLES[key]}: documents listed`).toBeGreaterThan(0);
        await expect(recon.rows.first()).toBeVisible();
      }
      await attachEvidence(recon.page, testInfo, `${CARD_TITLES[key]} card list`);
    }
  });

  test('TC_SMOKE_026: Verify that a PO and ACK pair can be uploaded and becomes ready for review.', async ({ poAckReconPage: recon }) => {
    test.setTimeout(480_000);
    await recon.navigate();
    const existing = (await recon.searchProject(SMOKE_PROJECT)).find((p) => p.projectName === SMOKE_PROJECT);
    const projectId = existing ? existing._id : await recon.createProject(SMOKE_PROJECT, 'Miami, FL', 'Smoke test project (reused by every smoke run)');
    await recon.openProjectById(projectId);
    const po = uniqueCopy(path.join(CRI_DIR, UPLOAD_PAIR.po), 'SmokeReconPO');
    const ack = uniqueCopy(path.join(CRI_DIR, UPLOAD_PAIR.ack), 'SmokeReconACK');
    await recon.openUploadModal();
    await recon.attachFiles(po, [ack]);
    const response = await recon.submitUpload();
    expect(response.status(), 'recon upload accepted').toBeLessThan(300);
    let index = -1;
    await expect(async () => {
      const list = await recon.openProjectById(projectId);
      index = list.documents.findIndex((d) => d.fileName === path.basename(po));
      expect(index, `${path.basename(po)} is listed`).toBeGreaterThanOrEqual(0);
      const status = (await recon.statusCell(recon.rows.nth(index)).innerText()).trim();
      expect(status, `${UPLOAD_PAIR.poNumber} finished processing`).not.toMatch(/^(Processing|Awaiting ACK)?$/i);
    }).toPass({ timeout: 420_000, intervals: [15_000, 20_000, 30_000] });
    const row = recon.rows.nth(index);
    await expect(row).toContainText(UPLOAD_PAIR.poNumber);
    await expect(row.locator('td').nth(1)).toHaveText('1 version');
    await expect(row.getByRole('button', { name: 'Review', exact: true })).toBeVisible();
  });

  test('TC_SMOKE_027: Verify that an emailed PO with a project name is acknowledged and listed in the project.', async ({ poAckReconPage: recon, page }, testInfo) => {
    requireMailbox();
    test.setTimeout(720_000);
    // A new project per run (an emailed PO joins an existing row of its PO number)
    await recon.navigate();
    const projectName = uniqueName('SmokeEmail');
    const projectId = await recon.createProject(projectName, 'Miami, FL', 'Smoke test: PO-ACK email flow');
    const mail = mailbox();
    const token = newEmailToken();
    const subject = `Purchase Order ${token}`;
    const po = criFile(EMAIL_PAIR.po, 'PO', testInfo);
    const sent = await mail.sendEmail({
      subject,
      text: `Hi,\n\nPlease find the purchase order attached.\n\nProject: ${projectName}\n`,
      attachments: [{ filename: EMAIL_PAIR.po, path: po, contentType: 'application/pdf' }],
    });
    updateSmokeState({
      emailProjectName: projectName,
      emailProjectId: projectId,
      emailToken: token,
      emailSubject: subject,
      emailPoFile: EMAIL_PAIR.po,
      emailPoMessageId: sent.messageId,
      emailPoSentAt: sent.sentAt.toISOString(),
      emailPoAckMessageId: undefined,
      ackMessageId: undefined,
      reportMessageId: undefined,
    });
    const ack = await waitForThreadReply(mail, { token, since: sent.sentAt, predicate: acknowledgementOf(EMAIL_PAIR.po), what: 'acknowledgement email for the PO' });
    updateSmokeState({ emailPoAckMessageId: ack.messageId });
    await attachReply(testInfo, 'PO acknowledgement email', ack);
    await showReply(page, ack);
    await expect(page.getByText(/has been received/i).first()).toBeVisible();
    await attachEvidence(page, testInfo, '1 - Document Received email for the PO');
    // The PO is listed in the project named in the email
    let index = -1;
    await expect(async () => {
      const list = await recon.openProjectById(projectId);
      index = list.documents.findIndex((d) => d.fileName === EMAIL_PAIR.po);
      expect(index, `${EMAIL_PAIR.po} is listed in ${projectName}`).toBeGreaterThanOrEqual(0);
    }).toPass({ timeout: 300_000, intervals: [10_000, 15_000, 20_000] });
    await expect(recon.breadcrumbs).toContainText(projectName);
    await expect(recon.rows.nth(index)).toContainText(EMAIL_PAIR.poNumber);
  });

  test('TC_SMOKE_028: Verify that an ACK replied in the PO thread is acknowledged and the comparison report is emailed.', async ({ poAckReconPage: recon, page }, testInfo) => {
    requireMailbox();
    test.setTimeout(900_000);
    const s = thread();
    requires(s.po?.acknowledgement, 'the acknowledged PO email (TC_SMOKE_027)');
    const mail = mailbox();
    const ackFile = criFile(EMAIL_PAIR.ack, 'ACK', testInfo);
    const sent = await sendAckReply(mail, ackFile, s);
    updateSmokeState({ ackMessageId: sent.messageId, ackSentAt: sent.sentAt.toISOString() });
    // "Document Received" for the ACK, then the comparison report (Review in Stream)
    const ack = await waitForThreadReply(mail, {
      token: s.token!,
      since: sent.sentAt,
      predicate: acknowledgementOf(EMAIL_PAIR.ack),
      exclude: [s.po!.acknowledgement!.messageId],
      what: 'acknowledgement email for the ACK',
    });
    await attachReply(testInfo, 'ACK acknowledgement email', ack);
    const report = await waitForThreadReply(mail, { token: s.token!, since: sent.sentAt, predicate: isComparisonReport, what: 'comparison report email' });
    updateSmokeState({ reportMessageId: report.messageId, reportReceivedAt: report.receivedAt.toISOString() });
    await attachReply(testInfo, 'Comparison report email', report);
    // The ACK is filed under the PO in the project
    await expect(async () => {
      const list = await recon.openProjectById(s.projectId!);
      const doc = list.documents.find((d) => d.fileName === EMAIL_PAIR.po);
      expect(doc?.version_count ?? 0, 'ACK versions of the PO').toBeGreaterThanOrEqual(1);
    }).toPass({ timeout: 300_000, intervals: [10_000, 15_000, 20_000] });
    await attachEvidence(page, testInfo, '1 - PO with its ACK in the project');
    await showReply(page, report);
    await expect(page.getByText(`PO Number: ${EMAIL_PAIR.poNumber}`).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /Review in Stream/i }).first(), 'Review in Stream button').toBeVisible();
  });

  test(
    'TC_SMOKE_029: Verify that the comparison report matches the review page.',
    {
      annotation: {
        type: 'issue',
        description:
          'Known bug: the comparison report total (Critical + Moderate + Not in PO, e.g. 12) differs from the review page (discrepancies against PO + unmatched lines, e.g. 13).',
      },
    },
    async ({ poAckReconPage: recon, page }, testInfo) => {
      requireMailbox();
      const s = thread();
      requires(s.report, 'the comparison report email (TC_SMOKE_028)');
      const report = await fetchThreadEmail(mailbox(), s, s.report!);
      const rows = reportSummary(report).filter((r) => !/^Matched$/i.test(r.status));
      const reportTotal = rows.reduce((sum, r) => sum + r.count, 0);
      const breakdown = rows.map((r) => `${r.status} ${r.count}`).join(' + ');
      await showReply(page, report);
      for (const r of rows) {
        const row = page.locator('tr').filter({ has: page.locator('td', { hasText: new RegExp(`${r.status}\\s*$`) }) }).first();
        await expect(row, `${r.status} row`).toContainText(String(r.count));
      }
      await attachEvidence(page, testInfo, `1 - Comparison report: ${breakdown} = ${reportTotal}`);
      // The review page opened from Review in Stream
      await page.goto(report.fields.reviewInStreamUrl!);
      await recon.waitForReviewLoaded();
      await expect(recon.discrepancySummary).toBeVisible();
      const text = (await recon.discrepancySummary.innerText()).trim();
      const pageTotal = parseInt(text.match(/(\d+) discrepanc/)![1], 10) + parseInt(text.match(/(\d+) unmatched line/)?.[1] ?? '0', 10);
      expect(pageTotal, `review page "${text}" = report total (${breakdown} = ${reportTotal})`).toBe(reportTotal);
    },
  );
});
