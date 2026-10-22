import fs from 'fs';
import path from 'path';
import { test as setup, expect } from '@playwright/test';
import { Config } from '../src/config/environment';
import { LoginPage } from '../src/pages/login.page';

/**
 * Logs in once as the admin user and saves the session for every other test.
 * Tests that need a logged-out browser opt out with:
 *   test.use({ storageState: { cookies: [], origins: [] } });
 */
setup('authenticate as admin', async ({ page }) => {
  const loginPage = new LoginPage(page);
  await loginPage.navigate();
  await loginPage.login(Config.adminEmail, Config.adminPassword);
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30000 });

  // Write atomically so concurrent runs never read a half-written file.
  const target = Config.adminStorageState;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(await page.context().storageState(), null, 2));
  fs.renameSync(tmp, target);
});
