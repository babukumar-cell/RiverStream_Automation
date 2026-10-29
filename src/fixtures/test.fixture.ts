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
  page: async ({ page }, use, testInfo) => {
    await use(page);

    // If the test failed, render a clear diagnostic failure banner before Playwright captures the screenshot
    if (testInfo.status !== 'passed' && testInfo.status !== 'skipped') {
      try {
        const rawErr = testInfo.errors?.[0]?.message || 'Assertion or action failed';
        const cleanErr = rawErr.split('\n')[0].replace(/[^\x20-\x7E]/g, '').slice(0, 140);
        const url = page.url();

        await page.evaluate(
          ({ title, err, pageUrl }) => {
            if (document.querySelector('.rs-failure-evidence-banner')) return;
            const banner = document.createElement('div');
            banner.className = 'rs-failure-evidence-banner';
            banner.style.position = 'fixed';
            banner.style.top = '0';
            banner.style.left = '0';
            banner.style.width = '100%';
            banner.style.backgroundColor = '#dc2626';
            banner.style.color = '#ffffff';
            banner.style.padding = '12px 18px';
            banner.style.fontFamily = 'system-ui, -apple-system, sans-serif';
            banner.style.fontSize = '13px';
            banner.style.fontWeight = '600';
            banner.style.lineHeight = '1.4';
            banner.style.zIndex = '99999999';
            banner.style.boxShadow = '0 4px 16px rgba(220, 38, 38, 0.5)';
            banner.style.borderBottom = '3px solid #991b1b';
            banner.innerHTML = `
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 16px;">❌</span>
                <span>TEST FAILED: ${title}</span>
              </div>
              <div style="margin-top: 4px; font-size: 12px; font-weight: normal; opacity: 0.95;">
                <strong>Reason:</strong> ${err}
              </div>
              <div style="font-size: 11px; font-weight: normal; opacity: 0.85;">
                <strong>Page URL at Failure:</strong> ${pageUrl}
              </div>
            `;
            document.body.prepend(banner);
          },
          { title: testInfo.title, err: cleanErr, pageUrl: url },
        );
        await page.waitForTimeout(100);
      } catch {}
    }
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

