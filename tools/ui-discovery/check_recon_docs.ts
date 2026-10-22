import { chromium } from '@playwright/test';
import { LoginPage } from '../../src/pages/login.page';
import { DashboardPage } from '../../src/pages/dashboard.page';
import { PoAckReconPage } from '../../src/pages/po-ack-recon.page';
import { Config } from '../../src/config/environment';

async function checkProjects() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ baseURL: Config.baseUrl, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const loginPage = new LoginPage(page);
  const dashboardPage = new DashboardPage(page);
  const reconPage = new PoAckReconPage(page);

  console.log('Logging in via LoginPage...');
  await loginPage.navigate();
  await loginPage.login(Config.adminEmail, Config.adminPassword);
  await dashboardPage.isDashboardLoaded();

  console.log('Navigating to PO-ACK Recon...');
  await reconPage.navigate();

  const projectNames = await reconPage.getVisibleProjectNames();
  console.log(`Discovered ${projectNames.length} projects:`, projectNames);

  for (const name of projectNames) {
    if (!page.url().includes('/po-ack-recon')) {
      await reconPage.navigate();
    } else if (page.url().match(/\/po-ack-recon\/[a-zA-Z0-9_-]+/)) {
      await page.goto(`${Config.baseUrl}po-ack-recon`);
      await reconPage.waitForProjectsLoaded();
    }

    console.log(`\nInspecting project: "${name}"...`);
    await reconPage.openProject(name);
    await page.waitForTimeout(2000);

    const docRows = page.locator('table tbody tr');
    const docCount = await docRows.count();
    const emptyMsg = page.locator('text=/No PO acknowledgement|No documents|No records/i');
    const isEmpty = await emptyMsg.isVisible().catch(() => false);
    console.log(`-> Project "${name}": ${isEmpty ? '0 documents (Empty)' : `${docCount} documents`}`);

    if (!isEmpty && docCount > 0) {
      for (let j = 0; j < Math.min(docCount, 3); j++) {
        const text = (await docRows.nth(j).innerText()).replace(/\n/g, ' | ');
        console.log(`   Doc [${j}]: ${text}`);
      }
      await page.screenshot({ path: `test-results/project-${name.replace(/[^a-zA-Z0-9]/g, '_')}-docs.png` });
    }
  }

  await browser.close();
}

checkProjects().catch(err => {
  console.error('Error in checkProjects:', err);
  process.exit(1);
});
