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

  // Open CKNS Enterprise
  const searchInput = page.locator('input[placeholder*="Search projects" i]').first();
  await searchInput.fill('CKNS');
  await page.waitForTimeout(1500);
  await page.locator('table tbody tr:has-text("CKNS Enterprise") td:first-child').first().click();
  await page.waitForTimeout(3000);

  console.log('--- CKNS DOCS ---');
  const cknsDocs = await page.locator('table tbody tr').allInnerTexts();
  cknsDocs.forEach((d, i) => console.log(i + ': ' + d.replace(/\n/g, ' | ')));

  const buttons = await page.locator('button').allInnerTexts();
  console.log('--- ALL BUTTONS ON CKNS DOCS PAGE ---');
  console.log(buttons.filter(b => b.trim().length > 0));

  await browser.close();
})();
