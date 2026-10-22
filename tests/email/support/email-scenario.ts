import fs from 'fs';
import os from 'os';
import path from 'path';
import { chromium, Browser, TestInfo } from '@playwright/test';
import { Config } from '../../../src/config/environment';
import { MailService, RetrievedEmail, SentEmail, EmailAttachment } from '../../../src/utils/mail.service';

/*
 * Test-data builders and timing constants for the email-ingestion suite.
 * Every document is synthetic and generated per test, named after a unique correlation token,
 * so no real customer files are mailed and no two runs collide on RiverStream's duplicate check.
 */

/** Reply must arrive within this time (EMAIL_POLL_TIMEOUT_MS, default 180 s). */
export const REPLY_SLA_MS = Config.email.pollTimeoutMs;
/** We keep waiting a little past the SLA so a slow reply is reported as "late" by TC_RS_EM_021, not as missing everywhere. */
export const REPLY_WAIT_MS = REPLY_SLA_MS + 120_000;
/** One RiverStream mailbox polling cycle (observed 50-165 s); used to detect duplicate replies. */
export const DUPLICATE_GRACE_MS = 150_000;
/** Test timeout for a scenario with `waits` sequential reply waits. */
export const scenarioTimeout = (waits: number) => waits * REPLY_WAIT_MS + 120_000;

/** ERP customer that exists in the QA ERP and is used by the synthetic purchase orders. */
export const ERP_CUSTOMER = 'Office Furniture Solutions of Miami, LLC';

export interface LineItem {
  code: string;
  description: string;
  qty: number;
  unitPrice: number;
}

/** First SKU is unknown to the QA ERP (=> SalesOrder_partial), the other three exist. */
export const PO_LINE_ITEMS: LineItem[] = [
  { code: 'CD-P3422L-1-G', description: 'Executive Desk 34x22 Left', qty: 2, unitPrice: 270.0 },
  { code: 'CD-P22FF-G', description: 'File / File Pedestal Grey', qty: 1, unitPrice: 147.6 },
  { code: 'CD-P22BBF-G', description: 'Box / Box / File Pedestal Grey', qty: 1, unitPrice: 151.2 },
  { code: 'CD-P7224C-G', description: 'Credenza 72x24 Grey', qty: 2, unitPrice: 167.4 },
];

export const HEADERS = {
  salesOrderSummary: /ERP Sales Order Processing Summary/i,
  quoteSummary: /Quote Request Processing Summary/i,
  anyProcessingSummary: /Processing Summary/i,
  noAttachment: /No Attachment Found/i,
  tooManyAttachments: /Too Many Attachments/i,
  processFailed: /Document Process Failed/i,
  unreadable: /Attachment Couldn.t Be Read|Attachment Appears to Be Corrupted/i,
  alreadyProcessed: /Document Already Processed/i,
  alreadyInProcessing: /Document Already in Processing/i,
  typeMismatch: /Request Type Doesn.t Match Attachment/i,
  typeNotRecognised: /Request Type Not Recogni[sz]ed/i,
};

/** Documents-list status label shown for each reply status. */
export const UI_STATUS_FOR_REPLY_STATUS: Record<string, RegExp> = {
  SalesOrder_partial: /^Partially Success$/i,
  SalesOrder_created: /^Success$/i,
};

/** Alphanumeric correlation token (Gmail IMAP subject search matches whole words). */
export function newToken(label: string): string {
  const rand = Math.floor(Math.random() * 36 ** 4).toString(36).padStart(4, '0');
  return `RS${label}${Date.now().toString(36)}${rand}`.toUpperCase();
}

export function usDate(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`;
}

const money = (n: number) => n.toFixed(2);

// ---------------------------------------------------------------------------------------------
// Document builders (HTML rendered to PDF by a private headless Chromium)
// ---------------------------------------------------------------------------------------------

let pdfBrowser: Browser | undefined;
async function renderer(): Promise<Browser> {
  // page.pdf() only works headless, so this is independent of the HEADLESS setting used for UI tests.
  pdfBrowser ??= await chromium.launch({ headless: true });
  return pdfBrowser;
}
export async function closeRenderer(): Promise<void> {
  await pdfBrowser?.close();
  pdfBrowser = undefined;
}

async function renderPdf(html: string, outFile: string): Promise<void> {
  const page = await (await renderer()).newPage();
  try {
    await page.setContent(html);
    await page.pdf({ path: outFile, format: 'A4', margin: { top: '20px', bottom: '20px' } });
  } finally {
    await page.close();
  }
}

const DOC_STYLE = `body{font-family:Arial,sans-serif;font-size:13px;color:#222;margin:30px}
.title{font-size:24px;font-weight:bold}.box{border:1px solid #ccc;padding:12px;margin:12px 0}
table{width:100%;border-collapse:collapse;margin-top:15px}th,td{border:1px solid #ddd;padding:8px;text-align:left}
th{background:#f2f6fc}.r{text-align:right}`;

function itemsTable(items: LineItem[]): string {
  const rows = items
    .map(
      (it, i) =>
        `<tr><td>${i + 1}</td><td>${it.code}</td><td>${it.description}</td><td class="r">${it.qty}</td>` +
        `<td class="r">${money(it.unitPrice)}</td><td class="r">${money(it.qty * it.unitPrice)}</td></tr>`,
    )
    .join('');
  const total = items.reduce((s, it) => s + it.qty * it.unitPrice, 0);
  return `<table><thead><tr><th>Line #</th><th>Product Code</th><th>Description</th><th class="r">Qty</th>
<th class="r">Unit Price ($)</th><th class="r">Total Amount ($)</th></tr></thead><tbody>${rows}
<tr><td colspan="5" class="r"><b>Total Order Value:</b></td><td class="r"><b>$${money(total)}</b></td></tr></tbody></table>`;
}

export interface BuiltFile {
  path: string;
  fileName: string;
  /** PO / quote number printed in the document (= token) */
  number: string;
  date: string;
}

export const asAttachment = (f: { path: string; fileName: string }, contentType?: string): EmailAttachment => ({
  filename: f.fileName,
  path: f.path,
  contentType,
});

export function fileDateSuffix(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${pad(d.getDate())}-${months[d.getMonth()]}-${d.getFullYear()}`;
}

/** Synthetic purchase order for ERP_CUSTOMER. `withCustomer: false` leaves every customer name out of the document. */
export async function buildPurchaseOrderPdf(
  testInfo: TestInfo,
  token: string,
  opts: { withCustomer?: boolean; suffix?: string } = {},
): Promise<BuiltFile> {
  const withCustomer = opts.withCustomer ?? true;
  const date = usDate();
  const dateStamp = fileDateSuffix();
  const fileName = `AUTO_PO_${token}_${dateStamp}${opts.suffix ?? ''}.pdf`;
  const shipTo = withCustomer
    ? `<div>${ERP_CUSTOMER}</div><div>1234 Biscayne Blvd, Miami, FL 33132</div><div>Attn: Receiving Dept</div>`
    : `<div>1234 Biscayne Blvd, Miami, FL 33132</div><div>Attn: Receiving Dept</div>`;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${DOC_STYLE}</style></head><body>
<div class="title">PURCHASE ORDER</div>
${withCustomer ? `<div>${ERP_CUSTOMER}</div>` : ''}
<p><b>PO Number:</b> ${token}<br><b>Date:</b> ${date}</p>
<div class="box"><b>Vendor / Supplier:</b><div>Corp Design Furniture</div><div>Riverstone Organization</div></div>
<div class="box"><b>Ship To:</b>${shipTo}</div>
${itemsTable(PO_LINE_ITEMS)}</body></html>`;
  const out = testInfo.outputPath(fileName);
  await renderPdf(html, out);
  return { path: out, fileName, number: token, date };
}

/** Synthetic sales quotation / estimate request for ERP_CUSTOMER. */
export async function buildQuotationPdf(testInfo: TestInfo, token: string): Promise<BuiltFile> {
  const date = usDate();
  const dateStamp = fileDateSuffix();
  const fileName = `AUTO_Quote_${token}_${dateStamp}.pdf`;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${DOC_STYLE}</style></head><body>
<div class="title">QUOTATION / ESTIMATE REQUEST</div>
<p><b>Quote Number:</b> ${token}<br><b>Date:</b> ${date}<br><b>Valid Until:</b> 30 days</p>
<div class="box"><b>Prepared For (Customer):</b><div>${ERP_CUSTOMER}</div><div>1234 Biscayne Blvd, Miami, FL 33132</div></div>
<div class="box"><b>Project:</b> AUTO Email Quote ${token}</div>
<div class="box"><b>Quoted By:</b> Corp Design Furniture</div>
${itemsTable(PO_LINE_ITEMS.slice(1))}</body></html>`;
  const out = testInfo.outputPath(fileName);
  await renderPdf(html, out);
  return { path: out, fileName, number: token, date };
}

/** A readable PDF that is not a business document (no customer, no order, no line items). */
export async function buildNonBusinessPdf(testInfo: TestInfo, token: string): Promise<BuiltFile> {
  const dateStamp = fileDateSuffix();
  const fileName = `AUTO_Notes_${token}_${dateStamp}.pdf`;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${DOC_STYLE}</style></head><body>
<div class="title">Team lunch menu</div>
<p>Reference ${token}. Monday: vegetable soup. Tuesday: pasta. Wednesday: salad bar. Thursday: curry. Friday: pizza.</p>
<p>Please tell the office manager about any allergies before Friday.</p></body></html>`;
  const out = testInfo.outputPath(fileName);
  await renderPdf(html, out);
  return { path: out, fileName, number: token, date: usDate() };
}

/** A PNG image saved with a .pdf extension (unreadable as a PDF). */
export async function buildImageDisguisedAsPdf(testInfo: TestInfo, token: string): Promise<BuiltFile> {
  const page = await (await renderer()).newPage({ viewport: { width: 600, height: 400 } });
  let png: Buffer;
  try {
    await page.setContent(`<div style="font:28px Arial;padding:40px">PURCHASE ORDER ${token} (image)</div>`);
    png = await page.screenshot();
  } finally {
    await page.close();
  }
  const dateStamp = fileDateSuffix();
  const fileName = `AUTO_Scan_${token}_${dateStamp}.pdf`;
  const out = testInfo.outputPath(fileName);
  fs.writeFileSync(out, png);
  return { path: out, fileName, number: token, date: usDate() };
}

/** A plain-text attachment (.txt is not a supported ingestion format). */
export function buildTextFile(testInfo: TestInfo, token: string): BuiltFile {
  const dateStamp = fileDateSuffix();
  const fileName = `AUTO_Order_${token}_${dateStamp}.txt`;
  const out = testInfo.outputPath(fileName);
  fs.writeFileSync(
    out,
    `PURCHASE ORDER ${token}\nCustomer: ${ERP_CUSTOMER}\n` +
      PO_LINE_ITEMS.map((it) => `${it.code}  ${it.description}  ${it.qty} x ${money(it.unitPrice)}`).join('\n'),
  );
  return { path: out, fileName, number: token, date: usDate() };
}

// ---------------------------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------------------------

export async function attachReply(testInfo: TestInfo, label: string, reply: RetrievedEmail): Promise<void> {
  const summary = {
    subject: reply.subject,
    from: reply.from,
    to: reply.to,
    receivedAt: reply.receivedAt,
    messageId: reply.messageId,
    inReplyTo: reply.inReplyTo,
    mailbox: reply.mailbox,
    fields: reply.fields,
  };
  await testInfo.attach(`${label}.json`, { body: JSON.stringify(summary, null, 2), contentType: 'application/json' });
  if (reply.html) await testInfo.attach(`${label}.html`, { body: reply.html, contentType: 'text/html' });
}

// ---------------------------------------------------------------------------------------------
// Shared "valid purchase order" submission
// ---------------------------------------------------------------------------------------------

/**
 * Several cases only OBSERVE different facets of one valid-PO email (reply fields, subject, recipient,
 * latency, Documents list, duplicate replies, ...). To keep the number of emails per run small they
 * share one submission per Playwright run: the first worker that needs it sends it; the others read the
 * result from a file keyed by the runner process id. A test run on its own still sends its own email.
 */
export interface BaselineSubmission {
  token: string;
  subject: string;
  po: BuiltFile;
  sent: SentEmail;
  reply: RetrievedEmail;
}

interface BaselineRecord {
  state: 'pending' | 'done' | 'error';
  startedAt: number;
  error?: string;
  value?: BaselineSubmission;
}

const baselineFile = () => path.join(os.tmpdir(), `riverstream-email-baseline-${process.ppid}.json`);
const reviveDates = (_k: string, v: unknown) =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(v) ? new Date(v) : v;

export async function getBaselineSubmission(mail: MailService, testInfo: TestInfo): Promise<BaselineSubmission> {
  const file = baselineFile();
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, 'wx'); // exclusive: this worker owns the submission
  } catch {
    fd = undefined;
  }

  if (fd !== undefined) {
    fs.writeSync(fd, JSON.stringify({ state: 'pending', startedAt: Date.now() } satisfies BaselineRecord));
    fs.closeSync(fd);
    try {
      const token = newToken('BASE');
      // Neutral subject and empty body: no document-type keyword (TC_RS_EM_006).
      const subject = `AUTO email ingestion ${token}`;
      const po = await buildPurchaseOrderPdf(testInfo, token);
      const sent = await mail.sendEmail({ subject, attachments: [asAttachment(po, 'application/pdf')] });
      const reply = await mail.waitForReply({ token, since: sent.sentAt, timeoutMs: REPLY_WAIT_MS });
      const value: BaselineSubmission = { token, subject, po, sent, reply };
      fs.writeFileSync(file, JSON.stringify({ state: 'done', startedAt: Date.now(), value } satisfies BaselineRecord));
      return value;
    } catch (err) {
      fs.writeFileSync(
        file,
        JSON.stringify({ state: 'error', startedAt: Date.now(), error: (err as Error).message } satisfies BaselineRecord),
      );
      throw err;
    }
  }

  // Another worker is (or was) sending it: wait for its result.
  const giveUpAt = Date.now() + REPLY_WAIT_MS + 120_000;
  for (;;) {
    const rec = JSON.parse(fs.readFileSync(file, 'utf8'), reviveDates) as BaselineRecord;
    if (rec.state === 'done' && rec.value) return rec.value;
    if (rec.state === 'error') throw new Error(`Shared valid-PO submission failed: ${rec.error}`);
    if (Date.now() > giveUpAt || Date.now() - rec.startedAt > REPLY_WAIT_MS + 180_000) {
      throw new Error('Shared valid-PO submission did not complete (owning worker stopped).');
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
}
