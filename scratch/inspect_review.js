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

  // Click on Tech_Soluton
  const techRow = page.locator('table tbody tr:has-text("Tech_Soluton") td:first-child').first();
  await techRow.click();
  await page.waitForTimeout(3000);

  // Click Review
  await page.locator('table tbody tr button:has-text("Review")').first().click();
  await page.waitForTimeout(3000);

  // Search for yellow or discrepancy text
  const bodyText = await page.locator('body').innerText();
  console.log('Includes "Fields highlighted":', bodyText.includes('Fields highlighted'));
  console.log('Includes "yellow":', bodyText.includes('yellow'));
  console.log('Includes "discrepanc":', bodyText.includes('discrepanc'));

  // Also check Line Items table or buttons
  const buttons = await page.locator('button').allInnerTexts();
  console.log('Review page buttons:', buttons.filter(b => b.trim().length > 0));

  await browser.close();
})();
