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

  // Search and open CKNS Enterprise
  const searchInput = page.locator('input[placeholder*="Search projects" i]').first();
  await searchInput.fill('CKNS');
  await page.waitForTimeout(1500);
  await page.locator('table tbody tr:has-text("CKNS Enterprise") td:first-child').first().click();
  await page.waitForTimeout(3000);

  // Click Review on 2506612 (Awaiting ACK)
  const awaitingRow = page.locator('table tbody tr:has-text("Awaiting ACK")').first();
  await awaitingRow.locator('button:has-text("Review")').click();
  
  // Wait until loading is detached
  await page.locator(':text("Loading...")').waitFor({ state: 'detached', timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2000);

  const bodyText = await page.locator('body').innerText();
  console.log('Snippet of Review after loading:');
  console.log(bodyText.split('\n').filter(l => l.trim()).slice(5, 30));

  await browser.close();
})();
