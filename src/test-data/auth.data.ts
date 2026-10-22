import { Config } from '../config/environment';

export interface AuthTestCaseData {
  testCaseId: string;
  description: string;
  email: string;
  password: string;
  expectedOutcome: 'success' | 'error';
  expectedErrorMessage?: string | RegExp;
}

export const AuthTestData = {
  validUser: {
    testCaseId: 'TC_001',
    description: 'Verify user is able to sign in with valid credentials',
    email: Config.adminEmail,
    password: Config.adminPassword,
    expectedOutcome: 'success' as const,
  },
  invalidCredentials: {
    testCaseId: 'TC_002',
    description: 'Verify that an error message is displayed for an incorrect Email/password',
    email: Config.adminEmail,
    password: 'WrongPass@987',
    expectedOutcome: 'error' as const,
    expectedErrorMessage: /Invalid Email or password|Email username or password/i,
  },
  emptyFields: {
    testCaseId: 'TC_003',
    description: 'Verify login with empty Email and password fields',
    email: '',
    password: '',
    expectedOutcome: 'error' as const,
    expectedErrorMessage: /required/i,
  },
  emailOnly: {
    testCaseId: 'TC_004',
    description: 'Verify login with only the valid Email filled',
    email: Config.adminEmail,
    password: '',
    expectedOutcome: 'error' as const,
    expectedErrorMessage: /required|Invalid/i,
  },
  passwordOnly: {
    testCaseId: 'TC_005',
    description: 'Verify login with only the valid password filled',
    email: '',
    password: Config.adminPassword,
    expectedOutcome: 'error' as const,
    expectedErrorMessage: /required|Invalid/i,
  },
};
