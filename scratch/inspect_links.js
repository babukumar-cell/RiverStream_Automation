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

  // Print all links and buttons on Dashboard
  const dashboardReviewLinks = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a, button')).filter(el => el.textContent.includes('Review')).map(el => ({
      tag: el.tagName,
      text: el.textContent.trim(),
      href: el.getAttribute('href'),
      class: el.className
    }));
  });
  console.log('--- DASHBOARD REVIEW LINKS ---', dashboardReviewLinks);

  // If there are links with href, check their hrefs
  const allLinks = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a[href]')).map(a => a.getAttribute('href'));
  });
  console.log('--- ALL DASHBOARD LINKS ---', allLinks.filter(l => l && !l.startsWith('#')));

  // Let's also check documents table on /documents: what happens when clicking Review button on row 2 or 4?
  await page.goto('https://riverstream-qa.azurewebsites.net/documents');
  await page.waitForTimeout(3000);
  const docReviewLinks = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a, button')).filter(el => el.textContent.includes('Review')).map(el => ({
      tag: el.tagName,
      text: el.textContent.trim(),
      href: el.getAttribute('href'),
      class: el.className
    }));
  });
  console.log('--- DOCUMENTS PAGE REVIEW BUTTONS/LINKS ---', docReviewLinks.slice(0, 5));

  await browser.close();
})();
