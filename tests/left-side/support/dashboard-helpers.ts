import fs from 'fs';
import { Page, Response, TestInfo } from '@playwright/test';
import { DashboardPage, DashboardStats, KpiName } from '../../../src/pages/dashboard.page';
import { DocumentsPage, LibraryDocument, LibraryPage } from '../../../src/pages/documents.page';
import { readXlsxRows } from '../../../src/utils/xlsx-reader';

// ---------------------------------------------------------------------------------------------
// KPI cards
// ---------------------------------------------------------------------------------------------

/** Count each KPI card shows for a /api/dashboard response (Total excludes failed extractions). */
export function expectedCardCounts(s: DashboardStats): Record<KpiName, number> {
  return {
    'Total Documents': s.processing + s.extracted + s.reviewed,
    'Pending Review': s.extracted,
    Processing: s.processing,
    Reviewed: s.reviewed,
  };
}

/** Status labels listed under each KPI card. */
export const CARD_STATUSES: Record<Exclude<KpiName, 'Total Documents'>, string[]> = {
  'Pending Review': ['Extracted'],
  Processing: ['Processing'],
  Reviewed: ['Success', 'Partially Success', 'Reviewed', 'Failed'],
};

/** Caption under the count on each card. */
export const CARD_CAPTIONS: Record<KpiName, RegExp> = {
  'Total Documents': /All-time total|vs last/i,
  'Pending Review': /Requires attention/i,
  Processing: /In progress/i,
  Reviewed: /Completed/i,
};

// ---------------------------------------------------------------------------------------------
// Capturing the dashboard's API responses
// ---------------------------------------------------------------------------------------------

const isStats = (r: Response) => /\/api\/dashboard(\?|$)/.test(r.url()) && r.request().method() === 'GET';

/** Query parameters of a /api/dashboard request. */
export const statsParams = (r: Response) => new URL(r.url()).searchParams;

/**
 * Runs `action` and returns the /api/dashboard response and/or first-page listDocumentsLibrary response it
 * triggers. `statsWhen` / `listWhen` select the right request (e.g. the one carrying the new filter).
 */
export async function capture(
  page: Page,
  action: () => Promise<unknown>,
  opts: {
    stats?: (params: URLSearchParams) => boolean;
    list?: (req: LibraryPage['request'] & Record<string, unknown>) => boolean;
  },
): Promise<{ stats?: DashboardStats; statsResponse?: Response; list?: LibraryPage }> {
  const statsP = opts.stats
    ? page.waitForResponse((r) => isStats(r) && r.ok() && opts.stats!(statsParams(r)), { timeout: 30_000 })
    : undefined;
  const listP = opts.list
    ? page.waitForResponse(
        (r) => DocumentsPage.isListRequest(r) && (r.request().postDataJSON()?.startIndex ?? 0) === 0 && opts.list!(r.request().postDataJSON() ?? {}),
        { timeout: 30_000 },
      )
    : undefined;
  await action();
  const statsResponse = await statsP;
  return {
    statsResponse,
    stats: statsResponse ? ((await statsResponse.json()) as DashboardStats) : undefined,
    list: listP ? await DocumentsPage.parseListResponse(await listP) : undefined,
  };
}

// ---------------------------------------------------------------------------------------------
// Dates (local time zone = the browser's)
// ---------------------------------------------------------------------------------------------

export const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const startOfDay = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** [from, before) of each date preset, as the dashboard computes them (weeks start on Monday). */
export function presetRange(preset: 'This week' | 'Last week' | 'This month' | 'Last month', now = new Date()): { from: Date; before: Date } {
  const today = startOfDay(now);
  const weekStart = addDays(today, -((today.getDay() + 6) % 7));
  switch (preset) {
    case 'This week':
      return { from: weekStart, before: addDays(today, 1) };
    case 'Last week':
      return { from: addDays(weekStart, -7), before: weekStart };
    case 'This month':
      return { from: new Date(today.getFullYear(), today.getMonth(), 1), before: addDays(today, 1) };
    case 'Last month':
      return { from: new Date(today.getFullYear(), today.getMonth() - 1, 1), before: new Date(today.getFullYear(), today.getMonth(), 1) };
  }
}

/** Day button name in the calendar, e.g. "November 3rd, 2026" (matches "Today, Thursday, November 5th, 2026" too). */
export function calendarDayName(d: Date): RegExp {
  const n = d.getDate();
  const suffix = n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th';
  const month = d.toLocaleDateString('en-US', { month: 'long' });
  return new RegExp(`${month} ${n}${suffix}, ${d.getFullYear()}$`);
}

/** Clicks a day in the open calendar, moving to its month first. */
export async function clickCalendarDay(dashboardPage: DashboardPage, d: Date): Promise<void> {
  const page = dashboardPage.page;
  const monthName = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  for (let i = 0; i < 24 && !(await page.getByRole('grid', { name: monthName }).isVisible()); i++) {
    const shownMonth = await page.getByRole('grid').first().getAttribute('aria-label');
    const shown = shownMonth ? new Date(`1 ${shownMonth}`) : new Date();
    await page.getByRole('button', { name: shown > d ? 'Go to the Previous Month' : 'Go to the Next Month' }).click();
  }
  await dashboardPage.calendarDay(calendarDayName(d)).click();
}

/** true when `iso` falls in [from, before). */
export const inRange = (iso: string, from: Date, before: Date) => {
  const t = new Date(iso).getTime();
  return t >= from.getTime() && t < before.getTime();
};

// ---------------------------------------------------------------------------------------------
// Exported reports
// ---------------------------------------------------------------------------------------------

export const EXPORT_COLUMNS = [
  'Document Name',
  'Customer',
  'Organization',
  'Uploaded By',
  'Uploader Email',
  'Uploaded From',
  'Upload Date',
  'Status',
] as const;
export type ExportColumn = (typeof EXPORT_COLUMNS)[number];

/** RFC-4180 CSV parser (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c !== ''));
}

export interface ExportedReport {
  fileName: string;
  path: string;
  header: string[];
  /** Data rows as objects keyed by header */
  records: Array<Record<string, string>>;
  /** The documents the export was built from (listDocumentsLibrary request issued by Export) */
  apiDocs: LibraryDocument[];
  /** Number in "Exports these N documents" */
  summaryCount: number;
}

/**
 * Opens the Export menu (waiting until its summary shows `expectedCount`, if given), downloads the report
 * and returns its rows together with the documents the app exported.
 */
export async function exportReport(
  dashboardPage: DashboardPage,
  testInfo: TestInfo,
  format: 'csv' | 'xlsx',
  expectedCount?: number,
): Promise<ExportedReport> {
  const page = dashboardPage.page;
  await dashboardPage.openExportMenu();
  if (expectedCount !== undefined) {
    await dashboardPage.exportSummary.filter({ hasText: `Exports these ${expectedCount} document` }).waitFor({ timeout: 20_000 });
  }
  const summaryCount = await dashboardPage.exportSummaryCount();
  const listP = page.waitForResponse(
    (r) => DocumentsPage.isListRequest(r) && r.request().postDataJSON()?.pageSize === summaryCount,
    { timeout: 60_000 },
  );
  const download = await dashboardPage.exportAs(format);
  const file = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(file);
  const apiDocs = (await DocumentsPage.parseListResponse(await listP)).documents;
  const rows = format === 'csv' ? parseCsv(fs.readFileSync(file, 'utf8')) : readXlsxRows(file);
  const [header, ...data] = rows;
  const records = data.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
  return { fileName: download.suggestedFilename(), path: file, header, records, apiDocs, summaryCount };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * Shows the first rows of an exported report as a table in the browser, so assertions on its cells are
 * highlighted in the screenshot. Each <td> carries data-col = column name.
 */
export async function showReport(page: Page, report: ExportedReport, note: string, maxRows = 15): Promise<void> {
  const head = report.header.map((h) => `<th>${esc(h)}</th>`).join('');
  const body = report.records
    .slice(0, maxRows)
    .map((r) => `<tr>${report.header.map((h) => `<td data-col="${esc(h)}">${esc(r[h])}</td>`).join('')}</tr>`)
    .join('');
  await page.setContent(
    `<body style="font:12px Arial,sans-serif;margin:16px;color:#111">` +
      `<h2 style="margin:0 0 4px 0;font-size:16px">Exported report: ${esc(report.fileName)}</h2>` +
      `<p style="margin:0 0 10px 0;color:#555">${esc(note)} &middot; ${report.records.length} rows (first ${Math.min(maxRows, report.records.length)} shown)</p>` +
      // Fixed layout + wrapping: every column fits the window (no column is cut off on the right)
      `<table style="border-collapse:collapse;width:100%;table-layout:fixed"><thead style="background:#eef2f7">${head}</thead><tbody>${body}</tbody></table>` +
      `<style>th,td{border:1px solid #d1d5db;padding:5px 6px;text-align:left;vertical-align:top;overflow-wrap:anywhere}</style></body>`,
  );
}

/** Cells of one column in the report table shown by showReport. */
export const reportColumn = (page: Page, column: ExportColumn) => page.locator(`td[data-col="${column}"]`);

/** Scrolls the report so the checked column (header and first rows) is on screen for the screenshot. */
export async function revealColumn(page: Page, column: ExportColumn): Promise<void> {
  await page.locator('thead th', { hasText: new RegExp(`^${column}$`) }).scrollIntoViewIfNeeded();
  await reportColumn(page, column).first().scrollIntoViewIfNeeded();
}

/** Customer text the app shows/exports for a document (reviewer correction first). */
export const customerOf = (d: LibraryDocument) =>
  d.extractedData?.customer_name?.user_value || d.extractedData?.customer_name?.value || '';

/** Attaches a viewport screenshot under `name`. */
export async function attachScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const file = testInfo.outputPath(`${name.replace(/[^\w-]+/g, '_')}.png`);
  await page.screenshot({ path: file });
  await testInfo.attach(name, { path: file, contentType: 'image/png' });
}
