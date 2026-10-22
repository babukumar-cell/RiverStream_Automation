/**
 * Pre-existing QA environment data that some tests depend on.
 * Every value can be overridden through an environment variable so the suite
 * can be pointed at another environment without code changes.
 */
export const QaData = {
  /** Organization used for org-scoped document tests */
  defaultOrg: process.env.QA_DEFAULT_ORG || 'Riverstonetech',
  /** Existing organization used for read-only organization-detail checks */
  referenceOrg: process.env.QA_REFERENCE_ORG || 'MJ',
  /** Existing PO-ACK Recon project holding reference PO/ACK documents */
  reconProject: process.env.QA_RECON_PROJECT || 'Tech_Soluton',
  /** Organization that owns the recon project */
  reconOrg: process.env.QA_RECON_ORG || 'Riverstonetech',
  /** Existing user used for read-only user-detail checks */
  referenceUser: process.env.QA_REFERENCE_USER || 'manoj',
  /** Prefix for everything the suite creates, so leftovers are easy to find and clean */
  testPrefix: process.env.QA_TEST_PREFIX || 'AUTO',
};

/** Unique, traceable name for data created by a test, e.g. AUTO_Proj_20261022_1530_4821 */
export function uniqueName(label: string): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `${QaData.testPrefix}_${label}_${stamp}_${Math.floor(1000 + Math.random() * 9000)}`;
}
