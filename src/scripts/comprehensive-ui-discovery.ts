import { chromium } from '@playwright/test';
import dotenv from 'dotenv';
import fs from 'fs';
import { LoginPage } from '../pages/login.page';
import { DashboardPage } from '../pages/dashboard.page';

dotenv.config();

async function discoverUI() {
  const browser = await chromium.launch({ headless: true });
  const baseURL = process.env.BASE_URL || 'https://riverstream-qa.azurewebsites.net/';
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const discovery: Record<string, any> = {};

  const loginPage = new LoginPage(page);
  const dashboardPage = new DashboardPage(page);

  console.log('Logging in to River Stream via LoginPage...');
  await loginPage.navigate();
  await loginPage.login(process.env.ADMIN_EMAIL || 'admin@riverstonetech.com', process.env.ADMIN_PASSWORD || 'River@123');
  const isDashboard = await dashboardPage.isDashboardLoaded();
  console.log('Login result: isDashboardLoaded =', isDashboard, '| URL:', page.url());

  // 1. Dashboard Page
  console.log('\n--- 1. Discovering Dashboard ---');
  await page.waitForTimeout(2000);
  discovery.dashboard = {
    url: page.url(),
    elements: await page.$$eval('h1, h2, h3, h4, p, button, a', els =>
      Array.from(new Set(els.map(e => e.textContent?.trim().replace(/\s+/g, ' ') || '').filter(t => t.length > 2 && t.length < 80)))
    )
  };
  console.log('Dashboard elements found:', discovery.dashboard.elements.slice(0, 15));

  // 2. Upload Document Page
  console.log('\n--- 2. Discovering Upload Page ---');
  await page.goto('/upload?from=dashboard', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  discovery.upload = {
    url: page.url(),
    elements: await page.$$eval('h1, h2, h3, p, label, button, a', els =>
      Array.from(new Set(els.map(e => e.textContent?.trim().replace(/\s+/g, ' ') || '').filter(Boolean)))
    ),
    inputs: await page.$$eval('input, select', els => els.map(e => ({
      tag: e.tagName.toLowerCase(),
      type: e.getAttribute('type'),
      placeholder: e.getAttribute('placeholder'),
      accept: e.getAttribute('accept')
    }))),
    documentTypes: [] as string[]
  };

  // Inspect Document Type Dropdown options
  const docTypeDropdown = page.locator('button:has-text("Choose a document type"), button:has-text("Select"), [role="combobox"]').first();
  if (await docTypeDropdown.isVisible({ timeout: 5000 }).catch(() => false)) {
    await docTypeDropdown.click();
    await page.waitForTimeout(1000);
    discovery.upload.documentTypes = await page.$$eval('[role="option"], [role="menuitem"], li, [data-radix-collection-item]', els =>
      els.map(e => e.textContent?.trim() || '').filter(Boolean)
    );
    console.log('Upload Document Types available:', discovery.upload.documentTypes);
    await page.keyboard.press('Escape');
  }

  // 3. Documents Page & Review links
  console.log('\n--- 3. Discovering Documents Page ---');
  await page.goto('/documents', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  discovery.documents = {
    url: page.url(),
    filters: await page.$$eval('button, [role="tab"]', els =>
      Array.from(new Set(els.map(e => e.textContent?.trim() || '').filter(t => t.length > 0 && t.length < 30)))
    ),
    tableHeaders: await page.$$eval('table th', ths => ths.map(t => t.textContent?.trim() || '').filter(Boolean)),
    totalRows: await page.locator('table tbody tr').count(),
    sampleRows: await page.$$eval('table tbody tr', trs =>
      trs.slice(0, 5).map(tr => tr.textContent?.trim().replace(/\s+/g, ' ') || '')
    )
  };
  console.log('Documents page table headers:', discovery.documents.tableHeaders);
  console.log('Documents total rows:', discovery.documents.totalRows);

  // 4. Click Review on the first document to inspect the Review Page!
  console.log('\n--- 4. Discovering Document Review Page ---');
  const firstReviewBtn = page.locator('button:has-text("Review"), a:has-text("Review"), table tbody tr:first-child a').first();
  if (await firstReviewBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await firstReviewBtn.click();
    await page.waitForTimeout(4000);
    discovery.reviewPage = {
      url: page.url(),
      title: await page.title(),
      elements: await page.$$eval('h1, h2, h3, button, th, label, [role="tab"]', els =>
        Array.from(new Set(els.map(e => e.textContent?.trim().replace(/\s+/g, ' ') || '').filter(t => t.length > 0 && t.length < 50)))
      ),
      hasPdfViewer: await page.locator('canvas, iframe, embed, .pdf-viewer').count() > 0,
      buttons: await page.$$eval('button', btns => btns.map(b => b.textContent?.trim() || '').filter(Boolean))
    };
    console.log('Review page URL:', discovery.reviewPage.url);
    console.log('Review page buttons:', discovery.reviewPage.buttons);
  }

  // 5. PO-ACK Recon Page
  console.log('\n--- 5. Discovering PO-ACK Recon Page ---');
  await page.goto('/po-ack-recon', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  discovery.poAckRecon = {
    url: page.url(),
    elements: await page.$$eval('h1, h2, h3, button, th', els =>
      Array.from(new Set(els.map(e => e.textContent?.trim().replace(/\s+/g, ' ') || '').filter(Boolean)))
    ),
    tableHeaders: await page.$$eval('table th', ths => ths.map(t => t.textContent?.trim() || '').filter(Boolean)),
    totalRows: await page.locator('table tbody tr').count()
  };

  // 6. Settings Page & Organizations (Check Riverstone Org settings!)
  console.log('\n--- 6. Discovering Settings Page ---');
  await page.goto('/settings', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(3000);
  discovery.settings = {
    url: page.url(),
    elements: await page.$$eval('h1, h2, h3, button, a, label, [role="tab"]', els =>
      Array.from(new Set(els.map(e => e.textContent?.trim().replace(/\s+/g, ' ') || '').filter(t => t.length > 0 && t.length < 80)))
    )
  };

  // Click Organizations in Settings to see Riverstone Organization settings
  const orgTab = page.locator('button:has-text("Organizations"), [role="tab"]:has-text("Organizations")').first();
  if (await orgTab.isVisible({ timeout: 5000 }).catch(() => false)) {
    await orgTab.click();
    await page.waitForTimeout(2000);
    discovery.settingsOrganizations = {
      elements: await page.$$eval('table, tr, td, h3, h4, button', els =>
        Array.from(new Set(els.map(e => e.textContent?.trim().replace(/\s+/g, ' ') || '').filter(t => t.length > 2 && t.length < 100)))
      )
    };
  }

  fs.writeFileSync('ui_discovery_report.json', JSON.stringify(discovery, null, 2));
  console.log('\n>>> Complete UI Discovery finished! Written to ui_discovery_report.json <<<');

  await browser.close();
}

discoverUI().catch(console.error);
