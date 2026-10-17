import { Page, Locator, expect } from '@playwright/test';

export abstract class BasePage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Navigate to a relative or absolute URL
   */
  async navigateTo(path: string = ''): Promise<void> {
    try {
      await this.page.goto(path, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (err: any) {
      if (err.message && (err.message.includes('ERR_ABORTED') || err.message.includes('detached'))) {
        await this.page.waitForTimeout(1000);
        await this.page.goto(path, { waitUntil: 'domcontentloaded', timeout: 30000 });
      } else {
        throw err;
      }
    }
  }

  /**
   * Wait for an element to be visible
   */
  async waitForVisible(locator: Locator, timeout: number = 10000): Promise<void> {
    await locator.waitFor({ state: 'visible', timeout });
  }

  /**
   * Safe text retrieval from locator
   */
  async getElementText(locator: Locator): Promise<string> {
    await this.waitForVisible(locator);
    return (await locator.textContent())?.trim() || '';
  }

  /**
   * Take screenshot on demand
   */
  async takeScreenshot(name: string): Promise<void> {
    await this.page.screenshot({ path: `test-results/screenshots/${name}-${Date.now()}.png`, fullPage: true });
  }

  /**
   * Get page current URL
   */
  getCurrentUrl(): string {
    return this.page.url();
  }

  /**
   * Get page title
   */
  async getTitle(): Promise<string> {
    return await this.page.title();
  }
}
