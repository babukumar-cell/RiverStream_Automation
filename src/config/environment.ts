import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const Config = {
  baseUrl: process.env.BASE_URL || 'https://riverstream-qa.azurewebsites.net/',
  adminEmail: process.env.ADMIN_EMAIL || 'admin@riverstonetech.com',
  adminPassword: process.env.ADMIN_PASSWORD || 'River@123',
  isHeadless: process.env.HEADLESS !== 'false',
  timeout: 30000,

  // Email Process Configuration
  email: {
    senderEmail: process.env.SENDER_EMAIL || 'riverstreamautomation@gmail.com',
    senderAppPassword: (process.env.SENDER_APP_PASSWORD || '').replace(/\s+/g, ''),
    ingestionEmail: process.env.INGESTION_EMAIL || 'riverstream.qa@riverstonetech.in',
    smtpHost: process.env.SMTP_HOST || 'smtp.gmail.com',
    smtpPort: parseInt(process.env.SMTP_PORT || '465', 10),
    imapHost: process.env.IMAP_HOST || 'imap.gmail.com',
    imapPort: parseInt(process.env.IMAP_PORT || '993', 10),
    pollTimeoutMs: 120000, // 2 minutes wait for system replies
    pollIntervalMs: 5000,
  },
};
