const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://riverstream-qa.azurewebsites.net/');
  await page.waitForLoadState('networkidle');
  await page.locator('input[type="email"], #email').first().fill('admin@riverstonetech.com');
  await page.locator('input[type="password"], #password').first().fill('River@123');
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL('**/dashboard', { timeout: 20000 });
  await page.goto('https://riverstream-qa.azurewebsites.net/po-ack-recon');
  await page.waitForTimeout(4000);

  const searchInput = page.locator('input[placeholder*="Search projects" i]').first();
  await searchInput.fill('CKNS');
  await page.waitForTimeout(1500);
  console.log('Search CKNS results:', await page.locator('table tbody tr').allInnerTexts());

  await searchInput.fill('ABC');
  await page.waitForTimeout(1500);
  console.log('Search ABC results:', await page.locator('table tbody tr').allInnerTexts());

  await searchInput.fill('');
  await page.waitForTimeout(1500);
  console.log('Clear search results:', (await page.locator('table tbody tr').allInnerTexts()).length);

  await browser.close();
})();
