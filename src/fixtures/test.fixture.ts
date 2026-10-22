import { test as base } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { DashboardPage } from '../pages/dashboard.page';
import { UploadPage } from '../pages/upload.page';
import { ReviewPage } from '../pages/review.page';
import { LeftSidePage } from '../pages/left-side.page';
import { PoAckReconPage } from '../pages/po-ack-recon.page';
import { DocumentsPage } from '../pages/documents.page';
import { SettingsPage } from '../pages/settings.page';
import { ClientsPage } from '../pages/clients.page';
import { AnalyticsPage } from '../pages/analytics.page';
import { MailService } from '../utils/mail.service';

type Fixtures = {
  loginPage: LoginPage;
  dashboardPage: DashboardPage;
  uploadPage: UploadPage;
  reviewPage: ReviewPage;
  leftSidePage: LeftSidePage;
  poAckReconPage: PoAckReconPage;
  documentsPage: DocumentsPage;
  settingsPage: SettingsPage;
  clientsPage: ClientsPage;
  analyticsPage: AnalyticsPage;
  mailService: MailService;
};

export const test = base.extend<Fixtures>({
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },
  dashboardPage: async ({ page }, use) => {
    await use(new DashboardPage(page));
  },
  uploadPage: async ({ page }, use) => {
    await use(new UploadPage(page));
  },
  reviewPage: async ({ page }, use) => {
    await use(new ReviewPage(page));
  },
  leftSidePage: async ({ page }, use) => {
    await use(new LeftSidePage(page));
  },
  poAckReconPage: async ({ page }, use) => {
    await use(new PoAckReconPage(page));
  },
  documentsPage: async ({ page }, use) => {
    await use(new DocumentsPage(page));
  },
  settingsPage: async ({ page }, use) => {
    await use(new SettingsPage(page));
  },
  clientsPage: async ({ page }, use) => {
    await use(new ClientsPage(page));
  },
  analyticsPage: async ({ page }, use) => {
    await use(new AnalyticsPage(page));
  },
  mailService: async ({}, use) => {
    await use(new MailService());
  },
});

export { expect } from '@playwright/test';
