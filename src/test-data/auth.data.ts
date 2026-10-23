import { Config } from '../config/environment';

export interface AuthTestCaseData {
  testCaseId: string;
  description: string;
  email?: string;
  password?: string;
  expectedOutcome: 'success' | 'error';
  expectedErrorMessage?: string | RegExp;
}

export const AuthTestData = {
  validUser: {
    testCaseId: 'TC_Login_001',
    description: 'Verify user is able to sign in with valid credentials',
    email: Config.adminEmail,
    password: Config.adminPassword,
    expectedOutcome: 'success' as const,
  },
  invalidCredentials: {
    testCaseId: 'TC_Login_002',
    description: 'Verify system behavior with invalid credentials',
    email: Config.adminEmail,
    password: 'InvalidPassword@123',
    expectedOutcome: 'error' as const,
    expectedErrorMessage: /Invalid Email or password|Invalid username or password/i,
  },
  emptyFields: {
    testCaseId: 'TC_Login_003',
    description: 'Verify system behavior when clicking Sign In with empty fields',
    email: '',
    password: '',
    expectedOutcome: 'error' as const,
    expectedErrorMessage: /required/i,
  },
  passwordMaskingToggle: {
    testCaseId: 'TC_Login_004',
    description: 'Verify password masking and toggle visibility',
    password: 'TestSecretPassword@123',
    expectedOutcome: 'success' as const,
  },
  unregisteredUser: {
    testCaseId: 'TC_Login_005',
    description: 'Verify system behavior with unregistered email ID',
    email: 'nonexistent.user.test99@riverstonetech.com',
    password: 'AnyPassword@123',
    expectedOutcome: 'error' as const,
    expectedErrorMessage: /Invalid Email or password|User does not exist|not found|Invalid/i,
  },
};
