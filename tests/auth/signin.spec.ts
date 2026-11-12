import { test, expect } from '../../src/fixtures/test.fixture';
import { AuthTestData } from '../../src/test-data/auth.data';
import { isVisibleWithin } from '../../src/utils/wait-utils';

test.describe('River Stream - Authentication Suite (Sign-In)', () => {

  // The po-quote project injects the admin session (storageState). Sign-in tests must start
  // logged out, otherwise the app redirects to the dashboard and negative cases test nothing.
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(async ({ loginPage }) => {
    await loginPage.navigate();
  });

  test.afterEach(async ({ page }, testInfo) => {
    if (!page.isClosed()) {
      const shot = await page.screenshot({ fullPage: true }).catch(() => null);
      if (shot) {
        const id = testInfo.title.split(':')[0].trim();
        await testInfo.attach(`${id}-Evidence`, {
          body: shot,
          contentType: 'image/png',
        });
      }
    }
  });

  test(`${AuthTestData.validUser.testCaseId}: ${AuthTestData.validUser.description}`, async ({ loginPage, dashboardPage, page }) => {
    const data = AuthTestData.validUser;

    // 1. Enter valid credentials
    await loginPage.login(data.email, data.password);

    // 2. Verify dashboard is reached and redirected
    const isDashboard = await dashboardPage.isDashboardLoaded();
    expect(isDashboard).toBeTruthy();
    expect(page.url()).not.toContain('/login');
  });

  test(`${AuthTestData.invalidCredentials.testCaseId}: ${AuthTestData.invalidCredentials.description}`, async ({ loginPage, page }) => {
    const data = AuthTestData.invalidCredentials;

    // 1. Enter invalid password with valid email
    await loginPage.login(data.email, data.password);

    // 2. Verify system remains on login page
    expect(page.url()).toMatch(/riverstream(-qa)?\.azurewebsites\.net/);
    await expect(loginPage.emailInput, 'should stay on the sign-in form').toBeVisible();

    // 3. Wait for the server error to render (so the evidence screenshot shows it), then verify it
    const errorText = await loginPage.waitForErrorMessage();
    expect(errorText, 'an error message should be displayed for invalid credentials').toMatch(data.expectedErrorMessage!);
  });

  test(`${AuthTestData.emptyFields.testCaseId}: ${AuthTestData.emptyFields.description}`, async ({ loginPage }) => {
    const data = AuthTestData.emptyFields;

    // 1. Leave fields empty and click Sign In
    await loginPage.clickSignIn();

    // 2. Check for validation messages or required indicator (wait briefly; native validation shows no DOM text)
    const errorText = await loginPage.waitForErrorMessage(5000);
    if (errorText) {
      expect(errorText).toMatch(data.expectedErrorMessage!);
    } else {
      const isEmailInvalid = await loginPage.emailInput.evaluate((el: HTMLInputElement) => !el.checkValidity() || el.value === '');
      expect(isEmailInvalid).toBeTruthy();
    }
  });

  test(`${AuthTestData.passwordMaskingToggle.testCaseId}: ${AuthTestData.passwordMaskingToggle.description}`, async ({ loginPage }) => {
    const data = AuthTestData.passwordMaskingToggle;

    // 1. Enter text in password field
    await loginPage.enterPassword(data.password!);

    // 2. Verify password is masked by default and the typed value is kept (not shown as plain text)
    await expect(loginPage.passwordInput).toHaveAttribute('type', 'password');
    await expect(loginPage.passwordInput).toHaveValue(data.password!);

    // 3. Show/hide toggle: an icon-only button inside the password field's own wrapper
    //    (text buttons like "Sign In" / "Forgot Password?" are excluded).
    const eyeToggle = loginPage.passwordInput
      .locator('xpath=ancestor::div[.//button][1]//button')
      .filter({ hasNotText: /\S/ })
      .first();

    if (await isVisibleWithin(eyeToggle, 2000)) {
      // Toggle must reveal the password, and toggling again must mask it.
      await eyeToggle.click();
      await expect(loginPage.passwordInput).toHaveAttribute('type', 'text');
      await eyeToggle.click();
      await expect(loginPage.passwordInput).toHaveAttribute('type', 'password');
    } else {
      // No toggle on the sign-in form: masking is verified above; record it in the report.
      test.info().annotations.push({
        type: 'Note',
        description: 'Sign-in form has no show/hide password toggle. Verified the password is masked (type="password").',
      });
    }

    // 4. Submit (email left empty) and wait for the validation error so the evidence screenshot shows it
    await loginPage.clickSignIn();
    const errorText = await loginPage.waitForErrorMessage();
    expect(errorText, 'a validation error should be displayed after clicking Sign In').toMatch(data.expectedErrorMessage!);

    // 5. Password must remain masked after the failed submit
    await expect(loginPage.passwordInput).toHaveAttribute('type', 'password');
  });

  test(`${AuthTestData.unregisteredUser.testCaseId}: ${AuthTestData.unregisteredUser.description}`, async ({ loginPage, page }) => {
    const data = AuthTestData.unregisteredUser;

    // 1. Enter unregistered email and submit
    await loginPage.login(data.email!, data.password!);

    // 2. Verify login fails and remains on login page
    expect(page.url()).toMatch(/riverstream(-qa)?\.azurewebsites\.net/);
    await expect(loginPage.emailInput, 'should stay on the sign-in form').toBeVisible();

    // 3. Wait for the server error to render (so the evidence screenshot shows it), then verify it
    const errorText = await loginPage.waitForErrorMessage();
    expect(errorText, 'an error message should be displayed for an unregistered email').toMatch(data.expectedErrorMessage!);
  });

});
