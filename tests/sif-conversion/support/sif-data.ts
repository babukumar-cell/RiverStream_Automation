import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { APIRequestContext, APIResponse, Page, TestInfo, request } from '@playwright/test';
import { test, expect } from '../../../src/fixtures/test.fixture';
import { Config } from '../../../src/config/environment';
import { SifDocType } from '../../../src/pages/sif-conversion.page';

/*
 * Test data for the SIF Conversion suite (Test Cases/Module_Wise_Test_Cases/10_SIF_Conversion.xlsx).
 *
 * The suite works on its own PDFs, generated with known values and uploaded by the user of the organization
 * Testing (divya.d@riverstonetech.com). Their names start with AUTO_SIF_<run> and they are deleted after the run.
 * PO, QR, CONV and ACT are uploaded through the API before the first case; the others through the page by their case.
 *   PO    Purchase Order (Default PO): Review page cases, edits, Save, Convert, Download SIF
 *   QR    Quote Request (Default QR): filters, Review button / menu, Delete > Cancel
 *   CONV  Purchase Order, converted during setup: Download SIF from the list, green badge
 *   ACT   Purchase Order: Re-run extraction, Download original PDF, Delete
 *   UP1 / UP2 / UP3 / DND / 25MB  files of the upload cases;  BAD  corrupted PDF (Failed)
 */

const runId = (process.env.RS_RUN_ID ?? String(Date.now())).slice(-8);
export const RUN = runId;
export const TOKEN = `AUTO_SIF_${runId}`;

export interface SifLine {
  partNumber: string;
  description: string;
  qty: number;
  price: number;
}

export interface SifDoc {
  key: string;
  fileName: string;
  docType: SifDocType;
  template: string;
  /** PO number (Purchase Order) / quote number */
  number: string;
  project: string;
  lines: SifLine[];
}

const PO_LINES: SifLine[] = [
  { partNumber: 'CD-P22FF-G', description: 'File / File Pedestal Grey', qty: 1, price: 147.6 },
  { partNumber: 'CD-P22BBF-G', description: 'Box / Box / File Pedestal Grey', qty: 2, price: 151.2 },
  { partNumber: 'CD-P7224C-G', description: 'Credenza 72x24 Grey', qty: 3, price: 167.4 },
];
const QR_LINES: SifLine[] = [
  { partNumber: 'CD-309GB', description: 'Zatto Guest Chair Black', qty: 6, price: 202.5 },
  { partNumber: 'CD-9542CT-G', description: 'Deluxe Conference Table Grey', qty: 1, price: 567 },
];

export function doc(key: string): SifDoc {
  const isQuote = key === 'QR' || key === 'BAD';
  return {
    key,
    fileName: `${TOKEN}_${key}.pdf`,
    docType: isQuote ? 'Quote Request' : 'Purchase Order',
    template: isQuote ? 'Default QR' : 'Default PO',
    number: `${key}${runId}`,
    project: `Automation Project ${key} ${runId}`,
    lines: isQuote ? QR_LINES : PO_LINES,
  };
}

// ---------------------------------------------------------------------------------------------
// PDF files
// ---------------------------------------------------------------------------------------------

const money = (n: number) => n.toFixed(2);

function docHtml(d: SifDoc): string {
  const title = d.docType === 'Quote Request' ? 'QUOTE REQUEST' : 'PURCHASE ORDER';
  const numLabel = d.docType === 'Quote Request' ? 'Quote Number' : 'PO Number';
  const rows = d.lines
    .map((l, i) => `<tr><td>${i + 1}</td><td>${l.partNumber}</td><td>${l.description}</td><td>${l.qty}</td><td>${money(l.price)}</td><td>${money(l.qty * l.price)}</td></tr>`)
    .join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;font-size:13px;margin:30px}
table{border-collapse:collapse;width:100%;margin-top:14px}th,td{border:1px solid #999;padding:6px;text-align:left}</style></head><body>
<h1>${title}</h1><p><b>${numLabel}:</b> ${d.number}<br><b>Project:</b> ${d.project}<br><b>Date:</b> 11/12/2026</p>
<p><b>Vendor:</b> Corp Design Furniture</p><p><b>Ship To:</b> OFS Miami Warehouse, 7800 NW 25th St, Doral, FL 33122</p>
<table><tr><th>Line</th><th>Part Number</th><th>Description</th><th>Qty</th><th>Unit Price</th><th>Amount</th></tr>${rows}</table></body></html>`;
}

const RENDER_WORKER = path.resolve(__dirname, '../../email/support/render-worker.cjs');
const execFileAsync = promisify(execFile);
const FILES_DIR = path.join(os.tmpdir(), `riverstream-sif-${runId}`);

/** Generated PDF of the document `key` (rendered once per run) */
export async function pdfFile(key: string): Promise<string> {
  fs.mkdirSync(FILES_DIR, { recursive: true });
  const d = doc(key);
  const out = path.join(FILES_DIR, d.fileName);
  if (fs.existsSync(out)) return out;
  if (key === 'BAD') {
    fs.writeFileSync(out, '%PDF-1.4\nthis is not a readable pdf body\n');
    return out;
  }
  if (key === '25MB') {
    const base = await pdfFile('UP1');
    const bytes = fs.readFileSync(base);
    const size = 25 * 1024 * 1024;
    // a valid PDF followed by a comment line padded to exactly 25 MB
    fs.writeFileSync(out, Buffer.concat([bytes, Buffer.from('\n%'), Buffer.alloc(size - bytes.length - 2, 0x20)]));
    return out;
  }
  const job = `${out}.job.json`;
  fs.writeFileSync(job, JSON.stringify({ html: docHtml(d), out, kind: 'pdf' }));
  try {
    await execFileAsync(process.execPath, [RENDER_WORKER, job], { timeout: 90_000 });
  } finally {
    fs.rmSync(job, { force: true });
  }
  return out;
}

/** Files the upload page must reject */
export function invalidFile(kind: 'docx' | 'jpg' | 'empty' | '30MB'): string {
  fs.mkdirSync(FILES_DIR, { recursive: true });
  const names = { docx: 'not-a-pdf.docx', jpg: 'picture.jpg', empty: 'empty.pdf', '30MB': 'big-30MB.pdf' } as const;
  const out = path.join(FILES_DIR, names[kind]);
  if (fs.existsSync(out)) return out;
  if (kind === 'docx') fs.writeFileSync(out, Buffer.from('PK\x03\x04 not really a docx'));
  if (kind === 'jpg') fs.writeFileSync(out, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]));
  if (kind === 'empty') fs.writeFileSync(out, Buffer.alloc(0));
  if (kind === '30MB') fs.writeFileSync(out, Buffer.concat([Buffer.from('%PDF-1.4\n%'), Buffer.alloc(30 * 1024 * 1024, 0x20)]));
  return out;
}

// ---------------------------------------------------------------------------------------------
// Run state (file: Playwright starts a new worker after a failed test)
// ---------------------------------------------------------------------------------------------

interface RunState {
  ids?: Record<string, string>;
  setupDone?: boolean;
  poSaved?: boolean;
  poConverted?: boolean;
  poSif?: string;
  actDeleted?: boolean;
  up3Uploaded?: boolean;
  badUploaded?: boolean;
  orgToggledOff?: boolean;
  orgUrl?: string;
  finishing?: boolean;
}

const STATE_FILE = path.join(os.tmpdir(), `riverstream-sif-${runId}.json`);
const readState = (): Record<string, unknown> => {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
};
export const state = new Proxy({} as RunState, {
  get: (_t, key: string) => readState()[key],
  set: (_t, key: string, value) => {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ ...readState(), [key]: value }, null, 2));
    return true;
  },
});

export function requires(value: unknown, what: string): void {
  test.skip(!value, `Not run: needs ${what}, which did not complete in this run.`);
}

// ---------------------------------------------------------------------------------------------
// Users: the suite runs as a user of the organization Testing; the Super Admin only switches Testing's
// SIF Conversion setting (TC_SIF_079) and makes sure it is ON at the start and at the end of a run
// ---------------------------------------------------------------------------------------------

export const TOGGLE_ORG = 'Testing';
export const ORG_USER = {
  email: process.env.SIF_USER_EMAIL || 'divya.d@riverstonetech.com',
  password: process.env.SIF_USER_PASSWORD || 'River@123',
  /** name shown in the app (Uploaded by, header) */
  name: process.env.SIF_USER_NAME || 'Divya',
};
/** Session of ORG_USER, saved by tests/sif-conversion/sif-user.setup.ts */
export const SIF_USER_STATE = path.resolve(__dirname, '../../../.auth/sif-user.json');

type SavedSession = { cookies: { name: string; value: string }[] };
const readSession = (file: string): SavedSession => JSON.parse(fs.readFileSync(file, 'utf8')) as SavedSession;
const cookie = (s: SavedSession, name: string) => decodeURIComponent(s.cookies.find((c) => c.name === name)?.value ?? '');

/** orgId of the Testing organization (from the user's session) */
export function testingOrgId(): string {
  const info = JSON.parse(cookie(readSession(SIF_USER_STATE), 'userInfo') || '{}') as { orgId?: string };
  expect(info.orgId, `${ORG_USER.email} session has an organization`).toBeTruthy();
  return info.orgId!;
}

/** API client of the Testing user (default) or of the Super Admin */
export async function sifApi(as: 'user' | 'superAdmin' = 'user'): Promise<APIRequestContext> {
  const token = cookie(readSession(as === 'user' ? SIF_USER_STATE : Config.adminStorageState), 'userToken');
  expect(token, `${as} session token`).toBeTruthy();
  return request.newContext({ baseURL: Config.apiBaseUrl, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
}

/** Signs the page in as the Super Admin (cookies of the session saved by tests/auth.setup.ts) */
export async function asSuperAdmin(page: Page): Promise<void> {
  await page.context().clearCookies();
  await page.context().addCookies(JSON.parse(fs.readFileSync(Config.adminStorageState, 'utf8')).cookies);
}

const API_TYPE: Record<SifDocType, { documentType: string; templateId: string }> = {
  'Purchase Order': { documentType: 'purchase_order', templateId: 'system_default_purchase_order' },
  'Quote Request': { documentType: 'quote_request', templateId: 'system_default_quote_request' },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ok(res: APIResponse, what: string): Promise<any> {
  expect(res.status(), `${what}: ${(await res.text()).slice(0, 200)}`).toBe(200);
  return res.json();
}

async function apiUpload(api: APIRequestContext, key: string): Promise<string> {
  const d = doc(key);
  const body = { fileName: d.fileName, fileBase64: fs.readFileSync(await pdfFile(key)).toString('base64'), ...API_TYPE[d.docType] };
  return (await ok(await api.post('sifConversionUpload', { data: body }), `upload ${d.fileName}`)).id as string;
}

async function apiStatus(api: APIRequestContext, id: string): Promise<string> {
  return (await ok(await api.get(`getSifConversion/${id}`), 'getSifConversion')).conversion.conversionStatus as string;
}

/** SIF Conversion setting of an organization (Super Admin API) */
export async function orgSifEnabled(orgId: string): Promise<boolean> {
  const api = await sifApi('superAdmin');
  try {
    return (await ok(await api.get(`getOrganization/${orgId}`), 'getOrganization')).settings?.sifConversionEnabled === true;
  } finally {
    await api.dispose();
  }
}

/** SIF Conversion setting of every organization except Testing (Super Admin API): must not change in TC_SIF_079 */
export async function otherOrgsSif(): Promise<Record<string, boolean>> {
  const api = await sifApi('superAdmin');
  try {
    const listed = await ok(await api.post('superAdminListOrganizations', { data: { startIndex: 0, pageSize: 200, search_text: null } }), 'superAdminListOrganizations');
    // the list has no SIF setting: read each organization
    const orgs = (listed.organizations as { orgId: string; name: string }[]).filter((o) => o.orgId !== testingOrgId());
    const out: Record<string, boolean> = {};
    for (const o of orgs) {
      const org = await ok(await api.get(`getOrganization/${o.orgId}`), `getOrganization ${o.orgId}`);
      out[`${o.name} (${o.orgId})`] = org.settings?.sifConversionEnabled === true;
    }
    return out;
  } finally {
    await api.dispose();
  }
}

/** Turns Testing's SIF Conversion ON through the API (only that setting is sent) and checks it */
export async function ensureTestingSifOn(): Promise<void> {
  const orgId = testingOrgId();
  if (await orgSifEnabled(orgId)) return;
  const api = await sifApi('superAdmin');
  try {
    await ok(await api.put(`updateOrganization/${orgId}`, { data: { 'settings.sifConversionEnabled': true } }), 'updateOrganization');
  } finally {
    await api.dispose();
  }
  expect(await orgSifEnabled(orgId), `${TOGGLE_ORG} (${orgId}): SIF Conversion is ON`).toBe(true);
}

/** Testing's SIF Conversion ON, then the suite's documents PO, QR, CONV, ACT uploaded (once per run) and CONV converted */
export async function ensureSetup(): Promise<void> {
  await ensureTestingSifOn();
  if (state.setupDone) return;
  const api = await sifApi();
  try {
    const ids = { ...(state.ids ?? {}) };
    for (const key of ['PO', 'QR', 'CONV', 'ACT']) {
      if (!ids[key]) {
        ids[key] = await apiUpload(api, key);
        state.ids = ids;
      }
    }
    for (const key of Object.keys(ids)) {
      await expect
        .poll(() => apiStatus(api, ids[key]), { message: `${doc(key).fileName} extracted`, timeout: 240_000, intervals: [3000, 5000] })
        .toMatch(/^(ready_for_review|converted)$/);
    }
    if ((await apiStatus(api, ids.CONV)) !== 'converted') await ok(await api.post(`convertToSif/${ids.CONV}`, { data: {} }), 'convertToSif');
    expect(await apiStatus(api, ids.CONV)).toBe('converted');
    state.setupDone = true;
  } finally {
    await api.dispose();
  }
}

/** Names of the SIF templates available to the organization Testing */
export async function sifTemplateNames(documentType?: 'purchase_order' | 'quote_request'): Promise<string[]> {
  const api = await sifApi();
  try {
    const listed = await ok(await api.get(`listSifTemplates${documentType ? `?documentType=${documentType}` : ''}`), 'listSifTemplates');
    return (listed.templates as { name: string }[]).map((t) => t.name);
  } finally {
    await api.dispose();
  }
}

/** A custom (non-default) template of the document type; fails if the organization has none */
export async function customTemplate(type: SifDocType): Promise<string> {
  const api = await sifApi();
  try {
    const listed = await ok(await api.get(`listSifTemplates?documentType=${API_TYPE[type].documentType}`), 'listSifTemplates');
    const custom = (listed.templates as { name: string; isDefault?: boolean }[]).find((t) => !t.isDefault)?.name;
    expect(custom, `a custom ${type} template is available to the organization ${TOGGLE_ORG} (e.g. New Template)`).toBeTruthy();
    return custom!;
  } finally {
    await api.dispose();
  }
}

// ---------------------------------------------------------------------------------------------
// Organization setting "SIF Conversion" (TC_SIF_079)
// ---------------------------------------------------------------------------------------------

/** SIF Conversion switch on the organization details page */
export function sifSwitch(page: Page) {
  return page.locator('div.rounded-lg').filter({ hasText: /^SIF ConversionLet this organization/ }).getByRole('switch');
}

/** Turns the SIF Conversion setting of the organization on/off on its details page (Super Admin) */
export async function setOrgSif(page: Page, orgUrl: string, on: boolean): Promise<void> {
  await page.goto(orgUrl);
  await expect(sifSwitch(page)).toBeVisible({ timeout: 30000 });
  if ((await sifSwitch(page).getAttribute('aria-checked')) === String(on)) return;
  // the organization's Edit button (header, first on the page); user rows have Edit buttons too
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await sifSwitch(page).click();
  const saved = page.waitForResponse((r) => /\/api\/updateOrganization\//.test(r.url()) && r.request().method() === 'PUT');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const res = await saved;
  expect(res.status(), 'updateOrganization API status').toBe(200);
  expect(res.request().postData() ?? '', 'saved setting').toContain(`"settings.sifConversionEnabled":${on}`);
  await expect(sifSwitch(page)).toHaveAttribute('aria-checked', String(on));
}

// ---------------------------------------------------------------------------------------------
// Cleanup (afterAll): Testing's SIF Conversion back ON (always), then the suite's files
// ---------------------------------------------------------------------------------------------

export async function cleanup(): Promise<void> {
  try {
    await ensureTestingSifOn();
    state.orgToggledOff = false;
    if (!state.finishing) return; // a worker ended after a failed test: later steps still need the files
    const api = await sifApi();
    try {
      const body = { startIndex: 0, pageSize: 100, search_text: TOKEN, documentType: null, status: null, templateId: null, mine: false };
      const listed = await ok(await api.post('listSifConversions', { data: body }), 'listSifConversions');
      const files = (listed.conversions.entities as { _id: string; fileName: string }[]).filter((f) => f.fileName.startsWith(TOKEN));
      for (const f of files) await ok(await api.delete(`deleteSifConversion/${f._id}`), `delete ${f.fileName}`);
      console.log(`[sif] cleanup: deleted ${files.length} ${TOKEN} files`);
    } finally {
      await api.dispose();
    }
  } catch (err) {
    console.warn(`[sif] cleanup failed (check that ${TOGGLE_ORG}'s SIF Conversion is ON and delete the ${TOKEN} files): ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Evidence helpers
// ---------------------------------------------------------------------------------------------

export async function attachEvidence(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const file = testInfo.outputPath(`${name.replace(/[^\w-]+/g, '_')}.png`);
  await page.screenshot({ path: file });
  await testInfo.attach(name, { path: file, contentType: 'image/png' });
}

/** "P1=X\r\nPN=..." -> [["P1","X"], ["PN", ...]] */
export function parseSif(text: string): [string, string][] {
  return text
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)] as [string, string]);
}

/** Shows a SIF file's content in the page with one line per key, so the screenshot shows the checked values */
export async function showSif(page: Page, fileName: string, text: string): Promise<void> {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const lines = parseSif(text).map(([k, v]) => `<div class="sif-line" data-key="${esc(k)}"><b>${esc(k)}</b>=<span>${esc(v)}</span></div>`).join('');
  await page.setContent(
    `<body style="font:14px Consolas,monospace;background:#f3f4f6;margin:0;padding:20px"><h3 style="font-family:Arial">${esc(fileName)}</h3>` +
      `<div style="background:#fff;border:1px solid #d1d5db;border-radius:8px;padding:12px 16px;line-height:1.7">${lines}</div></body>`,
  );
}

export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
