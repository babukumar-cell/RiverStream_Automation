import { test as setup } from '@playwright/test';
import { AUTOMATION_USER, ensureAutomationUserAndDirectEstimate } from './support/automation-user';

/**
 * Before the PO/Quote Request suite (project po-quote-user): the automation user is a user of the Riverstone
 * organization (created there if it does not exist) and the organization's Direct Estimate Creation is ON.
 */
setup('automation user in the Riverstone organization, Direct Estimate Creation ON', async ({ browser }) => {
  setup.setTimeout(5 * 60_000);
  const r = await ensureAutomationUserAndDirectEstimate(browser);
  console.log(
    `[po-quote-user] ${AUTOMATION_USER.email}: ${r.userCreated ? 'created in' : 'user of'} ${r.orgName} (${r.orgId}); ` +
      `Direct Estimate Creation ${r.directEstimateSwitchedOn ? 'was OFF, switched ON' : 'already ON'}`,
  );
});
