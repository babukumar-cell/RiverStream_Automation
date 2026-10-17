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

  await page.goto('https://riverstream-qa.azurewebsites.net/documents');
  await page.waitForTimeout(3000);

  // Filter format to PDF
  const filterBtn = page.locator('button:has-text("Filters")').first();
  if (await filterBtn.isVisible().catch(() => false)) {
    await filterBtn.click();
    await page.waitForTimeout(500);
  }
  const pdfFormatBtn = page.locator('button:has-text("PDF")').first();
  if (await pdfFormatBtn.isVisible().catch(() => false)) {
    await pdfFormatBtn.click();
    await page.waitForTimeout(500);
    const applyBtn = page.locator('button:has-text("Apply")').first();
    if (await applyBtn.isVisible().catch(() => false)) {
      await applyBtn.click();
      await page.waitForTimeout(2000);
    }
  }

  // Click Review on BH12415CD
  const reviewBtn = page.locator('table tbody tr:has-text("BH12415CD") button:has-text("Review")').first();
  await reviewBtn.click();
  await page.waitForURL('**/review/**', { timeout: 15000 }).catch(() => {});

  const loading = page.locator(':text("Loading document..."), :text("Loading...")').first();
  await loading.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3000);

  // Click expand icon on Order Line Items
  const expandBtn = page.locator('div:has-text("Order Line Items") button:has(svg), div:has-text("Order Line Items") svg, [aria-label*="expand" i]').last();
  await expandBtn.click();
  await page.waitForTimeout(1000);

  // Click Edit All
  const editAllBtn = page.locator('button:has-text("Edit All")').first();
  await editAllBtn.click();
  await page.waitForTimeout(1000);

  // Check what buttons and inputs appeared
  const afterEditAll = await page.evaluate(() => {
    return {
      buttons: Array.from(document.querySelectorAll('button')).map(b => b.innerText.trim()).filter(Boolean),
      inputs: document.querySelectorAll('input').length,
      firstRowInputs: Array.from(document.querySelectorAll('tbody tr:first-child input')).map(i => i.value)
    };
  });
  console.log('After clicking Edit All:', JSON.stringify(afterEditAll, null, 2));

  await browser.close();
})();
