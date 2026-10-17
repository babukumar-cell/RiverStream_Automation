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

  // Search or click on the PDF row
  const pdfRow = page.locator('table tbody tr:has-text(".pdf")').first();
  await pdfRow.locator('button:has-text("Review")').click();

  await page.waitForTimeout(4000);
  console.log('--- PDF REVIEW PAGE URL ---', page.url());

  const loading = page.locator(':text("Loading...")').first();
  await loading.waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2000);

  // Take screenshot
  await page.screenshot({ path: 'scratch/pdf_review_ui.png' });
  console.log('Screenshot saved to scratch/pdf_review_ui.png');

  // Print all buttons on the page
  const buttons = await page.locator('button').allInnerTexts();
  console.log('--- BUTTONS ---');
  console.log(buttons.filter(b => b.trim().length > 0));

  // Check PDF viewer elements
  const pdfElements = await page.evaluate(() => {
    return {
      canvas: document.querySelectorAll('canvas').length,
      embed: document.querySelectorAll('embed').length,
      iframe: document.querySelectorAll('iframe').length,
      pdfViewer: document.querySelectorAll('.pdf-viewer, [class*="pdf"]').length,
      pages: Array.from(document.querySelectorAll('*')).filter(el => el.textContent.includes('Page') && el.children.length === 0).map(el => el.textContent.trim()),
      zoomButtons: Array.from(document.querySelectorAll('button')).filter(b => b.getAttribute('aria-label')?.includes('zoom') || b.innerText.includes('+') || b.innerText.includes('-')).map(b => b.outerHTML.slice(0, 100))
    };
  });
  console.log('--- PDF ELEMENTS ---', pdfElements);

  // Check Order Line Items table and elements
  const orderLineItems = await page.evaluate(() => {
    const list = [];
    document.querySelectorAll('*').forEach(el => {
      if (el.textContent.includes('Line Item') || el.textContent.includes('Order line item')) {
        list.push(el.outerHTML.slice(0, 200));
      }
    });
    return list.slice(0, 3);
  });
  console.log('--- ORDER LINE ITEMS ELEMENTS ---', orderLineItems);

  await browser.close();
})();
