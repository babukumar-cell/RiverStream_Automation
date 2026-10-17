import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './base.page';

export class LoginPage extends BasePage {
  // Locators
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly signInButton: Locator;
  readonly errorMessage: Locator;
  readonly emailRequiredError: Locator;
  readonly passwordRequiredError: Locator;
  readonly cardContainer: Locator;

  constructor(page: Page) {
    super(page);

    // Using flexible user-facing locators with CSS fallbacks
    this.emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i], #email').first();
    this.passwordInput = page.locator('input[type="password"], input[name="password"], input[placeholder*="password" i], #password').first();
    this.signInButton = page.locator('button:has-text("Sign in"), button:has-text("Sign In"), button[type="submit"]').first();
    
    // Error notification or alert elements
    this.errorMessage = page.locator('[role="alert"], .alert, .error-message, .text-danger, .toast-error, p:has-text("Invalid"), div:has-text("Invalid Email")').first();
    this.emailRequiredError = page.locator('text=Email is required, text=Email username or password').first();
    this.passwordRequiredError = page.locator('text=Password is required').first();
    this.cardContainer = page.locator('form, .login-container, .card').first();
  }

  /**
   * Navigate to Sign-In page
   */
  async navigate(): Promise<void> {
    await this.navigateTo('/');
    await this.page.waitForLoadState('networkidle').catch(() => {});
  }

  /**
   * Fill Email input field
   */
  async enterEmail(email: string): Promise<void> {
    await this.emailInput.waitFor({ state: 'visible', timeout: 15000 });
    await this.emailInput.fill(email);
  }

  /**
   * Fill Password input field
   */
  async enterPassword(password: string): Promise<void> {
    await this.passwordInput.waitFor({ state: 'visible', timeout: 15000 });
    await this.passwordInput.fill(password);
  }

  /**
   * Click Sign In button
   */
  async clickSignIn(): Promise<void> {
    await this.signInButton.waitFor({ state: 'visible', timeout: 15000 });
    await this.signInButton.click();
  }

  /**
   * Perform complete login action
   */
  async login(email: string, password: string): Promise<void> {
    if (email) {
      await this.enterEmail(email);
    } else {
      await this.emailInput.clear();
    }

    if (password) {
      await this.enterPassword(password);
    } else {
      await this.passwordInput.clear();
    }

    await this.clickSignIn();
  }

  /**
   * Retrieve visible error message text
   */
  async getDisplayedErrorMessage(): Promise<string> {
    const errorLocators = [
      this.page.locator('[role="alert"]'),
      this.page.locator('.alert'),
      this.page.locator('.error, .text-danger, .error-message'),
      this.page.locator('text=/Email is required/i'),
      this.page.locator('text=/Password is required/i'),
      this.page.locator('text=/Invalid Email or password/i'),
      this.page.locator('text=/Invalid/i')
    ];

    for (const loc of errorLocators) {
      if (await loc.first().isVisible().catch(() => false)) {
        return (await loc.first().textContent())?.trim() || '';
      }
    }
    return '';
  }

  /**
   * Verify if Sign In page elements are visible
   */
  async isLoaded(): Promise<boolean> {
    return await this.emailInput.isVisible() && await this.signInButton.isVisible();
  }
}
