import { Page, Locator } from '@playwright/test';
import { BasePage } from './base.page';

/** Clients module (/clients). */
export class ClientsPage extends BasePage {
  readonly searchInput: Locator;
  readonly addClientButton: Locator;

  constructor(page: Page) {
    super(page);
    this.searchInput = page.getByPlaceholder(/search/i).first();
    this.addClientButton = page.getByRole('button', { name: /Add Client/i });
  }

  async navigate(): Promise<void> {
    await this.navigateTo('/clients');
    await this.waitForLoaded();
  }
}
