import { Page, Locator, Request, expect } from '@playwright/test';
import { BasePage } from './base.page';

/**
 * Sign-in page ("/") including the Forgot Password view, which is rendered on the same route.
 * Note: the form labels are not associated with their inputs, so inputs are located by id/placeholder.
 */
export class LoginPage extends BasePage {
  readonly welcomeHeading: Locator;
  readonly signInForm: Locator;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly signInButton: Locator;
  readonly forgotPasswordButton: Locator;

  // Inline validation / server errors rendered inside the sign-in form
  readonly emailRequiredError: Locator;
  readonly passwordRequiredError: Locator;
  readonly invalidCredentialsError: Locator;
  readonly emailFormatError: Locator;

  // Forgot Password view
  readonly forgotPasswordHeading: Locator;
  readonly forgotPasswordForm: Locator;
  readonly forgotPasswordEmailInput: Locator;
  readonly sendResetLinkButton: Locator;
  readonly backToSignInButton: Locator;

  constructor(page: Page) {
    super(page);

    this.welcomeHeading = page.getByRole('heading', { name: 'Welcome back' });
    this.signInForm = page.locator('form').filter({ has: page.locator('#password') });
    this.emailInput = page.locator('#email');
    this.passwordInput = page.locator('#password');
    this.signInButton = page.getByRole('button', { name: /^Sign(ing)? In/i });
    this.forgotPasswordButton = page.getByRole('button', { name: 'Forgot Password?' });

    this.emailRequiredError = this.signInForm.getByText('Email is required', { exact: true });
    this.passwordRequiredError = this.signInForm.getByText('Password is required', { exact: true });
    this.invalidCredentialsError = this.signInForm.getByText('Invalid username or password', { exact: true });
    this.emailFormatError = this.signInForm.getByText(/valid email/i);

    this.forgotPasswordHeading = page.getByRole('heading', { name: 'Forgot Password' });
    this.forgotPasswordForm = page.locator('form').filter({ has: page.getByRole('button', { name: 'Send Reset Link' }) });
    this.forgotPasswordEmailInput = this.forgotPasswordForm.getByPlaceholder('Enter your email');
    this.sendResetLinkButton = page.getByRole('button', { name: 'Send Reset Link' });
    this.backToSignInButton = page.getByRole('button', { name: 'Back to Sign In' });
  }

  /** Open the Sign-In page and wait for the form. */
  async navigate(): Promise<void> {
    await this.navigateTo('/');
    await this.emailInput.waitFor({ state: 'visible' });
  }

  async enterEmail(email: string): Promise<void> {
    await this.emailInput.fill(email);
  }

  async enterPassword(password: string): Promise<void> {
    await this.passwordInput.fill(password);
  }

  async clickSignIn(): Promise<void> {
    await this.signInButton.click();
  }

  /** Fill both fields (empty string clears a field) and submit. */
  async login(email: string, password: string): Promise<void> {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.clickSignIn();
  }

  /** Log in and wait for the dashboard. Use only in a fresh (logged-out) browser context. */
  async loginAndWaitForDashboard(email: string, password: string): Promise<void> {
    await this.login(email, password);
    await expect(this.page).toHaveURL(/\/dashboard$/, { timeout: 30000 });
  }

  async openForgotPassword(): Promise<void> {
    await this.forgotPasswordButton.click();
    await expect(this.forgotPasswordHeading).toBeVisible();
  }

  /**
   * Records every request to the given API path for the lifetime of the page.
   * Used to prove that client-side validation blocks a submit (no request is sent).
   */
  recordApiRequests(apiPath: string): Request[] {
    const requests: Request[] = [];
    this.page.on('request', req => {
      if (req.url().includes(apiPath)) requests.push(req);
    });
    return requests;
  }

  /** HTML5 validity state of an input (the Forgot Password form uses native validation). */
  async validityOf(input: Locator): Promise<{ valueMissing: boolean; typeMismatch: boolean; message: string }> {
    return input.evaluate((el: HTMLInputElement) => ({
      valueMissing: el.validity.valueMissing,
      typeMismatch: el.validity.typeMismatch,
      message: el.validationMessage,
    }));
  }
}
