import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

/**
 * Reads a required environment variable. Fails fast with a clear message instead of
 * silently falling back to a hard-coded value (credentials must never live in the repo).
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`);
  }
  return value.trim();
}

function normalizeBaseUrl(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

export const Config = {
  baseUrl: normalizeBaseUrl(process.env.BASE_URL || 'https://riverstream-qa.azurewebsites.net/'),

  // Getters so modules that only need reporting/email settings can import Config without admin credentials set.
  get adminEmail(): string {
    return requireEnv('ADMIN_EMAIL');
  },
  get adminPassword(): string {
    return requireEnv('ADMIN_PASSWORD');
  },

  /** Path of the saved admin session produced by tests/auth.setup.ts */
  adminStorageState: path.resolve(__dirname, '../../.auth/admin.json'),

  // Email Process Configuration
  email: {
    senderEmail: process.env.SENDER_EMAIL || '',
    senderAppPassword: (process.env.SENDER_APP_PASSWORD || '').replace(/\s+/g, ''),
    ingestionEmail: process.env.INGESTION_EMAIL || 'riverstream.qa@riverstonetech.in',
    smtpHost: process.env.SMTP_HOST || 'smtp.gmail.com',
    smtpPort: parseInt(process.env.SMTP_PORT || '465', 10),
    imapHost: process.env.IMAP_HOST || 'imap.gmail.com',
    imapPort: parseInt(process.env.IMAP_PORT || '993', 10),
    pollTimeoutMs: parseInt(process.env.EMAIL_POLL_TIMEOUT_MS || '180000', 10),
    pollIntervalMs: 10000,
  },
};
