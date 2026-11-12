import { Locator } from '@playwright/test';

/**
 * Returns true if the locator becomes visible within `timeout` ms, false otherwise. Never throws.
 *
 * Use this instead of `locator.isVisible({ timeout })`: Playwright ignores that timeout option,
 * so `isVisible()` checks once, immediately. Right after a click or navigation that check runs
 * before the UI has rendered, which silently skips `if (...)` branches and makes evidence
 * screenshots capture the page before the expected state appears.
 */
export async function isVisibleWithin(locator: Locator, timeout = 5000): Promise<boolean> {
  return locator.waitFor({ state: 'visible', timeout }).then(
    () => true,
    () => false,
  );
}
