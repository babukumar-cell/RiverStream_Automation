import { chromium } from '@playwright/test';
import * as fs from 'fs';

async function inspectModal() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  console.log('Logging in...');
  await page.goto('https://riverstream-qa.azurewebsites.net/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[name="email"], input[type="email"]');
  await page.fill('input[name="email"], input[type="email"]', 'admin@riverstonetech.com');
  await page.fill('input[name="password"], input[type="password"]', 'River@123');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/documents**', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);

  console.log('Navigating to /organizations...');
  await page.goto('https://riverstream-qa.azurewebsites.net/organizations', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  const addBtn = page.locator('button:has-text("Add Organization")');
  console.log('Add Org button visible:', await addBtn.isVisible());
  await addBtn.click();
  await page.waitForTimeout(2000);

  await page.screenshot({ path: 'scratch/create_org_modal.png', fullPage: true });

  const modal = page.locator('[role="dialog"]');
  if (await modal.isVisible()) {
    const text = await modal.innerText();
    console.log('Modal InnerText:\n', text);
    const html = await modal.innerHTML();
    fs.writeFileSync('scratch/create_org_modal.html', html);
  } else {
    console.log('Modal not found by [role="dialog"]');
  }

  await browser.close();
}

inspectModal().catch(console.error);
