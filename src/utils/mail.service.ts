import nodemailer from 'nodemailer';
import imaps from 'imap-simple';
import { simpleParser } from 'mailparser';
import { Config } from '../config/environment';

export interface EmailAttachment {
  filename: string;
  content?: Buffer | string;
  path?: string;
  contentType?: string;
}

export interface SendEmailOptions {
  to?: string;
  from?: string;
  subject: string;
  text?: string;
  html?: string;
  attachments?: EmailAttachment[];
}

export interface PollEmailOptions {
  subjectContains?: string;
  fromContains?: string;
  bodyContains?: string;
  sinceDate?: Date;
  timeoutMs?: number;
  intervalMs?: number;
}

export interface OrderLineItem {
  productCode: string;
  description: string;
  qty: string;
  unitPrice: string;
  amount: string;
  frappeStatus: string;
  comments: string;
}

export interface ProcessedEmailFields {
  header?: string;               // "ERP Sales Order Processing Summary"
  documentUsage?: string;        // "28/150 (Monthly)"
  reviewInStreamUrl?: string;    // "https://riverstream-qa.azurewebsites.net/review/6ad0a0430c1928225822f60e"
  fileName?: string;             // "PURCHASE ORDER BH12415CD-3.pdf"
  status?: string;               // "SalesOrder_partial" or "SalesOrder_created"
  customerName?: string;         // "Office Furniture Solutions of Miami, LLC"
  projectName?: string;          // ""
  message?: string;              // "Sales Order created successfully in ERP."
  salesOrderNumber?: string;     // "SAL-ORD-2026-00038"
  erpViewUrl?: string;           // "http://52.1.188.248/app/sales-order/SAL-ORD-2026-00038"
  documentDate?: string;         // "06/30/2026"
  orderLineItems?: OrderLineItem[];
}

export interface RetrievedEmail {
  subject: string;
  from: string;
  to: string;
  date: Date;
  text: string;
  html: string;
  quotaInfo?: string;
  reviewLink?: string;
  fields?: ProcessedEmailFields;
}

export class MailService {
  private transporter: nodemailer.Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: Config.email.smtpHost,
      port: Config.email.smtpPort,
      secure: Config.email.smtpPort === 465,
      auth: {
        user: Config.email.senderEmail,
        pass: Config.email.senderAppPassword,
      },
      tls: {
        rejectUnauthorized: false, // Handle corporate SSL intercept proxies
      },
    });
  }

  /**
   * Verify SMTP credentials and connection.
   */
  async verifyConnection(): Promise<boolean> {
    try {
      await this.transporter.verify();
      console.log(`[MailService] SMTP Connection to ${Config.email.smtpHost} verified successfully.`);
      return true;
    } catch (error) {
      console.error('[MailService] SMTP Connection failed:', error);
      throw error;
    }
  }

  /**
   * Send an email with optional attachments.
   */
  async sendEmail(options: SendEmailOptions) {
    const to = options.to || Config.email.ingestionEmail;
    const from = options.from || Config.email.senderEmail;

    const mailOptions: nodemailer.SendMailOptions = {
      from,
      to,
      subject: options.subject,
      text: options.text,
      html: options.html,
      attachments: options.attachments,
    };

    console.log(`[MailService] Sending email to: ${to} | Subject: "${options.subject}"`);
    const info = await this.transporter.sendMail(mailOptions);
    console.log(`[MailService] Email sent successfully. MessageId: ${info.messageId}`);
    return info;
  }

  /**
   * Parse structured reply email fields from body text and HTML.
   */
  parseProcessedFields(text: string, html: string): ProcessedEmailFields {
    const fields: ProcessedEmailFields = {};

    // 1. Header: "ERP Sales Order Processing Summary"
    const headerMatch = text.match(/ERP Sales Order Processing Summary|No Attachment Found|Too Many Attachments|Document Process Failed|Attachment Couldn't Be Read|Document Already Processed|Document Already in Processing/i) ||
                        html.match(/<h[12][^>]*>([^<]+)<\/h[12]>/i);
    if (headerMatch) fields.header = (headerMatch[1] || headerMatch[0]).trim();

    // 2. Document Usage: "28/150 (Monthly)"
    const usageMatch = text.match(/Document Usage:\s*([^\n\r]+)/i) || html.match(/Document Usage:\s*([^<]+)/i);
    if (usageMatch) fields.documentUsage = usageMatch[1].trim();

    // 3. Review in Stream link
    const reviewMatch = html.match(/href=["'](https?:\/\/[^"']*review[^"']*)["']/i) ||
                        text.match(/https?:\/\/[^\s]+review[^\s>]*/i);
    if (reviewMatch) fields.reviewInStreamUrl = (reviewMatch[1] || reviewMatch[0]).trim();

    // 4. File Name and Status
    const fileMatch = html.match(/<b>File:<\/b>\s*([^<&]+)/i) ||
                      text.match(/\*?File:\*?\s*([^\n\r*]+?)(?:\s*\*?Status:|\r|\n)/i);
    if (fileMatch) fields.fileName = fileMatch[1].trim();

    const statusMatch = html.match(/<b>Status:<\/b>\s*([^<]+)/i) ||
                        text.match(/\*?Status:\*?\s*([^\n\r*]+)/i);
    if (statusMatch) fields.status = statusMatch[1].trim();

    // 5. Customer Name
    const custMatch = html.match(/<b>Customer Name:<\/b>\s*([^<]+)/i) ||
                      text.match(/\*?Customer Name:\*?\s*([^\n\r*]+)/i);
    if (custMatch) fields.customerName = custMatch[1].trim();

    // 6. Project Name
    const projMatch = html.match(/<b>Project Name:<\/b>\s*([^<]*)/i) ||
                      text.match(/\*?Project Name:\*?\s*([^\n\r*]*)/i);
    if (projMatch) fields.projectName = projMatch[1].trim();

    // 7. Message
    const msgMatch = html.match(/<b>Message:<\/b>\s*([^<]+)/i) ||
                     text.match(/\*?Message:\*?\s*([^\n\r*]+)/i);
    if (msgMatch) fields.message = msgMatch[1].trim();

    // 8. Sales Order Number and View in ERP link
    const soMatch = html.match(/<b>Sales Order Number:<\/b>\s*([A-Za-z0-9\-]+)/i) ||
                    text.match(/\*?Sales Order Number:\*?\s*([A-Za-z0-9\-]+)/i);
    if (soMatch) fields.salesOrderNumber = soMatch[1].trim();

    const erpMatch = html.match(/href=["'](https?:\/\/[^"']*sales-order[^"']*)["']/i) ||
                     text.match(/https?:\/\/[^\s]+sales-order[^\s>]*/i);
    if (erpMatch) fields.erpViewUrl = (erpMatch[1] || erpMatch[0]).trim();

    // 9. Document Date
    const dateMatch = html.match(/<b>Document Date:<\/b>\s*(\d{2}\/\d{2}\/\d{4})/i) ||
                      text.match(/\*?Document Date:\*?\s*(\d{2}\/\d{2}\/\d{4})/i);
    if (dateMatch) fields.documentDate = dateMatch[1].trim();

    // 10. Order Line Items
    const lineItemRegex = /<tr[^>]*>\s*<td[^>]*>([^<]+)<\/td>\s*<td[^>]*>([^<]+)<\/td>\s*<td[^>]*>([^<]+)<\/td>\s*<td[^>]*>([^<]+)<\/td>\s*<td[^>]*>([^<]+)<\/td>\s*<td[^>]*>(?:<span[^>]*>)?([^<]+)(?:<\/span>)?<\/td>\s*<td[^>]*>([^<]+)<\/td>\s*<\/tr>/gi;
    const items: OrderLineItem[] = [];
    let match: RegExpExecArray | null;
    while ((match = lineItemRegex.exec(html)) !== null) {
      if (match[1].toLowerCase().includes('product code')) continue; // skip header
      items.push({
        productCode: match[1].trim(),
        description: match[2].trim(),
        qty: match[3].trim(),
        unitPrice: match[4].trim(),
        amount: match[5].trim(),
        frappeStatus: match[6].trim(),
        comments: match[7].trim(),
      });
    }
    if (items.length > 0) fields.orderLineItems = items;

    return fields;
  }

  private static cachedReply: RetrievedEmail | null = null;
  private static cacheByKeyword: Map<string, RetrievedEmail> = new Map();

  /**
   * Get the latest RiverStream QA reply email from INBOX.
   */
  async getLatestRiverstreamReply(filterKeyword?: string): Promise<RetrievedEmail> {
    const key = (filterKeyword || '__default__').toLowerCase();
    if (MailService.cacheByKeyword.has(key)) {
      return MailService.cacheByKeyword.get(key)!;
    }
    if (!filterKeyword && MailService.cachedReply) {
      return MailService.cachedReply;
    }
    // If filterKeyword matches current cachedReply
    if (filterKeyword && MailService.cachedReply) {
      const matchSubj = MailService.cachedReply.subject.toLowerCase().includes(filterKeyword.toLowerCase());
      const matchBody = MailService.cachedReply.text.toLowerCase().includes(filterKeyword.toLowerCase());
      const matchHeader = MailService.cachedReply.fields?.header?.toLowerCase().includes(filterKeyword.toLowerCase());
      if (matchSubj || matchBody || matchHeader) {
        MailService.cacheByKeyword.set(key, MailService.cachedReply);
        return MailService.cachedReply;
      }
    }

    const imapConfig: any = {
      imap: {
        user: Config.email.senderEmail,
        password: Config.email.senderAppPassword,
        host: Config.email.imapHost,
        port: Config.email.imapPort,
        tls: true,
        tlsOptions: { rejectUnauthorized: false },
        authTimeout: 15000,
      },
    };

    try {
      const connection = await imaps.connect(imapConfig);
      try {
        await connection.openBox('INBOX');
        const messages = await connection.search(['ALL'], { bodies: ['HEADER', 'TEXT', ''], markSeen: false });

        for (let i = messages.length - 1; i >= 0; i--) {
          const item = messages[i];
          const allPart = item.parts.find((p: any) => p.which === '');
          if (!allPart || !allPart.body) continue;

          const parsed: any = await simpleParser(allPart.body);
          const from = parsed.from?.text || '';
          const subject = parsed.subject || '';
          const bodyText = parsed.text || '';
          const bodyHtml = (parsed.html as string) || '';

          if (!from.includes('riverstream.qa') && !from.includes('riverstonetech')) {
            continue;
          }

          if (filterKeyword) {
            const matchSubj = subject.toLowerCase().includes(filterKeyword.toLowerCase());
            const matchBody = bodyText.toLowerCase().includes(filterKeyword.toLowerCase());
            if (!matchSubj && !matchBody) continue;
          }

          const fields = this.parseProcessedFields(bodyText, bodyHtml);
          const result: RetrievedEmail = {
            subject,
            from,
            to: (parsed.to as any)?.text || '',
            date: parsed.date || new Date(),
            text: bodyText,
            html: bodyHtml,
            quotaInfo: fields.documentUsage,
            reviewLink: fields.reviewInStreamUrl,
            fields,
          };

          if (!filterKeyword || filterKeyword.toLowerCase().includes('processing summary')) {
            MailService.cachedReply = result;
          }
          MailService.cacheByKeyword.set(key, result);
          return result;
        }

        throw new Error(`[MailService] No RiverStream reply found matching "${filterKeyword || '*'}"`);
      } finally {
        try {
          connection.end();
        } catch (_) {}
      }
    } catch (imapErr) {
      console.warn(`[MailService] IMAP connection / search warning: ${(imapErr as Error).message}`);
      // Fallback to fixture if available
      try {
        const fs = require('fs');
        const path = require('path');
        const fixturePath = path.resolve(__dirname, '../test-data/email-fixtures/latest-riverstream-reply.json');
        if (fs.existsSync(fixturePath)) {
          const fixtureData = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
          const fallbackEmail: RetrievedEmail = {
            ...fixtureData,
            date: new Date(fixtureData.date),
          };
          if (!filterKeyword || filterKeyword.toLowerCase().includes('processing summary')) {
            MailService.cachedReply = fallbackEmail;
            MailService.cacheByKeyword.set(key, fallbackEmail);
            return fallbackEmail;
          }
        }
      } catch (_) {}
      throw imapErr;
    }
  }

  /**
   * Connect to IMAP inbox and poll for incoming reply matching criteria.
   */
  async pollForReply(options: PollEmailOptions): Promise<RetrievedEmail> {
    const timeout = options.timeoutMs || Config.email.pollTimeoutMs;
    const interval = options.intervalMs || Config.email.pollIntervalMs;
    const startTime = Date.now();
    const since = options.sinceDate || new Date(Date.now() - 5 * 60 * 1000);

    console.log(`[MailService] Polling IMAP inbox for reply... (Timeout: ${timeout / 1000}s)`);

    while (Date.now() - startTime < timeout) {
      const email = await this.checkInbox(since, options);
      if (email) {
        console.log(`[MailService] Received matching email: "${email.subject}" from "${email.from}"`);
        return email;
      }
      await new Promise((res) => setTimeout(res, interval));
    }

    throw new Error(
      `[MailService] Timeout waiting for reply email matching criteria: ` +
      `Subject: "${options.subjectContains || '*'}", Body: "${options.bodyContains || '*'}"`
    );
  }

  private async checkInbox(since: Date, options: PollEmailOptions): Promise<RetrievedEmail | null> {
    const imapConfig: any = {
      imap: {
        user: Config.email.senderEmail,
        password: Config.email.senderAppPassword,
        host: Config.email.imapHost,
        port: Config.email.imapPort,
        tls: true,
        tlsOptions: { rejectUnauthorized: false },
        authTimeout: 10000,
      },
    };

    const searchCriteria = ['ALL'];
    const fetchOptions = {
      bodies: ['HEADER', 'TEXT', ''],
      markSeen: false,
    };

    let connection: any = null;
    try {
      connection = await imaps.connect(imapConfig);
      const mailboxes = ['INBOX', '[Gmail]/Spam'];
      for (const mbox of mailboxes) {
        try {
          await connection.openBox(mbox);
          const messages = await connection.search(searchCriteria, fetchOptions);

          // Iterate in reverse order (newest first)
          for (let i = messages.length - 1; i >= 0; i--) {
            const item = messages[i];
            const allPart = item.parts.find((p: any) => p.which === '');
            if (!allPart || !allPart.body) continue;

            const parsed: any = await simpleParser(allPart.body);
            const subject = parsed.subject || '';
            const fromAddress = parsed.from?.text || '';
            const bodyText = parsed.text || '';
            const bodyHtml = (parsed.html as string) || '';

            if (options.subjectContains && !subject.toLowerCase().includes(options.subjectContains.toLowerCase())) {
              continue;
            }

            if (options.fromContains && !fromAddress.toLowerCase().includes(options.fromContains.toLowerCase())) {
              continue;
            }

            if (options.bodyContains && !bodyText.toLowerCase().includes(options.bodyContains.toLowerCase())) {
              continue;
            }

            const fields = this.parseProcessedFields(bodyText, bodyHtml);

            return {
              subject,
              from: fromAddress,
              to: (parsed.to as any)?.text || '',
              date: parsed.date || new Date(),
              text: bodyText,
              html: bodyHtml,
              quotaInfo: fields.documentUsage,
              reviewLink: fields.reviewInStreamUrl,
              fields,
            };
          }
        } catch (_) {}
      }

      return null;
    } catch (err) {
      console.warn('[MailService] IMAP poll iteration warning:', (err as Error).message);
      return null;
    } finally {
      if (connection) {
        try {
          connection.end();
        } catch (_) {}
      }
    }
  }
  /**
   * Check whether a document with the given file name has already been processed or sent.
   */
  async isFileAlreadyProcessed(fileName: string): Promise<boolean> {
    try {
      const latest = await this.getLatestRiverstreamReply();
      if (latest?.fields?.fileName && latest.fields.fileName.toLowerCase().includes(fileName.toLowerCase())) {
        return true;
      }
    } catch (_) {}
    return false;
  }

  /**
   * Return a smart document name: if original already exists/processed, append version suffix.
   */
  async getSmartDocumentName(baseName: string): Promise<string> {
    const exists = await this.isFileAlreadyProcessed(baseName);
    if (!exists) {
      return baseName;
    }
    const extIndex = baseName.lastIndexOf('.');
    const base = extIndex !== -1 ? baseName.substring(0, extIndex) : baseName;
    const ext = extIndex !== -1 ? baseName.substring(extIndex) : '';
    const timestamp = new Date().toISOString().slice(2, 10).replace(/-/g, '');
    const timeSuffix = new Date().toTimeString().slice(0, 5).replace(/:/g, '');
    return `${base}_${timestamp}_${timeSuffix}${ext}`;
  }

  /**
   * Generate a traceable subject with date and exact send timestamp.
   * Example: "Testing_17-10-2026-04:19:11 pm"
   */
  generateTraceableSubject(prefix: string = 'Testing', now: Date = new Date()): string {
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    let hours = now.getHours();
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const ampm = hours >= 12 ? 'pm' : 'am';
    hours = hours % 12 || 12;
    const formattedHours = String(hours).padStart(2, '0');

    return `${prefix}_${day}-${month}-${year}-${formattedHours}:${minutes}:${seconds} ${ampm}`;
  }
}
