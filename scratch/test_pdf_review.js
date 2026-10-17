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

  // Filter by PDF format
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

  // Click Review on the first visible PDF row
  const firstReviewBtn = page.locator('table tbody tr button:has-text("Review")').first();
  await firstReviewBtn.click();

  await page.waitForURL('**/review/**', { timeout: 15000 }).catch(() => {});
  console.log('Current URL:', page.url());

  // Wait for loading document spinner to disappear
  const loading = page.locator(':text("Loading document..."), :text("Loading...")').first();
  await loading.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3000);

  await page.screenshot({ path: 'scratch/pdf_review_loaded.png' });
  console.log('Screenshot saved to scratch/pdf_review_loaded.png');

  // Print buttons and interactive elements
  const allBtns = await page.locator('button').allInnerTexts();
  console.log('Buttons on loaded PDF review:', allBtns.filter(b => b.trim().length > 0));

  // Check PDF viewer elements
  const viewerInfo = await page.evaluate(() => {
    return {
      canvases: document.querySelectorAll('canvas').length,
      embeds: document.querySelectorAll('embed').length,
      iframes: document.querySelectorAll('iframe').length,
      tables: document.querySelectorAll('table').length,
      h2: Array.from(document.querySelectorAll('h2, h3')).map(h => h.innerText.trim()).filter(Boolean),
      inputs: document.querySelectorAll('input').length,
      tabs: Array.from(document.querySelectorAll('[role="tab"], button[role="tab"]')).map(t => t.innerText.trim()).filter(Boolean)
    };
  });
  console.log('Viewer Info:', viewerInfo);

  await browser.close();
})();
