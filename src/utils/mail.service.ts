import nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import imaps, { ImapSimple, ImapSimpleOptions, Message } from 'imap-simple';
import type Imap from 'imap';
import { simpleParser, AddressObject, ParsedMail } from 'mailparser';
import { Config } from '../config/environment';

/*
 * Mail service used by the email-ingestion tests.
 *
 * - SMTP: sends test emails (with attachments) from Config.email.senderEmail to the ingestion address.
 * - IMAP: waits for the RiverStream reply to ONE specific email, correlated by a unique token that the
 *   test puts in the subject. Replies are found with a targeted server-side search
 *   (SINCE <send date> + SUBJECT <token> + FROM <ingestion address>) on a single connection per wait,
 *   so only matching messages are downloaded.
 * - Authentication / connection / TLS errors are thrown immediately with a clear message; they are
 *   never turned into "no reply yet", which would surface as a misleading poll timeout.
 */

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

export interface EmailAttachment {
  filename: string;
  content?: Buffer | string;
  path?: string;
  contentType?: string;
}

export interface SendEmailOptions {
  to?: string;
  subject: string;
  text?: string;
  html?: string;
  attachments?: EmailAttachment[];
  /** Extra headers, e.g. In-Reply-To / References when replying to a RiverStream email */
  inReplyTo?: string;
  references?: string | string[];
}

export interface SentEmail {
  messageId: string;
  subject: string;
  from: string;
  to: string;
  /** Local time just before the SMTP submission started */
  sentAt: Date;
  accepted: string[];
  rejected: string[];
  attachmentNames: string[];
}

export interface ReplyQuery {
  /** Unique correlation token that must appear in the reply subject (alphanumeric, no spaces) */
  token: string;
  /** Only replies received at or after this time are considered (normally SentEmail.sentAt) */
  since: Date;
  /** Sender of the reply. Defaults to the ingestion address. */
  from?: string;
  /** Message-IDs to ignore, e.g. replies already consumed earlier in the same scenario */
  excludeMessageIds?: string[];
  /** Optional extra filter on the reply body (plain text), e.g. a file name */
  bodyIncludes?: string;
  timeoutMs?: number;
  intervalMs?: number;
}

export interface OrderLineItem {
  productCode: string;
  description: string;
  qty: string;
  unitPrice: string;
  amount: string;
  /** Only present in Sales Order replies ("Frappe Status") */
  erpStatus?: string;
  comments?: string;
}

export interface DocumentUsage {
  raw: string;
  used: number;
  total: number;
  period: string;
}

export interface ProcessedEmailFields {
  /** Reply heading, e.g. "ERP Sales Order Processing Summary", "No Attachment Found" */
  header?: string;
  documentUsage?: DocumentUsage;
  /** Low-quota disclaimer, e.g. "You can upload 10 more documents before reaching your document limit." */
  quotaWarning?: string;
  reviewInStreamUrl?: string;
  fileName?: string;
  status?: string;
  customerName?: string;
  projectName?: string;
  message?: string;
  salesOrderNumber?: string;
  erpViewUrl?: string;
  documentDate?: string;
  orderLineItems: OrderLineItem[];
}

export interface ReceivedAttachment {
  filename: string;
  contentType: string;
  size: number;
}

export interface RetrievedEmail {
  uid: number;
  mailbox: string;
  messageId: string;
  inReplyTo?: string;
  references: string[];
  subject: string;
  /** Sender address (lower case) */
  from: string;
  /** Recipient addresses (lower case) */
  to: string[];
  /** Date header of the reply */
  date: Date;
  /** Time the mailbox received the message (IMAP INTERNALDATE) */
  receivedAt: Date;
  text: string;
  html: string;
  /** Body as normalised single-spaced plain text (derived from HTML when available) */
  plain: string;
  attachments: ReceivedAttachment[];
  fields: ProcessedEmailFields;
  quotaInfo?: string;
  reviewLink?: string;
}

export class MailAuthError extends Error {}
export class MailConnectionError extends Error {}
export class ReplyTimeoutError extends Error {}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

/**
 * TLS verification is ON by default. Some local antivirus "mail shields" (e.g. Avast) intercept
 * IMAP/SMTP and re-sign Gmail's certificate with an untrusted root; on such machines set
 * EMAIL_TLS_REJECT_UNAUTHORIZED=false in .env. Never needed in CI.
 */
function tlsRejectUnauthorized(): boolean {
  return (process.env.EMAIL_TLS_REJECT_UNAUTHORIZED || 'true').trim().toLowerCase() !== 'false';
}

const TLS_HINT =
  'If a local antivirus mail shield intercepts TLS (e.g. Avast "Untrusted Root"), set EMAIL_TLS_REJECT_UNAUTHORIZED=false in .env.';

function isTlsError(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  return /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|unable to verify|self[- ]signed|certificate/i.test(`${e.code ?? ''} ${e.message ?? ''}`);
}

function isAuthError(err: unknown): boolean {
  const e = err as { source?: string; textCode?: string; responseCode?: number; code?: string; message?: string };
  return (
    e.source === 'authentication' ||
    e.textCode === 'AUTHENTICATIONFAILED' ||
    e.code === 'EAUTH' ||
    e.responseCode === 535 ||
    /AUTHENTICATIONFAILED|Invalid credentials|Username and Password not accepted|Application-specific password required/i.test(e.message ?? '')
  );
}

function wrapMailError(err: unknown, protocol: 'IMAP' | 'SMTP', host: string): Error {
  const msg = (err as Error)?.message ?? String(err);
  if (isAuthError(err)) {
    return new MailAuthError(
      `[MailService] ${protocol} authentication failed for SENDER_EMAIL on ${host}: ${msg}. ` +
        'Check SENDER_EMAIL / SENDER_APP_PASSWORD (a Gmail app password, IMAP enabled).',
    );
  }
  if (isTlsError(err)) {
    return new MailConnectionError(`[MailService] ${protocol} TLS verification failed on ${host}: ${msg}. ${TLS_HINT}`);
  }
  return new MailConnectionError(`[MailService] ${protocol} connection to ${host} failed: ${msg}`);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function addressList(value: AddressObject | AddressObject[] | undefined): string[] {
  if (!value) return [];
  const objs = Array.isArray(value) ? value : [value];
  return objs.flatMap((o) => o.value.map((v) => (v.address ?? '').toLowerCase())).filter(Boolean);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;|&rsquo;|&#8217;/gi, "'")
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCharCode(parseInt(code, 10)));
}

/** HTML -> single-spaced plain text (block elements become spaces). */
export function htmlToPlain(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/(p|div|tr|td|th|h\d|li|table)>/gi, ' ')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function normaliseText(text: string): string {
  return text.replace(/\*/g, '').replace(/\s+/g, ' ').trim();
}

/** Labels used in RiverStream reply bodies. Order does not matter; values run until the next label. */
const FIELD_LABELS: Array<[keyof ProcessedEmailFields, string]> = [
  ['fileName', 'File'],
  ['status', 'Status'],
  ['customerName', 'Customer Name'],
  ['projectName', 'Project Name'],
  ['message', 'Message'],
  ['salesOrderNumber', 'Sales Order Number'],
  ['documentDate', 'Document Date'],
];
const SECTION_STOPS = ['Order Line Items', 'View in ERP', 'DISCLAIMER', 'Review in Stream', 'Thanks,'];

function extractLabelledFields(plain: string): Partial<ProcessedEmailFields> {
  const found: Array<{ key: keyof ProcessedEmailFields; start: number; valueStart: number }> = [];
  for (const [key, label] of FIELD_LABELS) {
    const re = new RegExp(`(?:^|\\s)${label.replace(/ /g, '\\s+')}:`, 'i');
    const m = re.exec(plain);
    if (m) found.push({ key, start: m.index, valueStart: m.index + m[0].length });
  }
  const stops = SECTION_STOPS.map((s) => plain.indexOf(s)).filter((i) => i >= 0);
  const boundaries = [...found.map((f) => f.start), ...stops];
  const out: Partial<ProcessedEmailFields> = {};
  for (const f of found) {
    const end = Math.min(plain.length, ...boundaries.filter((b) => b >= f.valueStart));
    (out as Record<string, string>)[f.key] = plain.slice(f.valueStart, end).trim().replace(/\s*-\s*$/, '');
  }
  return out;
}

function parseLineItems(html: string): OrderLineItem[] {
  const items: OrderLineItem[] = [];
  const tables = html.match(/<table[\s\S]*?<\/table>/gi) ?? [];
  for (const table of tables) {
    const rows = table.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
    if (rows.length < 2) continue;
    const cells = (row: string) =>
      (row.match(/<t[hd][^>]*>[\s\S]*?<\/t[hd]>/gi) ?? []).map((c) => htmlToPlain(c));
    const headers = cells(rows[0] ?? '').map((h) => h.toLowerCase());
    const idx = (name: string) => headers.findIndex((h) => h.includes(name));
    if (idx('product code') < 0) continue;
    for (const row of rows.slice(1)) {
      const c = cells(row);
      if (c.length < headers.length) continue;
      const at = (name: string) => (idx(name) >= 0 ? c[idx(name)] : undefined);
      items.push({
        productCode: at('product code') ?? '',
        description: at('description') ?? '',
        qty: at('qty') ?? '',
        unitPrice: at('unit price') ?? '',
        amount: at('amount') ?? '',
        erpStatus: at('status'),
        comments: at('comment'),
      });
    }
  }
  return items;
}

/** Parse the structured content of a RiverStream reply. Pure function, unit-testable. */
export function parseReplyFields(text: string, html: string): ProcessedEmailFields {
  const plain = html ? htmlToPlain(html) : normaliseText(text);
  const fields: ProcessedEmailFields = { orderLineItems: [] };

  const h = html.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i);
  if (h) {
    fields.header = htmlToPlain(h[1]);
  } else {
    const before = normaliseText(text).split(/Document Usage:/i)[0].trim();
    if (before) fields.header = before.split(/\s-{3,}/)[0].trim();
  }

  const usage = plain.match(/Document Usage:\s*((\d+)\s*\/\s*(\d+)\s*\(([^)]+)\))/i);
  if (usage) {
    fields.documentUsage = { raw: usage[1], used: Number(usage[2]), total: Number(usage[3]), period: usage[4].trim() };
  }

  const warning = plain.match(/You can upload \d+ more documents?[^.]*\.?/i);
  if (warning) fields.quotaWarning = warning[0].trim();

  const anchors = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].map((m) => ({
    href: decodeEntities(m[1]),
    label: htmlToPlain(m[2]),
  }));
  fields.reviewInStreamUrl =
    anchors.find((a) => /review in stream/i.test(a.label))?.href ??
    text.match(/Review in Stream\s*<?(https?:\/\/\S+?)>?(?:\s|$)/i)?.[1];
  fields.erpViewUrl =
    anchors.find((a) => /view in erp/i.test(a.label))?.href ??
    text.match(/View in ERP\s*<?(https?:\/\/\S+?)>?(?:\s|$)/i)?.[1];

  Object.assign(fields, extractLabelledFields(plain));
  if (fields.salesOrderNumber) fields.salesOrderNumber = fields.salesOrderNumber.split(/\s/)[0];

  fields.orderLineItems = parseLineItems(html);
  return fields;
}

// ---------------------------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------------------------

const HEADER_FIELDS = 'HEADER.FIELDS (MESSAGE-ID SUBJECT FROM DATE)';

export class MailService {
  private readonly transporter: nodemailer.Transporter<SMTPTransport.SentMessageInfo>;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: Config.email.smtpHost,
      port: Config.email.smtpPort,
      secure: Config.email.smtpPort === 465,
      auth: { user: Config.email.senderEmail, pass: Config.email.senderAppPassword },
      tls: { rejectUnauthorized: tlsRejectUnauthorized() },
    });
  }

  private assertConfigured(): void {
    if (!Config.email.senderEmail || !Config.email.senderAppPassword) {
      throw new MailAuthError('[MailService] SENDER_EMAIL and SENDER_APP_PASSWORD must be set in .env to run email tests.');
    }
    if (!Config.email.ingestionEmail) {
      throw new MailConnectionError('[MailService] INGESTION_EMAIL must be set in .env to run email tests.');
    }
  }

  /** Verify SMTP credentials. Throws MailAuthError / MailConnectionError. */
  async verifySmtp(): Promise<void> {
    this.assertConfigured();
    try {
      await this.transporter.verify();
    } catch (err) {
      throw wrapMailError(err, 'SMTP', Config.email.smtpHost);
    }
  }

  /** Convenience alias for verifying SMTP connection. */
  async verifyConnection(): Promise<void> {
    await this.verifySmtp();
  }

  /** Verify IMAP credentials (opens INBOX once). Throws MailAuthError / MailConnectionError. */
  async verifyImap(): Promise<void> {
    const conn = await this.connectImap();
    try {
      await conn.openBox('INBOX');
    } finally {
      this.safeEnd(conn);
    }
  }

  /** Send an email (to the ingestion address unless `to` is given). */
  async sendEmail(options: SendEmailOptions): Promise<SentEmail> {
    this.assertConfigured();
    const to = options.to ?? Config.email.ingestionEmail;
    const from = Config.email.senderEmail;
    const sentAt = new Date();
    let info: SMTPTransport.SentMessageInfo;
    try {
      info = await this.transporter.sendMail({
        from,
        to,
        subject: options.subject,
        text: options.text,
        html: options.html,
        attachments: options.attachments,
        inReplyTo: options.inReplyTo,
        references: options.references,
      });
    } catch (err) {
      throw wrapMailError(err, 'SMTP', Config.email.smtpHost);
    }
    const asStrings = (list: Array<string | { address: string }>) =>
      list.map((a) => (typeof a === 'string' ? a : a.address).toLowerCase());
    return {
      messageId: info.messageId,
      subject: options.subject,
      from,
      to,
      sentAt,
      accepted: asStrings(info.accepted),
      rejected: asStrings(info.rejected),
      attachmentNames: (options.attachments ?? []).map((a) => a.filename),
    };
  }

  /**
   * Wait for the first reply whose subject contains `query.token`.
   * Uses one IMAP connection for the whole wait. Throws ReplyTimeoutError if nothing arrives in time,
   * MailAuthError / MailConnectionError on credential or connection problems.
   */
  async waitForReply(query: ReplyQuery): Promise<RetrievedEmail> {
    const [reply] = await this.waitForReplies(query, 1);
    return reply;
  }

  /** Convenience method for polling for a reply by subject substring. */
  async pollForReply(opts: { subjectContains: string; timeoutMs?: number }): Promise<RetrievedEmail> {
    const token = opts.subjectContains.replace(/[\[\]]/g, '');
    const since = new Date(Date.now() - (opts.timeoutMs ?? 120000));
    return this.waitForReply({
      token,
      since,
      timeoutMs: opts.timeoutMs,
    });
  }

  /** Wait until at least `count` correlated replies exist; returns them oldest first. */
  async waitForReplies(query: ReplyQuery, count: number): Promise<RetrievedEmail[]> {
    const timeoutMs = query.timeoutMs ?? Config.email.pollTimeoutMs;
    const intervalMs = query.intervalMs ?? Config.email.pollIntervalMs;
    const deadline = Date.now() + timeoutMs;
    let conn = await this.connectImap();
    let reconnects = 0;
    try {
      const spamBox = await this.findSpamBox(conn);
      for (;;) {
        let found: RetrievedEmail[];
        try {
          found = await this.searchReplies(conn, query, spamBox);
        } catch (err) {
          // A dropped socket mid-wait gets one reconnect; auth/TLS problems are thrown straight away.
          if (isAuthError(err) || isTlsError(err) || reconnects >= 1) throw wrapMailError(err, 'IMAP', Config.email.imapHost);
          reconnects++;
          this.safeEnd(conn);
          conn = await this.connectImap();
          continue;
        }
        if (found.length >= count) return found;
        if (Date.now() + intervalMs > deadline) {
          throw new ReplyTimeoutError(
            `[MailService] Expected ${count} reply(ies) from ${query.from ?? Config.email.ingestionEmail} with "${query.token}" ` +
              `in the subject within ${Math.round(timeoutMs / 1000)}s of ${query.since.toISOString()}; found ${found.length}.`,
          );
        }
        await sleep(intervalMs);
      }
    } finally {
      this.safeEnd(conn);
    }
  }

  /** One-shot search: every correlated reply currently in the mailbox (INBOX, then Spam if INBOX has none). */
  async findReplies(query: ReplyQuery): Promise<RetrievedEmail[]> {
    const conn = await this.connectImap();
    try {
      return await this.searchReplies(conn, query, await this.findSpamBox(conn));
    } catch (err) {
      throw err instanceof MailAuthError || err instanceof MailConnectionError ? err : wrapMailError(err, 'IMAP', Config.email.imapHost);
    } finally {
      this.safeEnd(conn);
    }
  }

  // -------------------------------------------------------------------------------------------
  // IMAP internals
  // -------------------------------------------------------------------------------------------

  private async connectImap(): Promise<ImapSimple> {
    this.assertConfigured();
    const imapConfig: Imap.Config = {
      user: Config.email.senderEmail,
      password: Config.email.senderAppPassword,
      host: Config.email.imapHost,
      port: Config.email.imapPort,
      tls: true,
      tlsOptions: { rejectUnauthorized: tlsRejectUnauthorized(), servername: Config.email.imapHost },
      authTimeout: 20000,
      connTimeout: 20000,
    };
    const options: ImapSimpleOptions = { imap: imapConfig };
    try {
      const conn = await imaps.connect(options);
      // Without a listener a socket error after connect would crash the worker; the next command rejects instead.
      conn.on('error', (e: Error) => console.warn(`[MailService] IMAP connection error: ${e.message}`));
      return conn;
    } catch (err) {
      throw wrapMailError(err, 'IMAP', Config.email.imapHost);
    }
  }

  private safeEnd(conn: ImapSimple): void {
    try {
      conn.end();
    } catch {
      // closing an already-closed connection is not an error worth reporting
    }
  }

  /** Locate the Spam folder via the \Junk special-use flag (name is localised in some accounts). */
  private async findSpamBox(conn: ImapSimple): Promise<string | undefined> {
    const boxes = await conn.getBoxes();
    const walk = (tree: Imap.MailBoxes, prefix: string): string | undefined => {
      for (const [name, box] of Object.entries(tree)) {
        const full = prefix ? `${prefix}${box.delimiter}${name}` : name;
        if ((box.attribs ?? []).some((a) => /\\Junk/i.test(a))) return full;
        if (box.children) {
          const hit = walk(box.children, full);
          if (hit) return hit;
        }
      }
      return undefined;
    };
    return walk(boxes, '');
  }

  private async searchReplies(conn: ImapSimple, query: ReplyQuery, spamBox: string | undefined): Promise<RetrievedEmail[]> {
    const inbox = await this.searchMailbox(conn, 'INBOX', query);
    if (inbox.length > 0 || !spamBox) return inbox;
    return this.searchMailbox(conn, spamBox, query);
  }

  private async searchMailbox(conn: ImapSimple, mailbox: string, query: ReplyQuery): Promise<RetrievedEmail[]> {
    await conn.openBox(mailbox);
    const from = query.from ?? Config.email.ingestionEmail;
    // IMAP SINCE has day granularity; the exact cut-off is applied on INTERNALDATE below.
    const sinceDay = new Date(query.since.getTime() - 24 * 60 * 60 * 1000);
    const criteria = [['SINCE', sinceDay], ['HEADER', 'SUBJECT', query.token], ['FROM', from]];

    // 1) headers only, to apply the exact filters cheaply
    const headerHits: Message[] = await conn.search(criteria, { bodies: [HEADER_FIELDS], markSeen: false });
    const cutoff = query.since.getTime() - 60 * 1000; // tolerate small clock skew between this machine and Gmail
    const exclude = new Set((query.excludeMessageIds ?? []).map((id) => id.trim()));
    const wanted = headerHits.filter((m) => {
      const hdr = m.parts.find((p) => p.which === HEADER_FIELDS)?.body as Record<string, string[]> | undefined;
      const subject = hdr?.subject?.[0] ?? '';
      const messageId = (hdr?.['message-id']?.[0] ?? '').trim();
      return (
        new Date(m.attributes.date).getTime() >= cutoff &&
        subject.toLowerCase().includes(query.token.toLowerCase()) &&
        !exclude.has(messageId)
      );
    });
    if (wanted.length === 0) return [];

    // 2) full source only for the correlated messages
    const uids = wanted.map((m) => m.attributes.uid);
    const full: Message[] = await conn.search([['UID', uids.join(',')]], { bodies: [''], markSeen: false });
    const parsed: RetrievedEmail[] = [];
    for (const m of full) {
      const source = m.parts.find((p) => p.which === '')?.body as string | undefined;
      if (!source) continue;
      const mail = await simpleParser(source);
      const email = this.toRetrievedEmail(mail, m, mailbox);
      if (query.bodyIncludes && !`${email.plain} ${email.text}`.toLowerCase().includes(query.bodyIncludes.toLowerCase())) continue;
      parsed.push(email);
    }
    return parsed.sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
  }

  private toRetrievedEmail(mail: ParsedMail, msg: Message, mailbox: string): RetrievedEmail {
    const text = mail.text ?? '';
    const html = typeof mail.html === 'string' ? mail.html : '';
    const refs = mail.references === undefined ? [] : Array.isArray(mail.references) ? mail.references : [mail.references];
    const fields = parseReplyFields(text, html);
    const quotaInfo = fields.quotaWarning || (fields.documentUsage ? `${fields.documentUsage.used}/${fields.documentUsage.total}` : undefined);
    const reviewLink = fields.reviewInStreamUrl;
    return {
      uid: msg.attributes.uid,
      mailbox,
      messageId: mail.messageId ?? '',
      inReplyTo: mail.inReplyTo,
      references: refs,
      subject: mail.subject ?? '',
      from: addressList(mail.from)[0] ?? '',
      to: addressList(mail.to),
      date: mail.date ?? new Date(msg.attributes.date),
      receivedAt: new Date(msg.attributes.date),
      text,
      html,
      plain: html ? htmlToPlain(html) : normaliseText(text),
      attachments: mail.attachments.map((a) => ({ filename: a.filename ?? '', contentType: a.contentType, size: a.size })),
      fields,
      quotaInfo,
      reviewLink,
    };
  }
}
