import { Page } from '@playwright/test';
import { test, expect } from '../../src/fixtures/test.fixture';
import { Config } from '../../src/config/environment';
import { DashboardPage, DashboardStats, KpiName, KpiNames } from '../../src/pages/dashboard.page';
import { LibraryPage } from '../../src/pages/documents.page';
import {
  CARD_CAPTIONS,
  CARD_STATUSES,
  EXPORT_COLUMNS,
  ExportColumn,
  addDays,
  attachScreenshot,
  capture,
  clickCalendarDay,
  customerOf,
  expectedCardCounts,
  exportReport,
  inRange,
  presetRange,
  reportColumn,
  revealColumn,
  showReport,
  startOfDay,
  ymd,
} from './support/dashboard-helpers';

/*
 * Source: "Left side fields" sheet of Test Cases/PO and Quote Suite/PO and Quote suite cases final.xlsx.
 * Card counts, filters and exports are checked against the APIs the dashboard itself uses
 * (/api/dashboard and listDocumentsLibrary), so a wrong number on screen or in a report fails the test.
 */

/** Every KPI card shows the count derived from `stats` (and is highlighted). */
async function expectCards(dashboardPage: DashboardPage, stats: DashboardStats): Promise<void> {
  const expected = expectedCardCounts(stats);
  for (const name of KpiNames) {
    await expect(dashboardPage.kpiTab(name), `${name} card count`).toHaveText(
      // The card text has no spaces ("Total Documents538All-time total"), so end the number with (?!\d), not \b
      new RegExp(`^${name}\\s*${expected[name].toLocaleString('en-US')}(?!\\d)`),
    );
  }
}

/** Table cells of a dashboard column (DOCUMENT NAME=1, CUSTOMER=2, UPLOADED BY=3, UPLOAD DATE=4, STATUS=5). */
const COLUMN_INDEX = { 'Document Name': 1, Customer: 2, 'Uploaded By': 3, 'Upload Date': 4, Status: 5 } as const;
const cell = (dashboardPage: DashboardPage, row: number, column: keyof typeof COLUMN_INDEX) =>
  dashboardPage.tableRows.nth(row).locator(`td:nth-child(${COLUMN_INDEX[column]})`);

test.describe('River Stream - Left Side Fields & Dashboard Suite (40 Test Cases)', () => {
  test('TC_Lefit-side-fields_001: Verify Logout button visibility and location', async ({ dashboardPage, leftSidePage, page }) => {
    await dashboardPage.navigate();
    await expect(leftSidePage.logoutButton).toBeVisible();
    // Bottom-left corner: inside the sidebar, in the lower part of the window
    const box = (await leftSidePage.logoutButton.boundingBox())!;
    const sidebar = (await leftSidePage.sidebar.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(box.x + box.width, 'Logout is inside the left sidebar').toBeLessThanOrEqual(sidebar.x + sidebar.width);
    expect(box.y, 'Logout is at the bottom of the window').toBeGreaterThan(viewport.height * 0.75);
  });

  test.describe('Logout (own login session)', () => {
    // Logging out must not end the shared admin session the other tests use.
    test.use({ storageState: { cookies: [], origins: [] } });

    test('TC_Left-side-fields_001: Verify Logout button functionality', async ({ loginPage, leftSidePage, page }) => {
      await loginPage.navigate();
      await loginPage.loginAndWaitForDashboard(Config.adminEmail, Config.adminPassword);
      await leftSidePage.clickLogout();
      // Redirected to the login page
      await expect(page).toHaveURL(/\/$/);
      await expect(loginPage.emailInput, 'login page is shown').toBeVisible();
      // The session has ended: the dashboard is no longer reachable
      await page.goto('/dashboard');
      await expect(loginPage.emailInput, 'protected page redirects to login after logout').toBeVisible({ timeout: 20000 });
      await expect(page).not.toHaveURL(/\/dashboard$/);
    });
  });

  test.describe('Dashboard', () => {
    /** /api/dashboard and first listDocumentsLibrary page of the freshly opened dashboard */
    let initial: { stats: DashboardStats; list: LibraryPage };

    test.beforeEach(async ({ dashboardPage, page }) => {
      test.setTimeout(120000);
      const c = await capture(page, () => dashboardPage.navigate(), { stats: () => true, list: () => true });
      initial = { stats: c.stats!, list: c.list! };
    });

    /**
     * Selects the first card (in `order`) whose first page of documents satisfies `found` and returns that page.
     * The newest documents can all come from one source (e.g. an email test run), so several cards are tried.
     */
    async function cardWhere(
      dashboardPage: DashboardPage,
      found: (docs: LibraryPage['documents']) => boolean,
      order: KpiName[] = ['Total Documents', 'Pending Review', 'Reviewed', 'Processing'],
    ): Promise<LibraryPage> {
      for (const name of order) {
        const list = await selectCard(dashboardPage, name);
        if (found(list.documents)) return list;
      }
      throw new Error('No card lists a matching document on its first page');
    }

    /** Selects a KPI card and returns the first page of documents it lists. */
    async function selectCard(dashboardPage: DashboardPage, name: KpiName): Promise<LibraryPage> {
      if ((await dashboardPage.kpiTab(name).getAttribute('aria-selected')) === 'true') {
        // Already selected (Pending Review is the default): its list is the initial one
        return initial.list;
      }
      const c = await capture(dashboardPage.page, () => dashboardPage.selectKpi(name), { list: () => true });
      return c.list!;
    }

    // =========================================================================
    // Metric cards & layout
    // =========================================================================

    test('TC_Dashboard_003: Verify Total Documents metric card with counts displayed', async ({ dashboardPage }) => {
      const expected = expectedCardCounts(initial.stats)['Total Documents'];
      await expect(dashboardPage.kpiTab('Total Documents')).toBeVisible();
      await expect(dashboardPage.kpiTab('Total Documents'), 'count = processing + pending review + reviewed').toHaveText(
        new RegExp(`^Total Documents\\s*${expected.toLocaleString('en-US')}(?!\\d)`),
      );
      await expect(dashboardPage.kpiTab('Total Documents')).toHaveText(CARD_CAPTIONS['Total Documents']);
    });

    test('TC_Dashboard_004: Verify Organization dropdown is displayed', async ({ dashboardPage }) => {
      await expect(dashboardPage.orgCombobox).toBeVisible();
      await expect(dashboardPage.orgCombobox, 'default value').toHaveText('All Organizations');
    });

    test('TC_Dashboard_005: Verify Organization dropdown options', async ({ dashboardPage, page }) => {
      // Organizations the app knows about (same API the dropdown is filled from)
      const orgsResponse = page.waitForResponse((r) => r.url().includes('/api/superAdminListOrganizations') && r.ok());
      await page.reload();
      const json = await (await orgsResponse).json();
      const findArray = (o: unknown): Array<Record<string, unknown>> | undefined => {
        if (Array.isArray(o)) return o as Array<Record<string, unknown>>;
        if (o && typeof o === 'object') for (const v of Object.values(o)) { const f = findArray(v); if (f) return f; }
        return undefined;
      };
      const apiOrgs = (findArray(json) ?? [])
        .map((o) => String(o.organizationName ?? o.name ?? o.displayName ?? '').trim().toLowerCase())
        .filter(Boolean)
        .sort();
      await dashboardPage.expectLoaded();

      await dashboardPage.openOrgDropdown();
      await expect(dashboardPage.orgOptions.first()).toHaveText('All Organizations');
      const options = (await dashboardPage.orgOptions.allInnerTexts()).map((o) => o.trim());
      expect(new Set(options).size, 'no duplicate organizations').toBe(options.length);
      expect(options.slice(1).map((o) => o.toLowerCase()).sort(), 'every organization is listed').toEqual(apiOrgs);
      await expect(dashboardPage.orgOptions).toHaveCount(apiOrgs.length + 1);
    });

    test('TC_Dashboard_006: Verify Organization selection functionality', async ({ dashboardPage, page }) => {
      const before = expectedCardCounts(initial.stats);
      const org = 'Corpdesign';
      const c = await capture(page, () => dashboardPage.selectOrganization(org), {
        stats: (p) => (p.get('organizationName') ?? '').toLowerCase() === org.toLowerCase(),
        list: (req) => (req.organizationName ?? '').toLowerCase() === org.toLowerCase(),
      });
      const after = expectedCardCounts(c.stats!);
      expect(after, 'card counts change with the organization').not.toEqual(before);
      for (const d of c.list!.documents) expect(d.organizationName.toLowerCase(), `${d.fileName} organization`).toBe(org.toLowerCase());
      await expect(dashboardPage.orgCombobox).toHaveText(org);
      await expectCards(dashboardPage, c.stats!);
    });

    test('TC_Dashboard_007: Verify Reviewed metric card is displayed', async ({ dashboardPage }) => {
      await expect(dashboardPage.kpiTab('Reviewed')).toBeVisible();
      await expect(dashboardPage.kpiTab('Reviewed'), 'reviewed document count').toHaveText(
        new RegExp(`^Reviewed\\s*${initial.stats.reviewed.toLocaleString('en-US')}(?!\\d).*${CARD_CAPTIONS.Reviewed.source}`, 'i'),
      );
    });

    test('TC_Dashboard_008: Verify Pending Review metric card is displayed', async ({ dashboardPage }) => {
      await expect(dashboardPage.kpiTab('Pending Review')).toBeVisible();
      await expect(dashboardPage.kpiTab('Pending Review'), 'pending review count and status message').toHaveText(
        new RegExp(`^Pending Review\\s*${initial.stats.extracted.toLocaleString('en-US')}(?!\\d).*${CARD_CAPTIONS['Pending Review'].source}`, 'i'),
      );
    });

    test('TC_Dashboard_009: Verify Processing metric card is displayed', async ({ dashboardPage }) => {
      await expect(dashboardPage.kpiTab('Processing')).toBeVisible();
      await expect(dashboardPage.kpiTab('Processing'), 'number of files being processed').toHaveText(
        new RegExp(`^Processing\\s*${initial.stats.processing.toLocaleString('en-US')}(?!\\d).*${CARD_CAPTIONS.Processing.source}`, 'i'),
      );
    });

    test('TC_Dashboard_010: Verify dashboard card alignment', async ({ dashboardPage }) => {
      await expect(dashboardPage.kpiTabs).toHaveCount(4);
      const boxes = await dashboardPage.kpiTabs.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON() as DOMRect));
      // Same size
      for (const b of boxes) {
        expect(Math.abs(b.width - boxes[0].width), 'cards have the same width').toBeLessThanOrEqual(1);
        expect(Math.abs(b.height - boxes[0].height), 'cards have the same height').toBeLessThanOrEqual(1);
      }
      // Rows: cards on a row share the same top, rows start at the same left edge, gaps are equal
      const rows = new Map<number, DOMRect[]>();
      for (const b of boxes) rows.set(Math.round(b.y), [...(rows.get(Math.round(b.y)) ?? []), b]);
      const gaps: number[] = [];
      for (const row of rows.values()) {
        expect(Math.abs(row[0].x - boxes[0].x), 'rows are left-aligned').toBeLessThanOrEqual(1);
        for (let i = 1; i < row.length; i++) gaps.push(row[i].x - (row[i - 1].x + row[i - 1].width));
      }
      for (const g of gaps) expect(Math.abs(g - gaps[0]), 'consistent spacing between cards').toBeLessThanOrEqual(2);
    });

    test('TC_Dashboard_011: Verify dashboard data refresh on page reload', async ({ dashboardPage, page }) => {
      const errors = dashboardPage.trackPageErrors();
      const c = await capture(page, async () => { await page.reload(); await dashboardPage.expectLoaded(); }, { stats: () => true });
      await expectCards(dashboardPage, c.stats!);
      expect(errors, 'no errors after reload').toEqual([]);
    });

    test('TC_Dashboard_012: Verify dashboard responsiveness', async ({ dashboardPage, page }, testInfo) => {
      const sizes = [
        { width: 1440, height: 900 },
        { width: 1024, height: 768 },
        { width: 768, height: 1024 },
      ];
      for (const [i, size] of sizes.entries()) {
        await page.setViewportSize(size);
        for (const name of KpiNames) await expect(dashboardPage.kpiTab(name), `${name} card at ${size.width}px`).toBeVisible();
        expect(await dashboardPage.hasHorizontalScroll(), `no horizontal scroll at ${size.width}px`).toBe(false);
        const boxes = await dashboardPage.kpiTabs.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON() as DOMRect));
        for (const b of boxes) expect(b.x + b.width, `cards fit the ${size.width}px window`).toBeLessThanOrEqual(size.width);
        for (let a = 0; a < boxes.length; a++)
          for (let b = a + 1; b < boxes.length; b++) {
            const A = boxes[a], B = boxes[b];
            const overlap = A.x < B.x + B.width - 1 && B.x < A.x + A.width - 1 && A.y < B.y + B.height - 1 && B.y < A.y + A.height - 1;
            expect(overlap, `cards ${a + 1} and ${b + 1} do not overlap at ${size.width}px`).toBe(false);
          }
        // The last size is captured by the end-of-test screenshot
        if (i < sizes.length - 1) await attachScreenshot(page, testInfo, `${size.width} x ${size.height}`);
      }
    });

    // =========================================================================
    // Uploaded By
    // =========================================================================

    test('TC_Dashboard_014: Verify Uploaded By column on Dashboard', async ({ dashboardPage }) => {
      await expect(dashboardPage.tableHeaderCells.nth(COLUMN_INDEX['Uploaded By'] - 1)).toHaveText(/Uploaded By/i);
      const docs = initial.list.documents.slice(0, 10);
      expect(docs.length).toBeGreaterThan(0);
      for (const [i, d] of docs.entries()) {
        await expect(cell(dashboardPage, i, 'Uploaded By'), `${d.fileName} uploader`).toHaveText(d.userName);
      }
    });

    test('TC_Dashboard_015: Verify Uploaded By column on Documents page', async ({ documentsPage }) => {
      const lib = await documentsPage.navigate();
      await expect(documentsPage.tableHeaderCells.nth(2)).toHaveText(/Uploaded By/i);
      for (const [i, d] of lib.documents.slice(0, 10).entries()) {
        await expect(documentsPage.dataRows.nth(i).locator('td:nth-child(3)'), `${d.fileName} uploader`).toHaveText(d.userName);
      }
    });

    test('TC_Dashboard_016: Verify name for website-uploaded documents', async ({ dashboardPage }) => {
      const isWeb = (d: LibraryPage['documents'][number]) => d.fileProcessedFrom !== 'email';
      const list = await cardWhere(dashboardPage, (docs) => docs.some(isWeb));
      const i = list.documents.findIndex(isWeb);
      const d = list.documents[i];
      // The uploading user's name, with their e-mail on hover
      await expect(cell(dashboardPage, i, 'Uploaded By'), `${d.fileName} uploader`).toHaveText(d.userName);
      await dashboardPage.uploadedByTrigger(dashboardPage.tableRows.nth(i)).hover();
      await expect(dashboardPage.hoverCard).toContainText(d.userName);
      await expect(dashboardPage.hoverCard).toContainText(d.userEmail);
    });

    test('TC_Dashboard_017: Verify name for email-received documents', async ({ dashboardPage }) => {
      const isEmail = (d: LibraryPage['documents'][number]) => d.fileProcessedFrom === 'email';
      const list = await cardWhere(dashboardPage, (docs) => docs.some(isEmail));
      const i = list.documents.findIndex(isEmail);
      const d = list.documents[i];
      // The sender is shown (the sender's address for documents received by email)
      await expect(cell(dashboardPage, i, 'Uploaded By'), `${d.fileName} sender`).toHaveText(d.userName);
      await dashboardPage.uploadedByTrigger(dashboardPage.tableRows.nth(i)).hover();
      await expect(dashboardPage.hoverCard).toContainText(d.userEmail);
    });

    test('TC_Dashboard_018: Verify Uploaded By for different users', async ({ dashboardPage }) => {
      const firstRows = (docs: LibraryPage['documents']) => docs.slice(0, 15);
      const uploaders = (docs: LibraryPage['documents']) => new Set(firstRows(docs).map((d) => d.userName.trim())).size;
      const list = await cardWhere(dashboardPage, (docs) => uploaders(docs) > 1, ['Pending Review', 'Reviewed', 'Total Documents', 'Processing']);
      const docs = firstRows(list.documents);
      expect(uploaders(list.documents), 'documents from more than one uploader').toBeGreaterThan(1);
      for (const [i, d] of docs.entries()) {
        await expect(cell(dashboardPage, i, 'Uploaded By'), `${d.fileName} uploader`).toHaveText(d.userName);
      }
    });

    test('TC_Dashboard_019: Verify Uploaded By values match across pages', async ({ dashboardPage, documentsPage }, testInfo) => {
      const list = await selectCard(dashboardPage, 'Total Documents');
      const d = list.documents[0];
      const dashboardUploader = (await cell(dashboardPage, 0, 'Uploaded By').innerText()).trim();
      await expect(cell(dashboardPage, 0, 'Uploaded By')).toHaveText(d.userName);
      await attachScreenshot(dashboardPage.page, testInfo, '1 - Dashboard');

      await documentsPage.navigate();
      await documentsPage.search(d.fileName);
      const row = documentsPage.rowByName(d.fileName).first();
      await expect(row).toBeVisible();
      await expect(row.locator('td:nth-child(3)'), 'same uploader on the Documents page').toHaveText(dashboardUploader);
    });

    test('TC_Dashboard_020: Verify Uploaded By for existing documents', async ({ dashboardPage, page }) => {
      // Older documents: last month's uploads
      await selectCard(dashboardPage, 'Total Documents');
      const c = await capture(page, () => dashboardPage.selectDateRange('Last month'), { list: (req) => !!req.createdFrom });
      const docs = c.list!.documents;
      expect(docs.length, 'documents uploaded last month').toBeGreaterThan(0);
      for (const d of docs) expect(d.userName, `${d.fileName} has an uploader`).toBeTruthy();
      for (const [i, d] of docs.slice(0, 15).entries()) {
        await expect(cell(dashboardPage, i, 'Uploaded By'), `${d.fileName} uploader`).toHaveText(d.userName);
      }
    });

    // =========================================================================
    // Export
    // =========================================================================

    test('TC_Dashboard_021: Verify the Export icon is visible for all user logins.', async ({ dashboardPage }) => {
      test.info().annotations.push({ type: 'note', description: 'Checked for the admin login (the only credentials in .env).' });
      await expect(dashboardPage.exportButton).toBeVisible();
      await expect(dashboardPage.exportButton).toBeEnabled();
    });

    test('TC_Dashboard_022: Verify the CSV download option.', async ({ dashboardPage, page }, testInfo) => {
      const expected = expectedCardCounts(initial.stats)['Pending Review'];
      const report = await exportReport(dashboardPage, testInfo, 'csv', expected);
      expect(report.fileName).toMatch(/\.csv$/);
      expect(report.header).toEqual([...EXPORT_COLUMNS]);
      expect(report.records, 'one row per document of the selected card').toHaveLength(expected);
      await showReport(page, report, 'CSV download (Pending Review card)');
      await expect(page.locator('thead th')).toHaveText([...EXPORT_COLUMNS]);
    });

    test('TC_Dashboard_023: Verify the XLSX download option.', async ({ dashboardPage, page }, testInfo) => {
      const expected = expectedCardCounts(initial.stats)['Pending Review'];
      const report = await exportReport(dashboardPage, testInfo, 'xlsx', expected);
      expect(report.fileName).toMatch(/\.xlsx$/);
      expect(report.header).toEqual([...EXPORT_COLUMNS]);
      expect(report.records, 'one row per document of the selected card').toHaveLength(expected);
      await showReport(page, report, 'XLSX download (Pending Review card)');
      await expect(page.locator('thead th')).toHaveText([...EXPORT_COLUMNS]);
    });

    test('TC_Dashboard_024: Verify the exported report based on the applied filters.', async ({ dashboardPage, page }, testInfo) => {
      const list = await selectCard(dashboardPage, 'Reviewed');
      const expected = expectedCardCounts(initial.stats).Reviewed;
      const report = await exportReport(dashboardPage, testInfo, 'xlsx', expected);
      expect(report.records, 'one row per Reviewed document').toHaveLength(expected);
      expect(list.totalCount).toBe(expected);
      expect(report.records.map((r) => r['Document Name']), 'the Reviewed documents').toEqual(report.apiDocs.map((d) => d.fileName));
      for (const r of report.records) expect(CARD_STATUSES.Reviewed, `${r['Document Name']} status`).toContain(r.Status);
      await showReport(page, report, 'Reviewed card selected');
      await expect(reportColumn(page, 'Status')).toHaveText(report.records.slice(0, 15).map((r) => r.Status));
      await revealColumn(page, 'Status');
      await expect(reportColumn(page, 'Status').first()).toBeInViewport();
    });

    /** Exports the Total Documents list and checks one column against the documents the app exported. */
    async function checkExportColumn(
      dashboardPage: DashboardPage,
      page: Page,
      columns: ExportColumn[],
      expectedFor: (column: ExportColumn, d: LibraryPage['documents'][number]) => string,
    ): Promise<void> {
      await selectCard(dashboardPage, 'Total Documents');
      const expected = expectedCardCounts(initial.stats)['Total Documents'];
      const report = await exportReport(dashboardPage, test.info(), 'csv', expected);
      expect(report.records).toHaveLength(report.apiDocs.length);
      for (const column of columns) {
        // Values are exported trimmed (e.g. a user named "Tony Stark " is exported as "Tony Stark")
        expect(report.records.map((r) => r[column].trim()), `${column} column`).toEqual(report.apiDocs.map((d) => expectedFor(column, d).trim()));
      }
      await showReport(page, report, `Total Documents card selected · checked: ${columns.join(', ')}`);
      for (const column of columns) {
        await expect(reportColumn(page, column)).toHaveText(report.apiDocs.slice(0, 15).map((d) => expectedFor(column, d).trim()));
        await revealColumn(page, column);
        await expect(reportColumn(page, column).first(), `${column} column is on screen`).toBeInViewport();
      }
    }

    test('TC_Dashboard_025: Verify the Document Name column in the exported report.', async ({ dashboardPage, page }) => {
      await checkExportColumn(dashboardPage, page, ['Document Name'], (_c, d) => d.fileName);
    });

    test('TC_Dashboard_026: Verify the Customer column in the exported report.', async ({ dashboardPage, page }) => {
      await checkExportColumn(dashboardPage, page, ['Customer'], (_c, d) => customerOf(d));
    });

    test('TC_Dashboard_027: Verify the Uploaded By and Uploader Email columns.', async ({ dashboardPage, page }) => {
      await checkExportColumn(dashboardPage, page, ['Uploaded By', 'Uploader Email'], (c, d) => (c === 'Uploaded By' ? d.userName : d.userEmail));
    });

    test('TC_Dashboard_028: Verify the Uploaded From column.', async ({ dashboardPage, page }) => {
      await checkExportColumn(dashboardPage, page, ['Uploaded From'], (_c, d) => (d.fileProcessedFrom === 'email' ? 'Email' : 'Web'));
    });

    test('TC_Dashboard_029: Verify the Upload Date column.', async ({ dashboardPage, page }) => {
      await checkExportColumn(dashboardPage, page, ['Upload Date'], (_c, d) =>
        new Date(d.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      );
    });

    test('TC_Dashboard_030: Verify the Status Details column.', async ({ dashboardPage, page }, testInfo) => {
      // The exported status must be the status the dashboard shows for the same document
      await selectCard(dashboardPage, 'Total Documents');
      await expect.poll(async () => (await dashboardPage.columnValues('Status')).every(Boolean), { message: 'statuses rendered' }).toBe(true);
      const names = await dashboardPage.columnValues('Document Name');
      const statuses = await dashboardPage.columnValues('Status');
      const report = await exportReport(dashboardPage, testInfo, 'csv', expectedCardCounts(initial.stats)['Total Documents']);
      // Same order as the dashboard list: compare row by row (the same file name can appear more than once)
      const n = Math.min(names.length, report.records.length);
      expect(n, 'rows shown on the dashboard').toBeGreaterThan(0);
      expect(report.records.slice(0, n).map((r) => r['Document Name']), 'same documents, same order').toEqual(names.slice(0, n));
      expect(report.records.slice(0, n).map((r) => r.Status), 'exported status = status shown on the dashboard').toEqual(statuses.slice(0, n));
      await showReport(page, report, 'Total Documents card selected · Status compared with the dashboard');
      await expect(reportColumn(page, 'Status')).toHaveText(statuses.slice(0, Math.min(15, n)));
      await revealColumn(page, 'Status');
      await expect(reportColumn(page, 'Status').first(), 'Status column is on screen').toBeInViewport();
    });

    // =========================================================================
    // Date filters
    // =========================================================================

    test('TC_Dashboard_031: Verify the date filter is displayed in the Dashboard header.', async ({ dashboardPage }) => {
      await expect(dashboardPage.dateRangeButton).toBeVisible();
      const button = (await dashboardPage.dateRangeButton.boundingBox())!;
      const cards = (await dashboardPage.kpiTablist.boundingBox())!;
      expect(button.y + button.height, 'date filter is in the header, above the cards').toBeLessThanOrEqual(cards.y);
    });

    test('TC_Dashboard_032: Verify the default date filter option.', async ({ dashboardPage }) => {
      await expect(dashboardPage.dateRangeButton).toHaveAccessibleName('Date range: All time');
      expect(initial.list.request, 'no date restriction by default').not.toHaveProperty('createdFrom');
      await expectCards(dashboardPage, initial.stats);
    });

    for (const [id, preset] of [
      ['033', 'This week'],
      ['034', 'Last week'],
      ['035', 'This month'],
      ['036', 'Last month'],
    ] as const) {
      test(`TC_Dashboard_${id}: Verify the ${preset} filter.`, async ({ dashboardPage, page }) => {
        const { from, before } = presetRange(preset);
        await selectCard(dashboardPage, 'Total Documents');
        const c = await capture(page, () => dashboardPage.selectDateRange(preset), {
          stats: (p) => p.has('createdFrom'),
          list: (req) => !!req.createdFrom,
        });
        const params = new URL(c.statsResponse!.url()).searchParams;
        expect(params.get('createdFrom'), `${preset} starts ${ymd(from)}`).toMatch(new RegExp(`^${ymd(from)}T00:00:00`));
        expect(params.get('createdBefore'), `${preset} ends before ${ymd(before)}`).toMatch(new RegExp(`^${ymd(before)}T00:00:00`));
        const req = c.list!.request as LibraryPage['request'] & { createdFrom: string; createdBefore: string };
        for (const d of c.list!.documents) {
          expect(inRange(d.createdAt, new Date(req.createdFrom), new Date(req.createdBefore)), `${d.fileName} uploaded ${d.createdAt} is in ${preset}`).toBe(true);
        }
        await expect(dashboardPage.dateRangeButton).toHaveAccessibleName(`Date range: ${preset}`);
        await expectCards(dashboardPage, c.stats!);
      });
    }

    test('TC_Dashboard_037: Verify the single date filter.', async ({ dashboardPage, page }) => {
      // A day that has documents: the newest document's upload day
      const day = startOfDay(new Date(initial.list.documents[0].createdAt));
      await dashboardPage.dateRangeButton.click();
      await dashboardPage.dateRangePreset('Custom').click();
      const c = await capture(page, () => clickCalendarDay(dashboardPage, day), {
        stats: (p) => (p.get('createdFrom') ?? '').startsWith(ymd(day)),
        list: (req) => String(req.createdFrom ?? '').startsWith(ymd(day)),
      });
      await page.keyboard.press('Escape');
      const params = new URL(c.statsResponse!.url()).searchParams;
      expect(params.get('createdBefore'), 'one day only').toMatch(new RegExp(`^${ymd(addDays(day, 1))}T00:00:00`));
      expect(c.list!.documents.length, `documents uploaded on ${ymd(day)}`).toBeGreaterThan(0);
      for (const d of c.list!.documents) {
        expect(ymd(startOfDay(new Date(d.createdAt))), `${d.fileName} uploaded on the selected day`).toBe(ymd(day));
      }
      await expect(dashboardPage.dateRangeButton).toHaveAccessibleName(
        `Date range: ${day.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
      );
      await expectCards(dashboardPage, c.stats!);
    });

    test('TC_Dashboard_038: Verify the custom date range selection.', async ({ dashboardPage, page }) => {
      const to = startOfDay();
      const from = addDays(to, -6);
      await selectCard(dashboardPage, 'Total Documents');
      await dashboardPage.dateRangeButton.click();
      await dashboardPage.dateRangePreset('Custom').click();
      await clickCalendarDay(dashboardPage, from);
      const c = await capture(page, () => clickCalendarDay(dashboardPage, to), {
        stats: (p) => (p.get('createdBefore') ?? '').startsWith(ymd(addDays(to, 1))) && (p.get('createdFrom') ?? '').startsWith(ymd(from)),
        list: (req) => String(req.createdBefore ?? '').startsWith(ymd(addDays(to, 1))) && String(req.createdFrom ?? '').startsWith(ymd(from)),
      });
      await page.keyboard.press('Escape');
      const req = c.list!.request as LibraryPage['request'] & { createdFrom: string; createdBefore: string };
      for (const d of c.list!.documents) {
        expect(inRange(d.createdAt, new Date(req.createdFrom), new Date(req.createdBefore)), `${d.fileName} uploaded ${d.createdAt} is in the range`).toBe(true);
      }
      const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      await expect(dashboardPage.dateRangeButton).toHaveAccessibleName(new RegExp(`^Date range: ${fmt(from)}.*${fmt(to)}, ${to.getFullYear()}$`));
      await expectCards(dashboardPage, c.stats!);
    });

    // =========================================================================
    // Cards, document type and file format filters
    // =========================================================================

    test('TC_Dashboard_039: Verify the Cards filter.', async ({ dashboardPage }, testInfo) => {
      const counts = expectedCardCounts(initial.stats);
      const order: KpiName[] = ['Processing', 'Reviewed', 'Pending Review', 'Total Documents'];
      for (const [i, name] of order.entries()) {
        const list = await selectCard(dashboardPage, name);
        await expect(dashboardPage.kpiTab(name)).toHaveAttribute('aria-selected', 'true');
        await expect(dashboardPage.listHeading, `${name} list count`).toHaveAccessibleName(
          new RegExp(`^${name === 'Total Documents' ? 'All Documents' : name} ${counts[name]} documents$`),
        );
        expect(list.totalCount, `${name} documents`).toBe(counts[name]);
        if (name !== 'Total Documents') {
          const allowed = CARD_STATUSES[name];
          await expect
            .poll(async () => { const s = await dashboardPage.columnValues('Status'); return s.length > 0 && s.every((x) => allowed.includes(x)); }, {
              message: `every listed document has a ${allowed.join(' / ')} status`,
            })
            .toBe(true);
        }
        if (i < order.length - 1) await attachScreenshot(dashboardPage.page, testInfo, `${i + 1} - ${name} card`);
      }
    });

    test('TC_Dashboard_040: Verify Document Type Filter', async ({ dashboardPage, page }) => {
      await selectCard(dashboardPage, 'Total Documents');
      const po = await capture(page, () => dashboardPage.selectDocumentType('Purchase order'), {
        stats: (p) => p.get('docTypeFilter') === 'PURCHASE_ORDER',
        list: (req) => JSON.stringify(req.docTypeFilter) === '["PURCHASE_ORDER"]',
      });
      for (const d of po.list!.documents) expect(d.selectedDocType, `${d.fileName} type`).toBe('PURCHASE_ORDER');
      await expectCards(dashboardPage, po.stats!);

      // Single selection: choosing Quote request replaces Purchase order
      const quote = await capture(page, () => dashboardPage.selectDocumentType('Quote request'), {
        stats: (p) => !!p.get('docTypeFilter') && p.get('docTypeFilter') !== 'PURCHASE_ORDER',
        list: (req) => Array.isArray(req.docTypeFilter) && !req.docTypeFilter.includes('PURCHASE_ORDER'),
      });
      expect(quote.list!.request.docTypeFilter, 'only one document type is applied').toHaveLength(1);
      for (const d of quote.list!.documents) expect(d.selectedDocType, `${d.fileName} type`).toBe(quote.list!.request.docTypeFilter![0]);
      await expectCards(dashboardPage, quote.stats!);
      await dashboardPage.documentTypeButton.click();
      await expect(dashboardPage.documentTypeOption('Quote request')).toHaveAttribute('aria-checked', 'true');
      // Read directly (not via expect on the locator) so only the selected option is highlighted
      expect(await dashboardPage.documentTypeOption('Purchase order').getAttribute('aria-checked'), 'Purchase order no longer selected').toBe('false');
    });

    test('TC_Dashboard_041: Verify File format Filter', async ({ dashboardPage, page }) => {
      await selectCard(dashboardPage, 'Total Documents');
      const c = await capture(page, () => dashboardPage.selectFileFormats('PDF', 'SIF'), {
        stats: (p) => p.get('fileTypeFilter') === 'PDF,SIF',
        list: (req) => JSON.stringify(req.fileTypeFilter) === '["PDF","SIF"]',
      });
      expect(c.list!.documents.length).toBeGreaterThan(0);
      for (const d of c.list!.documents) expect(d.fileName.toLowerCase(), `${d.fileName} format`).toMatch(/\.(pdf|sif)$/);
      await expectCards(dashboardPage, c.stats!);
      // Multi selection: both formats stay ticked
      await dashboardPage.fileFormatButton.click();
      await expect(dashboardPage.fileFormatOption('PDF')).toHaveAttribute('aria-checked', 'true');
      await expect(dashboardPage.fileFormatOption('SIF')).toHaveAttribute('aria-checked', 'true');
      // Read directly (not via expect on the locator) so only the selected options are highlighted
      expect(await dashboardPage.fileFormatOption('XLSX').getAttribute('aria-checked'), 'XLSX not selected').toBe('false');
    });
  });
});
