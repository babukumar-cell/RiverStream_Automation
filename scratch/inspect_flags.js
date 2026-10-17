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

  // Click Tech_Soluton
  const techRow = page.locator('table tbody tr:has-text("Tech_Soluton") td:first-child').first();
  await techRow.click();
  await page.waitForTimeout(3000);

  // Click Review on first doc
  await page.locator('table tbody tr button:has-text("Review")').first().click();
  await page.locator(':text("Loading...")').waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2000);

  // Find all elements with yellow background or discrepancy
  const yellowBoxes = await page.evaluate(() => {
    const list = [];
    document.querySelectorAll('*').forEach(el => {
      const cls = el.className || '';
      if (typeof cls === 'string' && (cls.includes('yellow') || cls.includes('amber'))) {
        list.push({
          tag: el.tagName,
          classes: cls,
          text: el.innerText.slice(0, 100),
          html: el.innerHTML.slice(0, 300)
        });
      }
    });
    return list;
  });
  console.log('Yellow / Discrepancy boxes count:', yellowBoxes.length);
  if (yellowBoxes.length > 0) {
    console.log('First 2 yellow boxes:', JSON.stringify(yellowBoxes.slice(0, 2), null, 2));
  }

  await browser.close();
})();
