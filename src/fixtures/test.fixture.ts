import { test as base, expect as baseExpect, Locator } from '@playwright/test';
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
import { highlightLocator } from '../utils/ui-highlighter';

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

function isLocator(val: any): val is Locator {
  return (
    val !== null &&
    typeof val === 'object' &&
    typeof val.evaluate === 'function' &&
    typeof val.evaluateAll === 'function' &&
    typeof val.page === 'function'
  );
}

function wrapMatchers(matchers: any, locator: Locator, isNegated = false): any {
  return new Proxy(matchers, {
    get(target, prop, receiver) {
      if (prop === 'not') {
        const notMatchers = Reflect.get(target, prop, receiver);
        return wrapMatchers(notMatchers, locator, true);
      }

      const orig = Reflect.get(target, prop, receiver);
      if (typeof orig !== 'function') {
        return orig;
      }

      return function (this: any, ...args: any[]) {
        const res = orig.apply(this, args);
        if (res && typeof res.then === 'function') {
          return res.then(async (val: any) => {
            if (!isNegated) {
              await highlightLocator(locator);
            }
            return val;
          });
        }
        return res;
      };
    },
  });
}

function createSmartExpect(baseExp: any): any {
  return new Proxy(baseExp, {
    apply(target, thisArg, argArray) {
      const matchers = Reflect.apply(target, thisArg, argArray);
      const actual = argArray[0];
      if (isLocator(actual)) {
        return wrapMatchers(matchers, actual, false);
      }
      return matchers;
    },
    get(target, prop, receiver) {
      if (prop === 'soft') {
        const origSoft = Reflect.get(target, prop, receiver);
        return new Proxy(origSoft, {
          apply(sTarget, sThisArg, sArgArray) {
            const matchers = Reflect.apply(sTarget, sThisArg, sArgArray);
            const actual = sArgArray[0];
            if (isLocator(actual)) {
              return wrapMatchers(matchers, actual, false);
            }
            return matchers;
          },
        });
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

export const expect = createSmartExpect(baseExpect) as typeof baseExpect;

