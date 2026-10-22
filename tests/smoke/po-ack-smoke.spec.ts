import fs from 'fs';
import path from 'path';
import { test, expect, Page } from '@playwright/test';
import { QaData, uniqueName } from '../../src/test-data/qa-data';

/**
 * PO-ACK Recon Smoke Suite:
 * Validates the core end-to-end happy paths of PO-ACK Reconciliation:
 * - Reference project opens recon review with PO data, ACK data and discrepancies
 * - Uploading a PO + ACK document pair and verifying extraction / review readiness
 */

const RECON_PO = path.resolve('Test Cases/PO ACK files/CRI Files/SIT-53758-113541-DIRO.pdf');
const RECON_ACK = path.resolve('Test Cases/PO ACK files/CRI Files/53758-113541-SIT-ACKS.pdf');
const SMOKE_RECON_PROJECT = `${QaData.testPrefix}_Smoke_Recon`;

async function waitForLoaded(page: Page): Promise<void> {
  await expect(page.getByText(/^Loading\.{0,3}$/i)).toHaveCount(0, { timeout: 30000 });
}

function uniqueCopy(source: string, label: string): string {
  const target = test.info().outputPath(`${uniqueName(label)}${path.extname(source)}`);
  fs.copyFileSync(source, target);
  return target;
}

test.describe('Smoke: PO-ACK Recon', () => {
  test.describe.configure({ mode: 'serial' });

  test('TC_RECON_045: Reference project opens a recon review with PO data, ACK data and discrepancies', async ({ page }) => {
    await page.goto('/po-ack-recon');
    await page.getByPlaceholder('Search projects...').fill(QaData.reconProject);
    await page.getByRole('row').filter({ hasText: QaData.reconProject }).first().click();
    await expect(page).toHaveURL(/\/po-ack-recon\/[^/]+$/);
    await waitForLoaded(page);

    const reviewable = page
      .getByRole('row')
      .filter({ hasNotText: 'Awaiting ACK' })
      .filter({ has: page.getByRole('button', { name: 'Review' }) });
    await expect(reviewable.first(), 'project has a reviewable PO/ACK pair').toBeVisible();
    await reviewable.first().getByRole('button', { name: 'Review' }).click();

    await expect(page).toHaveURL(/\/po-ack-recon\/review\//);
    await expect(page.getByText('PO Data', { exact: true })).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(/ACK \d+ Data/)).toBeVisible();
    await expect(page.getByText(/discrepanc(y|ies) against PO/i)).toBeVisible();
  });

  test('TC_RECON_033: Upload a PO and ACK pair and get it ready for review', async ({ page }) => {
    test.setTimeout(420000);
    await page.goto('/po-ack-recon');
    const search = page.getByPlaceholder('Search projects...');
    await search.fill(SMOKE_RECON_PROJECT);
    await waitForLoaded(page);
    const projectRow = page.getByRole('row').filter({ hasText: SMOKE_RECON_PROJECT }).first();

    if ((await projectRow.count()) === 0) {
      // One reusable smoke project: projects cannot be deleted from the UI.
      await page.getByRole('button', { name: 'New Project' }).click();
      await page.getByPlaceholder('Enter project name...').fill(SMOKE_RECON_PROJECT);
      await page.getByRole('button', { name: 'Create', exact: true }).click();
      await expect(page).toHaveURL(/\/po-ack-recon\/[^/]+$/, { timeout: 30000 });
    } else {
      await projectRow.click();
      await expect(page).toHaveURL(/\/po-ack-recon\/[^/]+$/);
    }

    const po = uniqueCopy(RECON_PO, 'SmokeReconPO');
    const ack = uniqueCopy(RECON_ACK, 'SmokeReconACK');
    await page.getByRole('button', { name: /Upload Documents/i }).first().click();
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible();
    const inputs = modal.locator('input[type="file"]');
    await inputs.first().setInputFiles(po);
    await inputs.nth(1).setInputFiles(ack);

    const upload = page.waitForResponse((r) => r.request().method() === 'POST' && /upload/i.test(r.url()), {
      timeout: 60000,
    });
    await modal.getByRole('button', { name: 'Upload Files', exact: true }).click();
    expect((await upload).status(), 'recon upload accepted').toBeLessThan(300);
    await expect(modal).toBeHidden({ timeout: 30000 });

    const poNumber = '53758-113541';
    const row = page.getByRole('row').filter({ hasText: poNumber }).first();
    await expect(async () => {
      await page.reload();
      await waitForLoaded(page);
      await expect(row).toBeVisible({ timeout: 10000 });
      await expect(row, 'recon processing finished').not.toContainText(/Processing|Awaiting ACK/i, { timeout: 1000 });
    }).toPass({ timeout: 360000, intervals: [15000, 30000] });
    await expect(row.getByRole('button', { name: 'Review' })).toBeVisible();
  });
});
