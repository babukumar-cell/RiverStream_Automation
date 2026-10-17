const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://riverstream-qa.azurewebsites.net/');
  await page.waitForLoadState('networkidle');
  
  await page.locator('input[type="email"], input[name="email"], #email').first().fill('admin@riverstonetech.com');
  await page.locator('input[type="password"], input[name="password"], #password').first().fill('River@123');
  await page.locator('button:has-text("Sign in"), button:has-text("Sign In"), button[type="submit"]').first().click();
  await page.waitForURL('**/dashboard', { timeout: 20000 });

  await page.goto('https://riverstream-qa.azurewebsites.net/po-ack-recon');
  await page.waitForTimeout(4000);

  // Click on Tech_Soluton
  const techRow = page.locator('table tbody tr:has-text("Tech_Soluton") td:first-child').first();
  await techRow.click();
  await page.waitForTimeout(3000);

  // Check breadcrumb element tags and classes
  const breadcrumbElements = await page.evaluate(() => {
    const matches = [];
    const all = document.querySelectorAll('*');
    for (const node of all) {
      if (node.children.length === 0 && (node.textContent.includes('PO-ACK Recon') || node.textContent.includes('Tech_Soluton'))) {
        matches.push({
          tag: node.tagName,
          text: node.textContent,
          classes: node.className,
          parentTag: node.parentElement ? node.parentElement.tagName : null,
          parentClasses: node.parentElement ? node.parentElement.className : null,
          grandparentHTML: node.parentElement && node.parentElement.parentElement ? node.parentElement.parentElement.outerHTML.slice(0, 400) : null
        });
      }
    }
    return matches;
  });
  console.log('\n--- BREADCRUMB NODES IN DOCS PAGE ---');
  console.log(JSON.stringify(breadcrumbElements, null, 2));

  // Click Review on first doc
  await page.locator('table tbody tr button:has-text("Review")').first().click();
  await page.waitForTimeout(3000);

  const revBreadcrumbElements = await page.evaluate(() => {
    const matches = [];
    const all = document.querySelectorAll('*');
    for (const node of all) {
      if (node.children.length === 0 && (node.textContent.includes('PO-ACK Recon') || node.textContent.includes('Tech_Soluton') || node.textContent.includes('59544-119559'))) {
        matches.push({
          tag: node.tagName,
          text: node.textContent,
          classes: node.className,
          parentTag: node.parentElement ? node.parentElement.tagName : null,
          parentClasses: node.parentElement ? node.parentElement.className : null,
          grandparentHTML: node.parentElement && node.parentElement.parentElement ? node.parentElement.parentElement.outerHTML.slice(0, 400) : null
        });
      }
    }
    return matches;
  });
  console.log('\n--- BREADCRUMB NODES IN REVIEW PAGE ---');
  console.log(JSON.stringify(revBreadcrumbElements, null, 2));

  await browser.close();
})();
