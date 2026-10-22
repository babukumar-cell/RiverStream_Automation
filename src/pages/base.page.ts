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
      await this.page.goto(path, { waitUntil: 'domcontentloaded' });
    } catch (err: any) {
      // Next.js client redirects occasionally abort the first navigation; retry once.
      if (err.message && (err.message.includes('ERR_ABORTED') || err.message.includes('detached'))) {
        await this.page.goto(path, { waitUntil: 'domcontentloaded' });
      } else {
        throw err;
      }
    }
  }

  /** Main page heading rendered in the app header (e.g. "Dashboard", "Clients") */
  get headerTitle(): Locator {
    return this.page.locator('header h1, header h2').first();
  }

  /** Left sidebar navigation button by its visible label */
  sidebarButton(name: string | RegExp): Locator {
    return this.page.locator('aside').getByRole('button', { name, exact: typeof name === 'string' });
  }

  /** Transient toast/notification container (sonner / react-hot-toast style) */
  get toast(): Locator {
    return this.page.locator('[data-sonner-toast], [role="status"]:not(:empty), .toast, [class*="toast" i]').first();
  }

  /**
   * Wait until loading indicators ("Loading...", spinners) have disappeared.
   */
  async waitForLoaded(timeout: number = 20000): Promise<void> {
    await expect(this.page.getByText(/^Loading\.{0,3}$/i)).toHaveCount(0, { timeout });
  }

  /**
   * Returns true when the page is wider than the viewport (horizontal scroll present).
   */
  async hasHorizontalScroll(): Promise<boolean> {
    return this.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  }

  /**
   * Collect console errors and failed (5xx) responses for the lifetime of the page.
   * Call before navigating; read the returned array at the end of the test.
   */
  trackPageErrors(): string[] {
    const errors: string[] = [];
    this.page.on('console', msg => {
      if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
    });
    this.page.on('pageerror', err => errors.push(`pageerror: ${err.message}`));
    this.page.on('response', res => {
      if (res.status() >= 500) errors.push(`HTTP ${res.status()}: ${res.url()}`);
    });
    return errors;
  }

  /**
   * Get page current URL
   */
  getCurrentUrl(): string {
    return this.page.url();
  }
}
