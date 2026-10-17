import { chromium } from '@playwright/test';
import dotenv from 'dotenv';
dotenv.config();

async function testCreateProject() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  page.on('response', resp => {
    if (resp.url().includes('project') || resp.status() >= 400) {
      console.log(`[HTTP ${resp.status()}] ${resp.request().method()} ${resp.url()}`);
    }
  });

  await page.goto(process.env.BASE_URL || 'https://riverstream.azurewebsites.net/', { waitUntil: 'domcontentloaded' });
  await page.fill('input[type="email"]', process.env.ADMIN_EMAIL || 'admin@riverstonetech.com');
  await page.fill('input[type="password"]', process.env.ADMIN_PASSWORD || 'River@123');
  await page.click('button:has-text("Sign in")');
  await page.waitForURL('**/dashboard', { timeout: 20000 });

  await page.goto('https://riverstream.azurewebsites.net/po-ack-recon', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  console.log('Clicking New Project button...');
  await page.click('button:has-text("New Project")');
  await page.waitForSelector('[role="dialog"]');

  const projectName = `TestProj_${Date.now()}`;
  console.log('Filling Project Name:', projectName);
  await page.fill('[role="dialog"] input[placeholder*="Enter project name" i]', projectName);
  await page.fill('[role="dialog"] input[placeholder*="Enter location" i]', 'Atlanta Office');
  await page.fill('[role="dialog"] textarea', 'Test Description');

  console.log('Clicking Create button...');
  const [response] = await Promise.all([
    page.waitForResponse(resp => resp.url().includes('project') || resp.request().method() === 'POST', { timeout: 15000 }).catch(() => null),
    page.click('[role="dialog"] button:has-text("Create")')
  ]);

  if (response) {
    console.log('Create Project API Response:', response.status(), await response.text().catch(() => ''));
  } else {
    console.log('No response intercepted.');
  }

  await page.waitForTimeout(3000);
  const rows = await page.$$eval('table tbody tr', trs => trs.map(tr => tr.textContent?.trim().replace(/\s+/g, ' ')));
  console.log('Table rows after creation:', rows);

  await browser.close();
}

testCreateProject().catch(console.error);
