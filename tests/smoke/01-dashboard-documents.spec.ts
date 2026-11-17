import { Locator, Page } from '@playwright/test';
import { test, expect } from '../../src/fixtures/test.fixture';
import { DashboardPage, KpiNames } from '../../src/pages/dashboard.page';
import { DocumentsPage } from '../../src/pages/documents.page';
import { LeftSidePage } from '../../src/pages/left-side.page';
import { PoAckReconPage } from '../../src/pages/po-ack-recon.page';
import { SifListPage } from '../../src/pages/sif-conversion.page';
import { UsersPage } from '../../src/pages/settings/users.page';
import { QaData } from '../../src/test-data/qa-data';
import { trackErrors } from './support/smoke';

/*
 * Smoke 01: Dashboard, Documents and the left side menu (TC_SMOKE_001 - TC_SMOKE_012). Read-only.
 * Every left side menu item is clicked and its page must load (Clients is not part of the smoke suite, on request).
 */

test.describe('Smoke 01: Dashboard and Documents (TC_SMOKE_001 - TC_SMOKE_004)', () => {
  test('TC_SMOKE_001: Verify that the Dashboard loads the KPI cards and the document list.', async ({ dashboardPage, page }) => {
    const errors = trackErrors(page);
    await dashboardPage.navigate();
    await dashboardPage.expectLoaded();
    for (const kpi of KpiNames) {
      await expect(dashboardPage.kpiTab(kpi), `${kpi} card shows a number`).toHaveText(new RegExp(`^\\s*${kpi}\\s*\\d[\\d,]*`), { timeout: 60000 });
    }
    await expect(dashboardPage.tableRows.first(), 'the document list has rows').toBeVisible();
    expect(errors, 'no page errors or server errors (5xx)').toEqual([]);
  });

  test('TC_SMOKE_002: Verify that clicking a Dashboard card lists the documents of that status.', async ({ dashboardPage }) => {
    await dashboardPage.navigate();
    await dashboardPage.expectLoaded();
    const pending = await dashboardPage.kpiCount('Pending Review');
    await dashboardPage.selectKpi('Pending Review');
    await expect(dashboardPage.kpiTab('Pending Review')).toHaveAttribute('aria-selected', 'true');
    await expect(dashboardPage.listHeading).toHaveAccessibleName(new RegExp(`^Pending Review ${pending} documents$`));
    if (pending > 0) await expect(dashboardPage.tableRows.first()).toBeVisible();
  });

  test('TC_SMOKE_003: Verify that the Dashboard organization filter works.', async ({ dashboardPage }) => {
    await dashboardPage.navigate();
    await dashboardPage.expectLoaded();
    await dashboardPage.selectOrganization(QaData.defaultOrg);
    await expect(dashboardPage.orgCombobox).toHaveText(QaData.defaultOrg);
    await expect(dashboardPage.kpiTab('Total Documents')).toHaveText(/\d/);
  });

  test('TC_SMOKE_004: Verify that the Documents page search finds a document.', async ({ page }) => {
    const documents = new DocumentsPage(page);
    await documents.navigate();
    const first = (await documents.nameCell(documents.dataRows.first()).innerText()).trim().split('\n')[0];
    expect(first, 'a document in the list').toBeTruthy();
    await documents.searchDocument(first);
    await expect(documents.rowByName(first).first()).toBeVisible();
    await expect(documents.searchInput).toHaveValue(first);
  });
});

/** Left side menu items and what each page must show once loaded */
const MENU: Array<{ id: string; path: string[]; url: RegExp; ready: (page: Page) => Locator }> = [
  { id: 'TC_SMOKE_005', path: ['Dashboard'], url: /\/dashboard$/, ready: (p) => new DashboardPage(p).kpiTablist },
  { id: 'TC_SMOKE_006', path: ['Documents'], url: /\/documents$/, ready: (p) => new DocumentsPage(p).searchInput },
  { id: 'TC_SMOKE_007', path: ['SIF Conversion'], url: /\/sif-conversion/, ready: (p) => new SifListPage(p).tab('All') },
  { id: 'TC_SMOKE_008', path: ['PO-ACK Recon'], url: /\/po-ack-recon$/, ready: (p) => new PoAckReconPage(p).searchInput },
  { id: 'TC_SMOKE_009', path: ['Analytics'], url: /\/analytics$/, ready: (p) => new LeftSidePage(p).header.getByText('Analytics') },
  { id: 'TC_SMOKE_010', path: ['Audit Logs'], url: /\/coming-soon\?from=audit-logs$/, ready: (p) => new LeftSidePage(p).header.getByText('Audit Logs') },
  { id: 'TC_SMOKE_011', path: ['Settings', 'Users'], url: /\/users$/, ready: (p) => new UsersPage(p).userNames.first() },
  { id: 'TC_SMOKE_012', path: ['Settings', 'Organizations'], url: /\/organizations$/, ready: (p) => p.locator('main h3').first() },
];

test.describe('Smoke 01: Left side menu (TC_SMOKE_005 - TC_SMOKE_012)', () => {
  for (const item of MENU) {
    test(`${item.id}: Verify that the ${item.path.join(' > ')} page loads from the left side menu.`, async ({ leftSidePage, page }) => {
      const errors = trackErrors(page);
      // Start from another page, so every item really navigates
      await page.goto(item.path[0] === 'Documents' ? '/dashboard' : '/documents');
      await expect(leftSidePage.sidebarNav).toBeVisible();
      for (const label of item.path) await leftSidePage.navigateViaSidebar(label);
      await expect(page).toHaveURL(item.url);
      await leftSidePage.waitForLoaded(30000);
      await page.waitForLoadState('networkidle').catch(() => {});
      await expect(item.ready(page), `${item.path.join(' > ')} page content`).toBeVisible({ timeout: 30000 });
      await expect(leftSidePage.navButton(item.path[item.path.length - 1])).toBeVisible();
      expect(errors, 'no page errors or server errors (5xx)').toEqual([]);
    });
  }
});
