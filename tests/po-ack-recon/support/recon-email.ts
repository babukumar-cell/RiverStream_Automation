import fs from 'fs';
import os from 'os';
import path from 'path';
import { Locator, Page, TestInfo, expect, test } from '@playwright/test';
import { Config } from '../../../src/config/environment';
import { PoAckReconPage, ReconDocument } from '../../../src/pages/po-ack-recon.page';
import { MailAccount, MailAuthError, MailService, RetrievedEmail, SentEmail } from '../../../src/utils/mail.service';
import { CRI_DIR, PROCESSING_TIMEOUT_MS, ensureProject } from './recon-suite';

/*
 * PO-ACK email process (TC_PO-ACK_104 - TC_PO-ACK_113).
 *
 * A Riverstonetech user emails a PO to RiverStream with the project name in the body ("Project: <name>"), then
 * replies in the same email thread with ACK documents. RiverStream answers each document with an acknowledgement
 * email, files the PO and ACKs under the project, and sends a comparison report email with a "Review in Stream"
 * button once a PO and an ACK are reconciled.
 *
 * Mailbox: the Riverstonetech user's mailbox sends the emails and reads the replies. Set it in .env:
 *   PO_ACK_MAIL_USER, PO_ACK_MAIL_APP_PASSWORD   (default: the .env sender, SENDER_EMAIL / SENDER_APP_PASSWORD)
 *   PO_ACK_SMTP_HOST / PO_ACK_SMTP_PORT / PO_ACK_IMAP_HOST / PO_ACK_IMAP_PORT   (default: the SMTP_/IMAP_ settings)
 *   PO_ACK_INGESTION_EMAIL   address the PO is sent to (default: INGESTION_EMAIL)
 *   PO_ACK_REPLY_FROM        sender of RiverStream's replies (default: the ingestion address)
 *   PO_ACK_EMAIL_PROJECT     project named in the email body (default: this run's suite project)
 *   PO_ACK_EMAIL_SUBJECT     subject; "{token}" is replaced by the run's correlation token (default: "Purchase Order {token}")
 *   PO_ACK_REPLY_WAIT_MS     wait for each reply email (default: 10 minutes)
 */

const env = (name: string) => (process.env[name] ?? '').trim();

/**
 * Mailbox that sends the PO / ACK emails and receives the replies: the Riverstonetech user's mailbox
 * (PO_ACK_MAIL_USER / PO_ACK_MAIL_APP_PASSWORD), else the .env sender account (SENDER_EMAIL).
 */
export function poAckMailAccount(): Partial<MailAccount> {
  const account: Partial<MailAccount> = {};
  if (env('PO_ACK_MAIL_USER')) {
    account.senderEmail = env('PO_ACK_MAIL_USER');
    account.senderAppPassword = env('PO_ACK_MAIL_APP_PASSWORD').replace(/\s+/g, '');
  }
  if (env('PO_ACK_SMTP_HOST')) account.smtpHost = env('PO_ACK_SMTP_HOST');
  if (env('PO_ACK_SMTP_PORT')) account.smtpPort = parseInt(env('PO_ACK_SMTP_PORT'), 10);
  if (env('PO_ACK_IMAP_HOST')) account.imapHost = env('PO_ACK_IMAP_HOST');
  if (env('PO_ACK_IMAP_PORT')) account.imapPort = parseInt(env('PO_ACK_IMAP_PORT'), 10);
  if (env('PO_ACK_INGESTION_EMAIL')) account.ingestionEmail = env('PO_ACK_INGESTION_EMAIL');
  return account;
}

/** Skips the test when no mailbox is configured (neither the PO-ACK mailbox nor the .env sender) */
export function requireMailbox(): void {
  const custom = !!env('PO_ACK_MAIL_USER') && !!env('PO_ACK_MAIL_APP_PASSWORD');
  test.skip(
    !custom && (!Config.email.senderEmail || !Config.email.senderAppPassword),
    'PO-ACK email process: set PO_ACK_MAIL_USER / PO_ACK_MAIL_APP_PASSWORD (Riverstonetech user mailbox) or SENDER_EMAIL / SENDER_APP_PASSWORD in .env.',
  );
}

export const replyFrom = () => env('PO_ACK_REPLY_FROM') || env('PO_ACK_INGESTION_EMAIL') || Config.email.ingestionEmail;
export const REPLY_WAIT_MS = parseInt(env('PO_ACK_REPLY_WAIT_MS') || String(10 * 60_000), 10);
/** Test timeout for a case that waits for one email and the processing of one document */
export const EMAIL_CASE_TIMEOUT = REPLY_WAIT_MS + PROCESSING_TIMEOUT_MS + 180_000;

/** CRI PO and its ACK used only by the email cases. The ACK must print exactly the PO number (57226-116400): an ACK that prints
 * a suffixed number (e.g. 54914-114248-ATRIA-HP-TYLER) is filed as a separate document instead of an ACK of the PO. */
export const EMAIL_PAIR = { po: 'SPATAB-57226-116400-DIRO.pdf', ack: '57226-116400-SPATAB-ACKS.pdf', poNumber: '57226-116400' } as const;

// ---------------------------------------------------------------------------------------------
// Per-run state (a failed test restarts the worker, so it is kept in a file)
// ---------------------------------------------------------------------------------------------

export interface StoredEmail {
  messageId: string;
  subject: string;
  receivedAt: string;
}

export interface SentAck {
  fileName: string;
  messageId: string;
  sentAt: string;
  /** Acknowledgement email RiverStream sent for this ACK */
  acknowledgement?: StoredEmail;
}

export interface EmailState {
  token?: string;
  subject?: string;
  projectName?: string;
  projectId?: string;
  po?: { fileName: string; messageId: string; sentAt: string; acknowledgement?: StoredEmail };
  acks: SentAck[];
  report?: StoredEmail;
}

const stateFile = () => path.join(os.tmpdir(), `riverstream-recon-email-${process.env.RS_RUN_ID ?? process.ppid}.json`);

export function readEmailState(): EmailState {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), 'utf8')) as EmailState;
  } catch {
    return { acks: [] };
  }
}

export function updateEmailState(update: (s: EmailState) => void): EmailState {
  const s = readEmailState();
  update(s);
  fs.writeFileSync(stateFile(), JSON.stringify(s, null, 2));
  return s;
}

export const stored = (m: RetrievedEmail): StoredEmail => ({ messageId: m.messageId, subject: m.subject, receivedAt: m.receivedAt.toISOString() });

/** Skips the test (with the reason) when an earlier step of the run did not produce `value` */
export function requires<T>(value: T | undefined | null, what: string): asserts value is T {
  test.skip(value === undefined || value === null, `Needs ${what}, which did not complete in this run`);
}

// ---------------------------------------------------------------------------------------------
// Project and documents
// ---------------------------------------------------------------------------------------------

/** Project named in the email body: PO_ACK_EMAIL_PROJECT, or this run's suite project */
export async function emailProject(recon: PoAckReconPage): Promise<{ name: string; id: string }> {
  const s = readEmailState();
  if (s.projectName && s.projectId) return { name: s.projectName, id: s.projectId };
  let project: { name: string; id: string };
  const fixed = env('PO_ACK_EMAIL_PROJECT');
  if (fixed) {
    await recon.navigate();
    const match = (await recon.searchProject(fixed)).find((p) => p.projectName === fixed);
    expect(match, `project "${fixed}" (PO_ACK_EMAIL_PROJECT) exists in PO-ACK Recon`).toBeTruthy();
    project = { name: fixed, id: match!._id };
  } else {
    project = await ensureProject(recon);
  }
  updateEmailState((st) => {
    st.projectName = project.name;
    st.projectId = project.id;
  });
  return project;
}

/**
 * A CRI file to attach, under its ORIGINAL name (copied into the test's output folder `label`): RiverStream pairs an
 * emailed ACK with its PO (DIRO) by these names; a renamed ACK is filed as a separate PO document.
 */
export function criFile(file: string, label: string, testInfo: TestInfo): string {
  const target = testInfo.outputPath(label, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(CRI_DIR, file), target);
  return target;
}

/** Alphanumeric correlation token for the subject (Gmail matches whole words) */
export function newEmailToken(): string {
  return `POACK${Date.now().toString(36)}${Math.floor(Math.random() * 36 ** 3).toString(36)}`.toUpperCase();
}

export function emailSubject(token: string): string {
  return (env('PO_ACK_EMAIL_SUBJECT') || 'Purchase Order {token}').replace('{token}', token);
}

/** The run's PO document in the project (matched by the emailed file name, else by PO number after it was sent) */
export function findPoDocument(docs: ReconDocument[], s: EmailState): number {
  const byName = docs.findIndex((d) => d.fileName === s.po?.fileName);
  if (byName >= 0) return byName;
  const sentAt = s.po ? new Date(s.po.sentAt).getTime() - 60_000 : 0;
  return docs.findIndex((d) => d.po_number.trim().startsWith(EMAIL_PAIR.poNumber) && new Date(d.createdDate).getTime() >= sentAt);
}

/**
 * Reloads the project until the run's PO is listed and `done(doc)` holds; returns its row and API record.
 */
export async function waitForPoDocument(
  recon: PoAckReconPage,
  done: (doc: ReconDocument, status: string) => boolean,
  timeout = PROCESSING_TIMEOUT_MS,
): Promise<{ row: Locator; doc: ReconDocument }> {
  const s = readEmailState();
  let row!: Locator;
  let doc!: ReconDocument;
  await expect(async () => {
    const list = await recon.openProjectById(s.projectId!);
    const index = findPoDocument(list.documents, s);
    expect(index, `${s.po?.fileName ?? EMAIL_PAIR.poNumber} is listed in project ${s.projectName}`).toBeGreaterThanOrEqual(0);
    doc = list.documents[index];
    row = recon.rows.nth(index);
    await expect(row).toContainText(doc.po_number.trim());
    const status = (await recon.statusCell(row).innerText()).trim();
    expect(done(doc, status), `${doc.po_number} (status "${status}", ${doc.version_count} ACK versions)`).toBe(true);
  }).toPass({ timeout, intervals: [10_000, 15_000, 20_000] });
  return { row, doc };
}

/** "1 version" / "2 versions" shown in a document row */
export const versionsText = (n: number) => `${n} version${n === 1 ? '' : 's'}`;

// ---------------------------------------------------------------------------------------------
// Emails
// ---------------------------------------------------------------------------------------------

/** Sends an ACK as a reply in the PO email thread (Re: subject, In-Reply-To / References) */
export async function sendAckReply(mail: MailService, ackPath: string, s: EmailState): Promise<SentEmail> {
  const thread = [s.po!.messageId, s.po!.acknowledgement?.messageId, ...s.acks.map((a) => a.messageId)].filter(Boolean) as string[];
  return mail.sendEmail({
    subject: `RE: ${s.subject}`,
    text: `Hi,\n\nPlease find the acknowledgement attached for PO ${EMAIL_PAIR.poNumber}.\n\nProject: ${s.projectName}\n`,
    attachments: [{ filename: path.basename(ackPath), path: ackPath, contentType: 'application/pdf' }],
    inReplyTo: thread[thread.length - 1],
    references: thread,
  });
}

/**
 * Acknowledgement email ("Document Received": "Your file '<file>' has been received and is being processed."),
 * optionally for one file
 */
export const isAcknowledgement = (m: RetrievedEmail, fileName?: string) =>
  !m.fields.reviewInStreamUrl &&
  /Document Received|has been received/i.test(`${m.fields.header ?? ''} ${m.plain}`) &&
  (!fileName || m.plain.includes(`'${fileName}'`));

/** Acknowledgement email for this file */
export const acknowledgementOf = (fileName: string) => (m: RetrievedEmail) => isAcknowledgement(m, fileName);

/** Comparison report email ("PO-ACK Comparison Ready", PO Number, Review in Stream button) */
export const isComparisonReport = (m: RetrievedEmail) => !!m.fields.reviewInStreamUrl && /PO-ACK Comparison Ready/i.test(`${m.fields.header ?? ''} ${m.plain}`);

/** One row of the report's "Comparison Summary" table (Status | Count | Line Item | Address) */
export interface ReportSummaryRow {
  status: string;
  count: number;
  lineItem: number;
  address: number;
}

/** Rows of the comparison report's summary table, e.g. Critical 3 (3 line item, 0 address) */
export function reportSummary(m: RetrievedEmail): ReportSummaryRow[] {
  const table = m.plain.split(/Comparison Summary/i)[1] ?? m.plain;
  return [...table.matchAll(/(Matched|Critical|Moderate|Medium|Minor|Low|Not in PO)\s+(\d+)\s+(\d+)\s+(\d+)/gi)].map((r) => ({
    status: r[1],
    count: parseInt(r[2], 10),
    lineItem: parseInt(r[3], 10),
    address: parseInt(r[4], 10),
  }));
}

/**
 * Waits for a reply in the thread (subject token) received after `since` that matches `predicate` and is not one
 * of `exclude` (emails already used by earlier steps).
 */
export async function waitForThreadReply(
  mail: MailService,
  opts: { token: string; since: Date; predicate: (m: RetrievedEmail) => boolean; exclude?: string[]; what: string; timeoutMs?: number },
): Promise<RetrievedEmail> {
  const deadline = Date.now() + (opts.timeoutMs ?? REPLY_WAIT_MS);
  const exclude = new Set((opts.exclude ?? []).filter(Boolean));
  let replies: RetrievedEmail[] = [];
  let lastError: Error | undefined;
  for (;;) {
    try {
      // One short IMAP session per check; a dropped or refused connection is retried at the next check
      replies = await mail.findReplies({ token: opts.token, from: replyFrom(), since: opts.since });
      lastError = undefined;
    } catch (err) {
      if (err instanceof MailAuthError) throw err;
      lastError = err as Error;
    }
    const hit = replies.find((m) => !exclude.has(m.messageId) && opts.predicate(m));
    if (hit) return hit;
    if (Date.now() > deadline) {
      const seen = replies.map((m) => `"${m.subject}" (${m.receivedAt.toISOString()}${opts.predicate(m) ? ', already used' : ''})`).join('; ') || 'none';
      throw new Error(
        `No ${opts.what} from ${replyFrom()} within ${Math.round((opts.timeoutMs ?? REPLY_WAIT_MS) / 60000)} min of ${opts.since.toISOString()}. ` +
          `Replies in the thread: ${seen}${lastError ? `. Last mailbox error: ${lastError.message}` : ''}`,
      );
    }
    // Checking every 30 s keeps the number of Gmail IMAP logins low (frequent logins get refused)
    await new Promise((r) => setTimeout(r, 30_000));
  }
}

/** Finds an email of the thread again by its Message-ID (for a later test that shows it) */
export async function fetchThreadEmail(mail: MailService, s: EmailState, email: StoredEmail): Promise<RetrievedEmail> {
  const replies = await mail.findReplies({ token: s.token!, from: replyFrom(), since: new Date(new Date(email.receivedAt).getTime() - 120_000) });
  const hit = replies.find((m) => m.messageId === email.messageId);
  expect(hit, `email "${email.subject}" (${email.receivedAt}) is still in the mailbox`).toBeTruthy();
  return hit!;
}

/** Number of navigations of the page's main frame from now on (to prove a page was not refreshed) */
export function countNavigations(page: Page): () => number {
  let n = 0;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) n++;
  });
  return () => n;
}
