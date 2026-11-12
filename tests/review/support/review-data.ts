import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { Page, TestInfo, expect } from '@playwright/test';
import { UploadPage } from '../../../src/pages/upload.page';
import { ReviewDocument, ReviewPage } from '../../../src/pages/review.page';

/*
 * Test data for the Document Review suite.
 *
 * The suite reviews its own documents, uploaded once per test run (shared by all tests and retries of the run):
 *   main     - 2-page PO, 3 line items, billing and shipping addresses (viewer, fields, line items)
 *   single   - same PO with a single line item (deleting the only row)
 *   erp      - 2-page PO for an ERP customer; Complete + Submit to ERP are only done on this one
 *   nomatch  - PO for a customer that is not a configured client ("ABC Furniture")
 * The POs are generated as PDFs (HTML rendered by tests/email/support/render-worker.cjs) so every value is known.
 * Edits made on the review page stay in the browser until "Complete", so only the erp document is ever changed.
 */

/** Customer that exists in the QA ERP (Submit to ERP succeeds for it). */
export const ERP_CUSTOMER = 'Office Furniture Solutions of Miami, LLC';
export const VENDOR = 'Corp Design Furniture';

export interface PoLine {
  code: string;
  description: string;
  qty: number;
  unitPrice: number;
}

/** SKUs that exist in the QA ERP */
export const LINES: PoLine[] = [
  { code: 'CD-P22FF-G', description: 'File / File Pedestal Grey', qty: 1, unitPrice: 147.6 },
  { code: 'CD-P22BBF-G', description: 'Box / Box / File Pedestal Grey', qty: 1, unitPrice: 151.2 },
  { code: 'CD-P7224C-G', description: 'Credenza 72x24 Grey', qty: 2, unitPrice: 167.4 },
];

export interface ReviewPo {
  /** File name uploaded (unique per run) */
  fileName: string;
  poNumber: string;
  date: string;
  customer: string;
  billingName: string;
  billingAddress: string[];
  shippingName: string;
  shippingAddress: string[];
  lines: PoLine[];
  /** "$633.60" */
  total: string;
}

export const DOCS = {
  main: { lines: 3, customer: ERP_CUSTOMER },
  single: { lines: 1, customer: ERP_CUSTOMER },
  erp: { lines: 3, customer: ERP_CUSTOMER },
  nomatch: { lines: 2, customer: 'ABC Furniture' },
} as const;
export type DocKey = keyof typeof DOCS;

export const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function usDate(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`;
}

const runId = () => process.env.RS_RUN_ID ?? String(process.ppid);

/** The document `key` of this run (values printed in the PDF). */
export function reviewPo(key: DocKey): ReviewPo {
  const spec = DOCS[key];
  const token = `RVW${runId().slice(-8)}${key.slice(0, 1).toUpperCase()}`;
  const lines = LINES.slice(0, spec.lines);
  const total = lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  return {
    fileName: `AUTO_REVIEW_${token}.pdf`,
    poNumber: token,
    // RS_RUN_ID is the run's start time (ms); the date printed in the PO is that day
    date: usDate(/^\d{13}$/.test(runId()) ? new Date(Number(runId())) : new Date()),
    customer: spec.customer,
    billingName: spec.customer,
    billingAddress: ['1234 Biscayne Blvd', 'Miami, FL 33132'],
    shippingName: 'OFS Miami Warehouse',
    shippingAddress: ['7800 NW 25th St', 'Doral, FL 33122'],
    lines,
    total: `$${money(total)}`,
  };
}

function poHtml(po: ReviewPo): string {
  const rows = po.lines
    .map(
      (l, i) =>
        `<tr><td>${i + 1}</td><td>${l.code}</td><td>${l.description}</td><td class="r">${l.qty}</td>` +
        `<td class="r">${money(l.unitPrice)}</td><td class="r">${money(l.qty * l.unitPrice)}</td></tr>`,
    )
    .join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;font-size:13px;color:#222;margin:30px}
.title{font-size:24px;font-weight:bold}.box{border:1px solid #ccc;padding:12px;margin:12px 0}.cols{display:flex;gap:16px}.cols .box{flex:1}
table{width:100%;border-collapse:collapse;margin-top:15px}th,td{border:1px solid #ddd;padding:8px;text-align:left}th{background:#f2f6fc}.r{text-align:right}
.break{page-break-before:always}</style></head><body>
<div class="title">PURCHASE ORDER</div>
<div>${po.customer}</div>
<p><b>PO Number:</b> ${po.poNumber}<br><b>Date:</b> ${po.date}</p>
<div class="box"><b>Vendor / Supplier:</b><div>${VENDOR}</div><div>Riverstone Organization</div></div>
<div class="cols">
<div class="box"><b>Bill To:</b><div>${po.billingName}</div>${po.billingAddress.map((l) => `<div>${l}</div>`).join('')}</div>
<div class="box"><b>Ship To:</b><div>${po.shippingName}</div>${po.shippingAddress.map((l) => `<div>${l}</div>`).join('')}</div>
</div>
<table><thead><tr><th>Line #</th><th>Product Code</th><th>Description</th><th class="r">Qty</th><th class="r">Unit Price ($)</th><th class="r">Amount ($)</th></tr></thead><tbody>${rows}</tbody></table>
<div class="break"></div>
<div class="title">ORDER SUMMARY</div>
<p>PO Number: ${po.poNumber}</p>
<table><tbody><tr><td>Subtotal</td><td class="r">${po.total}</td></tr><tr><td><b>Total Order Value</b></td><td class="r"><b>${po.total}</b></td></tr></tbody></table>
<p>Terms: Net 30. Please confirm receipt of this purchase order.</p>
</body></html>`;
}

// Rendering runs in a separate process: a browser opened in the test worker would add its page to the report
const RENDER_WORKER = path.resolve(__dirname, '../../email/support/render-worker.cjs');
const execFileAsync = promisify(execFile);

async function renderPdf(html: string, out: string): Promise<void> {
  const jobFile = `${out}.job.json`;
  fs.writeFileSync(jobFile, JSON.stringify({ html, out, kind: 'pdf' }));
  try {
    await execFileAsync(process.execPath, [RENDER_WORKER, jobFile], { timeout: 90_000 });
  } finally {
    fs.rmSync(jobFile, { force: true });
  }
}

// ---------------------------------------------------------------------------------------------
// Per-run state: uploaded document ids
// ---------------------------------------------------------------------------------------------

type State = Partial<Record<DocKey, { id: string; fileName: string }>>;
const stateFile = () => path.join(os.tmpdir(), `riverstream-review-suite-${runId()}.json`);

function readState(): State {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), 'utf8')) as State;
  } catch {
    return {};
  }
}

function record(key: DocKey, id: string, fileName: string): void {
  const s = readState();
  s[key] = { id, fileName };
  fs.writeFileSync(stateFile(), JSON.stringify(s, null, 2));
}

/**
 * Uploads (through the Upload page) every document in `keys` that this run has not uploaded yet,
 * and returns the document ids. Extraction runs in the background; ReviewPage.open() waits for it.
 */
export async function ensureUploaded(page: Page, testInfo: TestInfo, keys: DocKey[] = Object.keys(DOCS) as DocKey[]): Promise<Record<DocKey, string>> {
  const upload = new UploadPage(page);
  for (const key of keys) {
    if (readState()[key]) continue;
    const po = reviewPo(key);
    const file = testInfo.outputPath(po.fileName);
    await renderPdf(poHtml(po), file);
    await upload.navigate('documents');
    const result = await upload.uploadDocument(file, 'Purchase Order', 'documents');
    const id = result.body?.table_entity?._id;
    expect(id, `uploadDocument returned the id of ${po.fileName}`).toBeTruthy();
    record(key, id, po.fileName);
  }
  const s = readState();
  return Object.fromEntries((Object.keys(DOCS) as DocKey[]).map((k) => [k, s[k]?.id])) as Record<DocKey, string>;
}

export function docId(key: DocKey): string {
  const id = readState()[key]?.id;
  expect(id, `document "${key}" was uploaded in this run`).toBeTruthy();
  return id!;
}

/** Opens the review page of this run's document `key` (waits for extraction). */
export async function openDoc(reviewPage: ReviewPage, key: DocKey, from: 'documents' | 'dashboard' = 'documents'): Promise<ReviewDocument> {
  return reviewPage.open(docId(key), from);
}

// ---------------------------------------------------------------------------------------------
// Assertion helpers shared by the review specs
// ---------------------------------------------------------------------------------------------

export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Address shown on a card: lines joined, commas optional ("1234 Biscayne Blvd Miami FL 33132") */
export const addressRe = (lines: string[]) => new RegExp(`^${lines.join(' ').split(/[\s,]+/).map(escapeRe).join('[\\s,]+')}$`);

export const LINE_COLUMNS = ['Product Code', 'Description', 'Qty', 'Unit Price', 'Amount', 'Page', 'Actions'];

/** A PO line as shown in the line-items table (without Page / Actions) */
export const lineValues = (l: PoLine) => [l.code, l.description, String(l.qty), money(l.unitPrice), money(l.qty * l.unitPrice)];

/** Adds a screenshot of the current page to the report, e.g. a button highlighted just before it is clicked. */
export async function attachEvidence(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const file = testInfo.outputPath(`${name.replace(/[^\w-]+/g, '_')}.png`);
  await page.screenshot({ path: file });
  await testInfo.attach(name, { path: file, contentType: 'image/png' });
}
