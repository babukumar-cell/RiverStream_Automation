import { test as setup } from '@playwright/test';
import { prepareSifUser } from './support/sif-user';

/**
 * Prepares the SIF Conversion suite's user (riverstreamautomation@gmail.com) and its organization, switches the
 * organization's SIF Conversion ON if it is off, signs the user in and saves the session to .auth/sif-user.json
 * (see support/sif-user.ts).
 */
setup('prepare the SIF Conversion user and organization', async ({ browser }) => {
  setup.setTimeout(30 * 60_000);
  await prepareSifUser(browser);
});
