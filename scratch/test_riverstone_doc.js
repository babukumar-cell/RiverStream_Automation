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

  // Filter Organization to Riverstonetech
  const orgBtn = page.locator('button:has-text("All Organizations"), button:has-text("Organization")').first();
  if (await orgBtn.isVisible().catch(() => false)) {
    await orgBtn.click();
    await page.waitForTimeout(500);
    const riverstoneOption = page.locator('[role="option"]:has-text("Riverstonetech"), [role="menuitem"]:has-text("Riverstonetech"), li:has-text("Riverstonetech")').first();
    if (await riverstoneOption.isVisible().catch(() => false)) {
      await riverstoneOption.click();
      await page.waitForTimeout(1500);
    }
  }

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

  const rows = await page.locator('table tbody tr').allInnerTexts();
  console.log('--- RIVERSTONETECH PDF DOCUMENTS ---');
  rows.forEach((r, i) => console.log(i + ': ' + r.replace(/\n/g, ' | ')));

  // Click Review on first row
  const reviewBtn = page.locator('table tbody tr button:has-text("Review")').first();
  await reviewBtn.click();
  await page.waitForURL('**/review/**', { timeout: 15000 }).catch(() => {});

  const loading = page.locator(':text("Loading document..."), :text("Loading...")').first();
  await loading.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3000);

  await page.screenshot({ path: 'scratch/riverstone_pdf_review.png' });
  console.log('Saved scratch/riverstone_pdf_review.png');

  // Check Address swap button, Order Line Items, Expand icon, Edit All, etc.
  const pageDetails = await page.evaluate(() => {
    return {
      buttons: Array.from(document.querySelectorAll('button')).map(b => b.innerText.trim() || b.getAttribute('aria-label') || b.className).filter(Boolean),
      sourceLinks: Array.from(document.querySelectorAll('*')).filter(el => el.textContent.includes('Source:')).map(el => el.innerText.trim()),
      confidenceScores: Array.from(document.querySelectorAll('*')).filter(el => el.children.length === 0 && el.textContent.match(/^\d+%/)).map(el => el.textContent.trim()),
      h2: Array.from(document.querySelectorAll('h2, h3, h4')).map(h => h.innerText.trim()),
      tables: document.querySelectorAll('table').length
    };
  });
  console.log('Page details:', pageDetails);

  await browser.close();
})();
