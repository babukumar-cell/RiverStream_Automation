import { chromium } from '@playwright/test';
import dotenv from 'dotenv';
dotenv.config();

async function inspect() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  console.log('Navigating to', process.env.BASE_URL);
  await page.goto(process.env.BASE_URL || 'https://riverstream-qa.azurewebsites.net/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  
  await page.fill('input[type="email"], input[name="email"], input[placeholder*="email" i]', process.env.ADMIN_EMAIL!);
  await page.fill('input[type="password"], input[name="password"], input[placeholder*="password" i]', process.env.ADMIN_PASSWORD!);
  await page.click('button:has-text("Sign in"), button:has-text("Sign In"), button[type="submit"]');
  
  await page.waitForTimeout(5000);
  console.log('Current URL after login:', page.url());
  
  // Find all sidebar links and buttons
  const links = await page.$$eval('a, button, [role="button"]', elements => 
    elements.map(el => ({
      text: el.textContent?.trim().replace(/\s+/g, ' ') || '',
      href: el.getAttribute('href') || '',
      role: el.getAttribute('role') || el.tagName.toLowerCase()
    })).filter(x => x.text.length > 0 && x.text.length < 50)
  );
  
  // Inspect PO-ACK Recon page
  console.log('\n--- Clicking PO-ACK Recon button ---');
  await page.click('button:has-text("PO-ACK Recon"), a:has-text("PO-ACK Recon")');
  await page.waitForTimeout(3000);
  console.log('URL after PO-ACK Recon click:', page.url());
  const reconElements = await page.$$eval('a, button, [role="button"], [role="tab"], h1, h2, h3, input, table, th', els =>
    els.map(el => ({ tag: el.tagName.toLowerCase(), text: el.textContent?.trim().replace(/\s+/g, ' ') || '', placeholder: el.getAttribute('placeholder') || '' }))
       .filter(x => (x.text && x.text.length < 50) || x.placeholder)
  );
  console.log('PO-ACK Recon page elements:', JSON.stringify(reconElements.slice(0, 30), null, 2));

  // Click New Project button and inspect modal
  console.log('\n--- Clicking New Project button ---');
  await page.click('button:has-text("New Project")');
  await page.waitForTimeout(2000);
  const modalElements = await page.$$eval('[role="dialog"], .modal, div:has(input)', els =>
    els.map(el => ({
      text: el.textContent?.trim().replace(/\s+/g, ' ') || '',
      inputs: Array.from(el.querySelectorAll('input')).map(i => ({ name: i.name, placeholder: i.placeholder, id: i.id }))
    })).filter(x => x.text.length < 200 && x.text.length > 0)
  );
  console.log('Modal elements:', JSON.stringify(modalElements, null, 2));

  // Check buttons inside dialog
  const dialogButtons = await page.$$eval('[role="dialog"] button, .modal button, form button', btns =>
    btns.map(b => b.textContent?.trim() || '')
  );
  console.log('Dialog buttons:', dialogButtons);

  // Inspect Settings page
  console.log('\n--- Clicking Settings button ---');
  await page.click('button:has-text("Settings")');
  await page.waitForTimeout(3000);
  console.log('URL after Settings click:', page.url());
  const settingsElements = await page.$$eval('a, button, [role="button"], [role="tab"], h1, h2, h3, label', els =>
    els.map(el => el.textContent?.trim().replace(/\s+/g, ' ') || '').filter(t => t.length > 0 && t.length < 50)
  );
  console.log('Settings page elements:', settingsElements);
  
  await browser.close();
}

inspect().catch(console.error);
