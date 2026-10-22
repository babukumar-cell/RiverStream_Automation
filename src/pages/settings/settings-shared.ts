import { Page, Locator } from '@playwright/test';

/** Quote a string for use inside an XPath expression. */
function xpathLiteral(value: string): string {
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;
  return `concat('${value.split("'").join(`', "'", '`)}')`;
}

/**
 * The app renders form fields as `<div><label>Name</label><input/></div>` without `for`/`id`,
 * so `getByLabel` does not work. This returns the element that directly wraps the label
 * (the field container). Mandatory labels render as "Name *".
 */
export function fieldContainer(scope: Page | Locator, label: string): Locator {
  const exact = `normalize-space(.)=${xpathLiteral(label)} or normalize-space(.)=${xpathLiteral(`${label} *`)}`;
  return scope.locator(`xpath=.//*[label[${exact}]]`).first();
}

/** Text input / number input belonging to a labelled field. */
export function labelledInput(scope: Page | Locator, label: string): Locator {
  return fieldContainer(scope, label).locator('input').first();
}

/** Radix select trigger (role=combobox) belonging to a labelled field. */
export function labelledCombobox(scope: Page | Locator, label: string): Locator {
  return fieldContainer(scope, label).getByRole('combobox');
}

/** Row containing a switch ("Direct Estimate Creation", "Lifeline Tracking") and the switch itself. */
export function switchByTitle(scope: Page | Locator, title: string): Locator {
  return scope
    .locator(`xpath=.//*[p[normalize-space(.)=${xpathLiteral(title)}]]/following-sibling::button[@role="switch"]`)
    .first();
}

/** Generic "Confirm Delete" dialog used for users and organizations. */
export class ConfirmDeleteDialog {
  readonly root: Locator;
  readonly title: Locator;
  readonly message: Locator;
  readonly cancelButton: Locator;
  readonly confirmButton: Locator;
  readonly closeButton: Locator;

  constructor(page: Page) {
    this.root = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Confirm Delete' }) });
    this.title = this.root.getByRole('heading', { name: 'Confirm Delete' });
    this.message = this.root.getByText(/^Are you sure you want to delete /);
    this.cancelButton = this.root.getByRole('button', { name: 'Cancel', exact: true });
    this.confirmButton = this.root.getByRole('button', { name: 'Delete', exact: true });
    this.closeButton = this.root.getByRole('button', { name: 'Close', exact: true });
  }
}

/** Options rendered by an open Radix select / combobox. */
export function selectOption(page: Page, name: string | RegExp): Locator {
  return page.getByRole('option', { name, exact: typeof name === 'string' });
}

/** Parses "12 / 30" or "12 of 30" into numbers. */
export function parseUsage(text: string): { used: number; limit: number } {
  const match = text.replace(/,/g, '').match(/(\d+)\s*(?:\/|of)\s*(\d+)/);
  if (!match) throw new Error(`No "<used> / <limit>" pair found in "${text}"`);
  return { used: Number(match[1]), limit: Number(match[2]) };
}
