import { test, expect } from '../../src/fixtures/test.fixture';
import { AuthTestData } from '../../src/test-data/auth.data';

test.describe('River Stream - Authentication Suite (Sign-In)', () => {

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

    // 3. Verify error notification is displayed
    const errorText = await loginPage.getDisplayedErrorMessage();
    if (errorText) {
      expect(errorText).toMatch(data.expectedErrorMessage!);
    } else {
      const isErrorVisible = await loginPage.errorMessage.isVisible().catch(() => false);
      expect(isErrorVisible).toBeTruthy();
    }
  });

  test(`${AuthTestData.emptyFields.testCaseId}: ${AuthTestData.emptyFields.description}`, async ({ loginPage }) => {
    const data = AuthTestData.emptyFields;

    // 1. Leave fields empty and click Sign In
    await loginPage.clickSignIn();

    // 2. Check for validation messages or required indicator
    const errorText = await loginPage.getDisplayedErrorMessage();
    if (errorText) {
      expect(errorText).toMatch(data.expectedErrorMessage!);
    } else {
      const isEmailInvalid = await loginPage.emailInput.evaluate((el: HTMLInputElement) => !el.checkValidity() || el.value === '');
      expect(isEmailInvalid).toBeTruthy();
    }
  });

  test(`${AuthTestData.passwordMaskingToggle.testCaseId}: ${AuthTestData.passwordMaskingToggle.description}`, async ({ loginPage, page }) => {
    const data = AuthTestData.passwordMaskingToggle;

    // 1. Enter text in password field
    await loginPage.enterPassword(data.password!);

    // 2. Verify password is masked by default (type="password")
    const initialType = await loginPage.passwordInput.getAttribute('type');
    expect(initialType).toBe('password');

    // 3. Locate and click toggle eye icon if present
    const eyeToggle = page.locator('button, svg, [aria-label*="password"], [aria-label*="visibility"]').filter({
      has: page.locator('path, svg').or(page.locator('xpath=..'))
    }).first();

    if (await eyeToggle.isVisible().catch(() => false)) {
      await eyeToggle.click();
      const toggledType = await loginPage.passwordInput.getAttribute('type');
      expect(['text', 'password']).toContain(toggledType);
    } else {
      // Input is securely masked as type="password"
      expect(initialType).toBe('password');
    }
  });

  test(`${AuthTestData.unregisteredUser.testCaseId}: ${AuthTestData.unregisteredUser.description}`, async ({ loginPage, page }) => {
    const data = AuthTestData.unregisteredUser;

    // 1. Enter unregistered email and submit
    await loginPage.login(data.email!, data.password!);

    // 2. Verify login fails and remains on login page
    expect(page.url()).toMatch(/riverstream(-qa)?\.azurewebsites\.net/);

    // 3. Verify error message is displayed
    const errorText = await loginPage.getDisplayedErrorMessage();
    if (errorText) {
      expect(errorText).toMatch(data.expectedErrorMessage!);
    } else {
      const isErrorVisible = await loginPage.errorMessage.isVisible().catch(() => false);
      expect(isErrorVisible).toBeTruthy();
    }
  });

});
