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

  // Click Review on doc with 2 versions
  const doc2 = page.locator('table tbody tr:has-text("2 versions")').first();
  await doc2.locator('button:has-text("Review")').click();
  await page.locator(':text("Loading...")').waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2000);

  const ackBtn = page.locator('main button:has-text("ACK 1"), main button:has-text("ACK 2")').first();
  await ackBtn.click();
  await page.waitForTimeout(1000);

  // Check what nodes appeared with ACK in text
  const ackElements = await page.evaluate(() => {
    const list = [];
    document.querySelectorAll('*').forEach(el => {
      if (el.children.length === 0 && (el.textContent.includes('ACK 1') || el.textContent.includes('ACK 2'))) {
        list.push({
          tag: el.tagName,
          text: el.textContent,
          classes: el.className,
          parent: el.parentElement ? el.parentElement.tagName : null
        });
      }
    });
    return list;
  });
  console.log('ACK elements after click:', JSON.stringify(ackElements, null, 2));

  await browser.close();
})();
