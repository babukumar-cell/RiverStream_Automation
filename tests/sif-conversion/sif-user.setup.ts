import fs from 'fs';
import path from 'path';
import { test as setup, expect } from '@playwright/test';
import { LoginPage } from '../../src/pages/login.page';
import { ORG_USER, SIF_USER_STATE } from './support/sif-data';

/**
 * Logs in once as the user of the organization Testing (the SIF Conversion suite runs as this user)
 * and saves the session to .auth/sif-user.json.
 */
setup('authenticate as the Testing organization user', async ({ page }) => {
  const login = new LoginPage(page);
  await login.navigate();
  await login.login(ORG_USER.email, ORG_USER.password);
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30000 });

  fs.mkdirSync(path.dirname(SIF_USER_STATE), { recursive: true });
  const tmp = `${SIF_USER_STATE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(await page.context().storageState(), null, 2));
  fs.renameSync(tmp, SIF_USER_STATE);
});
