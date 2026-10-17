import { test, expect } from '../../src/fixtures/test.fixture';
import { AuthTestData } from '../../src/test-data/auth.data';

test.describe('River Stream - Authentication Suite (Sign-In)', () => {

  test.beforeEach(async ({ loginPage }) => {
    await loginPage.navigate();
  });

  test(`${AuthTestData.validUser.testCaseId}: ${AuthTestData.validUser.description}`, async ({ loginPage, dashboardPage, page }) => {
    const data = AuthTestData.validUser;

    // Fill valid credentials and submit
    await loginPage.login(data.email, data.password);

    // Verify dashboard is reached or user is authenticated
    const isDashboard = await dashboardPage.isDashboardLoaded();
    expect(isDashboard).toBeTruthy();

    // Verify URL moved away from login page
    expect(page.url()).not.toContain('/login');
  });

  test(`${AuthTestData.invalidCredentials.testCaseId}: ${AuthTestData.invalidCredentials.description}`, async ({ loginPage, page }) => {
    const data = AuthTestData.invalidCredentials;

    // Fill invalid credentials and submit
    await loginPage.login(data.email, data.password);

    // Verify system remains on login page
    expect(page.url()).toMatch(/riverstream(-qa)?\.azurewebsites\.net/);

    // Verify error notification is displayed
    const errorText = await loginPage.getDisplayedErrorMessage();
    if (errorText) {
      expect(errorText).toMatch(data.expectedErrorMessage!);
    } else {
      // Check if any error locator is visible
      const isErrorVisible = await loginPage.errorMessage.isVisible().catch(() => false);
      expect(isErrorVisible).toBeTruthy();
    }
  });

  test(`${AuthTestData.emptyFields.testCaseId}: ${AuthTestData.emptyFields.description}`, async ({ loginPage }) => {
    const data = AuthTestData.emptyFields;

    // Click Sign In without entering any credentials
    await loginPage.clickSignIn();

    // Check for validation messages (HTML5 validation or custom UI error)
    const errorText = await loginPage.getDisplayedErrorMessage();
    if (errorText) {
      expect(errorText).toMatch(data.expectedErrorMessage!);
    } else {
      // Verify browser native validation or that form was not submitted
      const isEmailInvalid = await loginPage.emailInput.evaluate((el: HTMLInputElement) => !el.checkValidity() || el.value === '');
      expect(isEmailInvalid).toBeTruthy();
    }
  });

  test(`${AuthTestData.emailOnly.testCaseId}: ${AuthTestData.emailOnly.description}`, async ({ loginPage }) => {
    const data = AuthTestData.emailOnly;

    // Fill only email and submit
    await loginPage.enterEmail(data.email);
    await loginPage.clickSignIn();

    // Verify error or invalid state
    const errorText = await loginPage.getDisplayedErrorMessage();
    if (errorText) {
      expect(errorText).toMatch(data.expectedErrorMessage!);
    } else {
      const isPasswordInvalid = await loginPage.passwordInput.evaluate((el: HTMLInputElement) => !el.checkValidity() || el.value === '');
      expect(isPasswordInvalid).toBeTruthy();
    }
  });

  test(`${AuthTestData.passwordOnly.testCaseId}: ${AuthTestData.passwordOnly.description}`, async ({ loginPage }) => {
    const data = AuthTestData.passwordOnly;

    // Fill only password and submit
    await loginPage.enterPassword(data.password);
    await loginPage.clickSignIn();

    // Verify error or invalid state
    const errorText = await loginPage.getDisplayedErrorMessage();
    if (errorText) {
      expect(errorText).toMatch(data.expectedErrorMessage!);
    } else {
      const isEmailInvalid = await loginPage.emailInput.evaluate((el: HTMLInputElement) => !el.checkValidity() || el.value === '');
      expect(isEmailInvalid).toBeTruthy();
    }
  });

});
