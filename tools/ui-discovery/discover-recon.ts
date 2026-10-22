import { chromium } from '@playwright/test';
import { Config } from '../../src/config/environment';

async function inspectReconPage() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  console.log('Navigating to login...');
  await page.goto(Config.baseUrl);
  await page.fill('input[type="email"]', Config.adminEmail);
  await page.fill('input[type="password"]', Config.adminPassword);
  await page.click('button:has-text("Sign in")');
  await page.waitForURL('**/dashboard**', { timeout: 25000 }).catch(() => {});

  console.log('Navigating to /po-ack-recon...');
  const reconLink = page.locator('aside a[href*="po-ack-recon"], aside button:has-text("PO-ACK Recon"), a:has-text("PO-ACK Recon")').first();
  if (await reconLink.isVisible({ timeout: 5000 }).catch(() => false)) {
    await reconLink.click();
  } else {
    await page.goto(`${Config.baseUrl}po-ack-recon`);
  }
  await page.waitForURL('**/po-ack-recon**', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);

  await page.screenshot({ path: 'test-results/recon-projects-page.png' });
  console.log('Captured test-results/recon-projects-page.png');

  // Check headers and rows
  const headers = await page.locator('table th').allInnerTexts().catch(() => []);
  console.log('Table headers:', headers);

  const rowCount = await page.locator('table tbody tr').count().catch(() => 0);
  console.log('Row count:', rowCount);

  if (rowCount > 0) {
    const firstRowText = await page.locator('table tbody tr').first().innerText();
    console.log('First row text:', firstRowText);

    // Let's click the first project to see what the Documents list page looks like!
    console.log('Clicking first project...');
    const firstProjectLink = page.locator('table tbody tr a, table tbody tr td:first-child').first();
    await firstProjectLink.click();
    await page.waitForTimeout(2000);
    console.log('URL after clicking project:', page.url());

    await page.screenshot({ path: 'test-results/recon-project-docs.png' });
    console.log('Captured test-results/recon-project-docs.png');

    const docHeaders = await page.locator('table th').allInnerTexts().catch(() => []);
    console.log('Doc table headers:', docHeaders);

    const docRowCount = await page.locator('table tbody tr').count().catch(() => 0);
    console.log('Doc row count:', docRowCount);

    const filterButtons = await page.locator('button').allInnerTexts().catch(() => []);
    console.log('Sample buttons visible:', filterButtons.slice(0, 15));

    const breadcrumbs = await page.locator('nav, ol, [aria-label*="breadcrumb" i]').allInnerTexts().catch(() => []);
    console.log('Breadcrumbs:', breadcrumbs);
  }

  await browser.close();
}

inspectReconPage().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
