import { chromium } from '@playwright/test';
import { LoginPage } from '../../src/pages/login.page';
import { DashboardPage } from '../../src/pages/dashboard.page';
import { PoAckReconPage } from '../../src/pages/po-ack-recon.page';
import { Config } from '../../src/config/environment';

async function checkReviewPage() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ baseURL: Config.baseUrl, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const loginPage = new LoginPage(page);
  const dashboardPage = new DashboardPage(page);
  const reconPage = new PoAckReconPage(page);

  await loginPage.navigate();
  await loginPage.login(Config.adminEmail, Config.adminPassword);
  await dashboardPage.isDashboardLoaded();

  await reconPage.navigate();
  await reconPage.openProject('Tech_Soluton');
  await page.waitForTimeout(2000);

  // Click Review on the second document (2 versions)
  console.log('Clicking Review on document in Tech_Soluton...');
  const reviewBtn = page.locator('table tbody tr').nth(1).locator('button:has-text("Review")');
  await reviewBtn.click();
  await page.waitForTimeout(3000);

  console.log('Current Review URL:', page.url());
  await page.screenshot({ path: 'test-results/recon-review-page.png' });
  console.log('Captured test-results/recon-review-page.png');

  // Breadcrumbs
  const breadcrumb = await page.locator('nav, ol, [aria-label*="breadcrumb" i], :text("PO-ACK Recon")').first().innerText().catch(() => '');
  console.log('Review breadcrumb:', breadcrumb.replace(/\n/g, ' '));

  // Buttons on review page
  const buttons = await page.locator('button').allInnerTexts().catch(() => []);
  console.log('Buttons on review page:', buttons);

  // Check ACK dropdown
  const ackDropdown = page.locator('button:has-text("ACK"), select, [role="combobox"]').first();
  console.log('ACK dropdown visible:', await ackDropdown.isVisible().catch(() => false));

  // Check Complete button
  const completeBtn = page.locator('button:has-text("Complete")').first();
  console.log('Complete button visible:', await completeBtn.isVisible().catch(() => false));
  console.log('Complete button enabled:', await completeBtn.isEnabled().catch(() => false));

  // Check line items or discrepancy fields
  const discrepancyElements = page.locator('.bg-yellow-100, .bg-yellow-200, .bg-amber-100, [class*="yellow"], [class*="amber"], [class*="discrepancy"]');
  console.log('Discrepancy count:', await discrepancyElements.count().catch(() => 0));

  await browser.close();
}

checkReviewPage().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
