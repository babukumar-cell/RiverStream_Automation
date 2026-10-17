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

  // Search and open Tech_Soluton
  const searchInput = page.locator('input[placeholder*="Search projects" i]').first();
  await searchInput.fill('Tech_Soluton');
  await page.waitForTimeout(1500);
  await page.locator('table tbody tr:has-text("Tech_Soluton") td:first-child').first().click();
  await page.waitForTimeout(3000);

  // Click Review on first doc
  await page.locator('table tbody tr button:has-text("Review")').first().click();
  await page.locator(':text("Loading...")').waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2000);

  // Find the flag inside the Address 1 yellow container
  const flagDetails = await page.evaluate(() => {
    // Find all yellow containers
    const yellow = Array.from(document.querySelectorAll('*')).filter(el => {
      const cls = el.className || '';
      return typeof cls === 'string' && (cls.includes('yellow') || cls.includes('amber'));
    });

    const results = [];
    yellow.forEach(y => {
      // Find any children inside y
      const svgs = y.querySelectorAll('svg');
      const buttons = y.querySelectorAll('button');
      const imgs = y.querySelectorAll('img');
      const icons = y.querySelectorAll('[class*="icon"], [class*="flag"]');
      results.push({
        boxText: y.innerText,
        boxClass: y.className,
        svgCount: svgs.length,
        svgHTML: Array.from(svgs).map(s => s.outerHTML),
        btnHTML: Array.from(buttons).map(b => b.outerHTML),
        imgHTML: Array.from(imgs).map(i => i.outerHTML),
        iconHTML: Array.from(icons).map(i => i.outerHTML),
        fullHTML: y.outerHTML
      });
    });
    return results;
  });

  console.log('Yellow box count:', flagDetails.length);
  if (flagDetails.length > 0) {
    console.log('First box details:');
    console.log('Class:', flagDetails[0].boxClass);
    console.log('Text:', flagDetails[0].boxText);
    console.log('SVGs:', flagDetails[0].svgHTML);
    console.log('Buttons:', flagDetails[0].btnHTML);
    console.log('Full HTML:', flagDetails[0].fullHTML);
  }

  await browser.close();
})();
