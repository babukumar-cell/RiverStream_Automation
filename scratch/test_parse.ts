import { Config } from '../src/config/environment';
import imaps from 'imap-simple';
const { simpleParser } = require('mailparser');

export interface ProcessedEmailFields {
  header?: string;
  documentUsage?: string;
  reviewInStreamUrl?: string;
  fileName?: string;
  status?: string;
  customerName?: string;
  projectName?: string;
  message?: string;
  salesOrderNumber?: string;
  erpViewUrl?: string;
  documentDate?: string;
}

export function parseFields(text: string, html: string): ProcessedEmailFields {
  const fields: ProcessedEmailFields = {};

  // 1. Header: ERP Sales Order Processing Summary
  const headerMatch = text.match(/ERP Sales Order Processing Summary|No Attachment Found|Too Many Attachments|Document Process Failed|Attachment Couldn't Be Read|Document Already Processed|Document Already in Processing/i) ||
                      html.match(/<h[12][^>]*>([^<]+)<\/h[12]>/i);
  if (headerMatch) fields.header = (headerMatch[1] || headerMatch[0]).trim();

  // 2. Document Usage: 28/150 (Monthly)
  const usageMatch = text.match(/Document Usage:\s*([^\n\r]+)/i) || html.match(/Document Usage:\s*([^<]+)/i);
  if (usageMatch) fields.documentUsage = usageMatch[1].trim();

  // 3. Review in Stream link
  const reviewMatch = html.match(/href=["'](https?:\/\/[^"']*review[^"']*)["']/i) ||
                      text.match(/https?:\/\/[^\s]+review[^\s>]*/i);
  if (reviewMatch) fields.reviewInStreamUrl = (reviewMatch[1] || reviewMatch[0]).trim();

  // 4. File and Status
  const fileMatch = text.match(/\*?File:\*?\s*([^\s*]+(?:\.pdf|\.sif|\.xlsx|\.edi|\.[a-zA-Z0-9]+)?)/i) ||
                    html.match(/<b>File:<\/b>\s*([^<\u00a0]+)/i);
  if (fileMatch) fields.fileName = fileMatch[1].trim();

  const statusMatch = text.match(/\*?Status:\*?\s*([^\n\r*]+)/i) ||
                      html.match(/<b>Status:<\/b>\s*([^<]+)/i);
  if (statusMatch) fields.status = statusMatch[1].trim();

  // 5. Customer Name
  const custMatch = text.match(/\*?Customer Name:\*?\s*([^\n\r*]+)/i) ||
                    html.match(/<b>Customer Name:<\/b>\s*([^<]+)/i);
  if (custMatch) fields.customerName = custMatch[1].trim();

  // 6. Project Name
  const projMatch = text.match(/\*?Project Name:\*?\s*([^\n\r*]*)/i) ||
                    html.match(/<b>Project Name:<\/b>\s*([^<]*)/i);
  if (projMatch) fields.projectName = projMatch[1].trim();

  // 7. Message
  const msgMatch = text.match(/\*?Message:\*?\s*([^\n\r*]+)/i) ||
                   html.match(/<b>Message:<\/b>\s*([^<]+)/i);
  if (msgMatch) fields.message = msgMatch[1].trim();

  // 8. Sales Order Number and View in ERP
  const soMatch = text.match(/\*?Sales Order Number:\*?\s*([A-Za-z0-9\-]+)/i) ||
                  html.match(/<b>Sales Order Number:<\/b>\s*([A-Za-z0-9\-]+)/i);
  if (soMatch) fields.salesOrderNumber = soMatch[1].trim();

  const erpMatch = html.match(/href=["'](https?:\/\/[^"']*sales-order[^"']*)["']/i) ||
                   text.match(/https?:\/\/[^\s]+sales-order[^\s>]*/i);
  if (erpMatch) fields.erpViewUrl = (erpMatch[1] || erpMatch[0]).trim();

  // 9. Document Date
  const dateMatch = text.match(/\*?Document Date:\*?\s*(\d{2}\/\d{2}\/\d{4})/i) ||
                    html.match(/<b>Document Date:<\/b>\s*(\d{2}\/\d{2}\/\d{4})/i);
  if (dateMatch) fields.documentDate = dateMatch[1].trim();

  return fields;
}

async function testParse() {
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

  const connection = await imaps.connect(imapConfig);
  await connection.openBox('INBOX');
  const messages = await connection.search(['ALL'], { bodies: ['HEADER', 'TEXT', ''], markSeen: false });

  for (let i = messages.length - 1; i >= 0; i--) {
    const item = messages[i];
    const allPart = item.parts.find((p: any) => p.which === '');
    if (allPart && allPart.body) {
      const parsed: any = await simpleParser(allPart.body);
      const from = parsed.from?.text || '';
      if (from.includes('riverstream.qa') || from.includes('riverstonetech')) {
        console.log('Testing Parser on Latest Reply Email:');
        const extracted = parseFields(parsed.text, parsed.html);
        console.log('Extracted Fields:\n', JSON.stringify(extracted, null, 2));
        break;
      }
    }
  }
  connection.end();
}

testParse().catch(console.error);
