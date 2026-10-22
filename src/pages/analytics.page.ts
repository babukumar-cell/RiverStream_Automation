import { Page } from '@playwright/test';
import { BasePage } from './base.page';

/** Analytics module (/analytics). */
export class AnalyticsPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  async navigate(): Promise<void> {
    await this.navigateTo('/analytics');
    await this.waitForLoaded();
  }
}
