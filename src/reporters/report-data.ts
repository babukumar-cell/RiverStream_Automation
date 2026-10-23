import fs from 'fs';
import path from 'path';
import type {
  JSONReport,
  JSONReportSpec,
  JSONReportSuite,
  JSONReportTest,
  JSONReportTestResult,
  Suite,
  TestCase,
  TestResult,
  TestStep,
} from '@playwright/test/reporter';

/**
 * Shared data layer for every report this suite produces (elegant HTML report, email, PDF).
 *
 * Both input formats are normalised into the same `ReportRun` shape:
 *  - the in-memory Suite / TestCase objects a Playwright reporter receives (`runFromSuite`)
 *  - the JSON reporter output in test-results/summary.json (`loadRunFromSummary`)
 * so the three outputs always agree on statuses, counts and wording.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CaseStatus = 'passed' | 'failed' | 'flaky' | 'skipped';
type Outcome = 'skipped' | 'expected' | 'unexpected' | 'flaky';

export interface CatalogEntry {
  tcId: string;
  module?: string;
  description?: string;
  steps?: string;
  testData?: string;
  expectedResult?: string;
  actualResult?: string;
}

export type Catalog = Record<string, CatalogEntry>;

export interface Annotation {
  type: string;
  description?: string;
}

export interface CaseAttachment {
  name: string;
  contentType: string;
  path: string;
}

export interface CaseStep {
  title: string;
  durationMs: number;
  ok: boolean;
}

/** One executed test, independent of where the data came from. */
export interface RawCase {
  title: string;
  /** Path relative to the test directory, forward slashes. */
  file: string;
  line: number;
  projectName: string;
  status: CaseStatus;
  /** Duration of the final attempt. */
  durationMs: number;
  /** Number of attempts (1 = no retry). */
  attempts: number;
  /** Cleaned error message of the final attempt (failed) or of the first failed attempt (flaky). */
  error?: string;
  errorStack?: string;
  annotations: Annotation[];
  /** Screenshots / videos / traces of the final attempt, plus those of failed attempts for flaky tests. */
  attachments: CaseAttachment[];
  steps: CaseStep[];
}

export interface ModuleDef {
  key: string;
  order: number;
  name: string;
  shortName: string;
  icon: string;
  /** Test-ID prefixes after `TC_`, e.g. `RECON` for TC_RECON_001. */
  idPrefixes: string[];
  /** Fragments matched against the spec file path. */
  pathHints: string[];
}

export interface ReportCase extends RawCase {
  tcId: string;
  module: ModuleDef;
  inCatalog: boolean;
  description: string;
  plainSteps: string;
  testData: string;
  expectedResult: string;
  /** Plain-English outcome shown next to the expected result. */
  actualResult: string;
  /** Short plain-English reason for failed / flaky tests. */
  failureReason?: string;
  skipReason?: string;
  knownDefects: string[];
}

export interface StatusCounts {
  total: number;
  passed: number;
  failed: number;
  flaky: number;
  skipped: number;
  durationMs: number;
}

export interface ModuleSummary extends StatusCounts {
  module: ModuleDef;
  passRate: number;
}

export interface KnownDefect {
  tcId: string;
  title: string;
  description: string;
  status: CaseStatus;
}

export interface ReportRun {
  /** ISO timestamp of when the test run started. */
  startTime: string;
  /** Wall-clock duration of the run. */
  durationMs: number;
  cases: ReportCase[];
  /** Errors not tied to a test (e.g. global setup failure, no tests found). */
  globalErrors: string[];
  source: 'reporter' | 'summary.json';
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '');
}

export function escapeHtml(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return `${minutes}m ${seconds}s`;
}

/** Date and time of a run in the reporting time zone (TIMEZONE env, default Asia/Kolkata). */
export function formatRunTime(iso: string): { date: string; time: string; zone: string; dateShort: string } {
  const d = new Date(iso);
  const timeZone = process.env.TIMEZONE || 'Asia/Kolkata';
  const date = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone });
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true, timeZone });
  const zone = timeZone === 'Asia/Kolkata' ? 'IST' : timeZone;
  return { date, time, zone, dateShort: date.replace(/ /g, '-') };
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// Test catalog
// ---------------------------------------------------------------------------

export const TEST_DATA_DIR = path.resolve(__dirname, '../test-data');

function isCatalogEntry(value: unknown): value is CatalogEntry {
  return typeof value === 'object' && value !== null && typeof (value as CatalogEntry).tcId === 'string';
}

/** Accepts either `{ "TC_X_001": { tcId, ... } }` or `[ { tcId, ... } ]`. */
function readCatalogFile(file: string): CatalogEntry[] {
  const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf-8'));
  const values = Array.isArray(parsed) ? parsed : typeof parsed === 'object' && parsed ? Object.values(parsed) : [];
  return values.filter(isCatalogEntry);
}

/**
 * Loads the base catalog (src/test-data/test-catalog-metadata.json) and then every
 * src/test-data/catalog/*.json in alphabetical order. Later files override earlier entries
 * with the same tcId, so a module file always wins over the base catalog.
 */
export function loadCatalog(testDataDir: string = TEST_DATA_DIR): Catalog {
  const catalog: Catalog = {};
  const files = [path.join(testDataDir, 'test-catalog-metadata.json')];
  const moduleDir = path.join(testDataDir, 'catalog');
  if (fs.existsSync(moduleDir)) {
    files.push(
      ...fs
        .readdirSync(moduleDir)
        .filter((f) => f.toLowerCase().endsWith('.json'))
        .sort()
        .map((f) => path.join(moduleDir, f)),
    );
  }
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    try {
      for (const entry of readCatalogFile(file)) {
        catalog[entry.tcId.trim()] = entry;
      }
    } catch (err) {
      console.warn(`[Report] Ignoring unreadable catalog file ${file}: ${errorMessage(err)}`);
    }
  }
  return catalog;
}

/**
 * Extracts the test-case ID from a test title.
 * Handles the current form `TC_RECON_058: ...` and older forms such as `TC_001: ...`,
 * `TC_RS_EM_004: ...`, `TC-AUTH-01 - ...`, `[TC_UP_019] ...` and `TC_File Upload_001: ...`.
 * Returns '' when the title carries no ID.
 */
export function extractTcId(title: string): string {
  const text = title.trim();
  const leading = text.match(/^\[?\s*(TC[_-][A-Za-z0-9 _-]*?\d+[A-Za-z]?)\s*\]?\s*(?::|\s-\s|\s–\s|$)/i);
  if (leading) return leading[1].trim();
  const anywhere = text.match(/\b(TC[_-][A-Za-z0-9_-]*?\d+[A-Za-z]?)\b/i);
  return anywhere ? anywhere[1] : '';
}

/** Title without the leading test-case ID. */
export function stripTcId(title: string, tcId: string): string {
  if (!tcId) return title.trim();
  const idx = title.indexOf(tcId);
  if (idx < 0 || idx > 2) return title.trim();
  return title
    .slice(idx + tcId.length)
    .replace(/^\s*\]?\s*(?::|-|–)?\s*/, '')
    .trim();
}

export function normaliseTcId(id: string): string {
  return id.trim().replace(/[- ]+/g, '_').toUpperCase();
}

/** Older email IDs were TC_RS_EM_NNN; the module rewrite uses TC_EM_NNN. */
function legacyAliases(normId: string): string[] {
  if (normId.startsWith('TC_EM_')) return [normId.replace('TC_EM_', 'TC_RS_EM_')];
  if (normId.startsWith('TC_RS_EM_')) return [normId.replace('TC_RS_EM_', 'TC_EM_')];
  return [];
}

/** Exact key first, then normalised key (case, dashes, spaces), then known legacy aliases. */
export function lookupCatalog(tcId: string, catalog: Catalog): CatalogEntry | undefined {
  if (!tcId) return undefined;
  if (catalog[tcId]) return catalog[tcId];
  const normId = normaliseTcId(tcId);
  if (catalog[normId]) return catalog[normId];
  const byNorm = new Map(Object.keys(catalog).map((k) => [normaliseTcId(k), catalog[k]]));
  for (const id of [normId, ...legacyAliases(normId)]) {
    const hit = byNorm.get(id);
    if (hit) return hit;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Modules
// ---------------------------------------------------------------------------

export const MODULES: ModuleDef[] = [
  { key: 'auth', order: 1, name: 'Authentication & Session', shortName: 'Authentication', icon: '🔐', idPrefixes: ['AUTH', 'LOGIN'], pathHints: ['auth', 'signin', 'sign-in', 'login'] },
  { key: 'dashboard', order: 2, name: 'Dashboard & Navigation', shortName: 'Dashboard', icon: '🧭', idPrefixes: ['DASH', 'DASHBOARD', 'LEFIT_SIDE_FIELDS', 'LEFT_SIDE_FIELDS'], pathHints: ['dashboard', 'left-side', 'navigation'] },
  { key: 'clients', order: 3, name: 'Clients', shortName: 'Clients', icon: '👥', idPrefixes: ['CLIE'], pathHints: ['clients'] },
  { key: 'analytics', order: 4, name: 'Analytics', shortName: 'Analytics', icon: '📈', idPrefixes: ['ANAL'], pathHints: ['analytics'] },
  { key: 'upload', order: 5, name: 'Document Upload & Processing', shortName: 'Upload', icon: '📤', idPrefixes: ['UP', 'FILE_UPLOAD'], pathHints: ['upload'] },
  { key: 'documents', order: 6, name: 'Documents Library', shortName: 'Documents', icon: '📑', idPrefixes: ['DOCU', 'DOC', 'DOCUMENT'], pathHints: ['documents'] },
  { key: 'recon', order: 7, name: 'PO-ACK Reconciliation', shortName: 'PO-ACK Recon', icon: '⚖️', idPrefixes: ['RECON'], pathHints: ['po-ack-recon', 'recon'] },
  { key: 'review', order: 8, name: 'Document Review', shortName: 'Review', icon: '🔍', idPrefixes: ['REV', 'REVIEW_PAGE'], pathHints: ['review'] },
  { key: 'settings', order: 9, name: 'Settings & Organizations', shortName: 'Settings', icon: '⚙️', idPrefixes: ['SETT'], pathHints: ['settings'] },
  { key: 'email', order: 10, name: 'Email Order Ingestion', shortName: 'Email', icon: '✉️', idPrefixes: ['EM', 'RS_EM'], pathHints: ['email'] },
];

export const GENERAL_MODULE: ModuleDef = {
  key: 'general',
  order: 99,
  name: 'Other Tests',
  shortName: 'Other',
  icon: '📁',
  idPrefixes: [],
  pathHints: [],
};

export function resolveModule(tcId: string, file: string): ModuleDef {
  const id = normaliseTcId(tcId);
  if (id) {
    // Longest prefix wins so TC_RS_EM_ does not fall into a shorter prefix by accident.
    const byId = MODULES.flatMap((m) => m.idPrefixes.map((p) => ({ m, p: `TC_${p}_` })))
      .filter(({ p }) => id.startsWith(p))
      .sort((a, b) => b.p.length - a.p.length)[0];
    if (byId) return byId.m;
  }
  const normFile = file.replace(/\\/g, '/').toLowerCase();
  return MODULES.find((m) => m.pathHints.some((h) => normFile.includes(h))) ?? GENERAL_MODULE;
}

// ---------------------------------------------------------------------------
// Failure wording
// ---------------------------------------------------------------------------

const MATCHER_PHRASES: Record<string, string> = {
  toBeVisible: 'The expected element was not visible',
  toBeHidden: 'An element that should have disappeared was still visible',
  toBeAttached: 'The expected element was not on the page',
  toBeEnabled: 'A control that should be enabled was disabled',
  toBeDisabled: 'A control that should be disabled was enabled',
  toBeEditable: 'A field that should be editable was read-only',
  toBeChecked: 'A checkbox or option was not in the expected checked state',
  toBeFocused: 'The expected element did not have focus',
  toBeEmpty: 'An element that should be empty had content',
  toHaveText: 'An element showed different text than expected',
  toContainText: 'An element did not contain the expected text',
  toHaveValue: 'A field had a different value than expected',
  toHaveValues: 'A field had different values than expected',
  toHaveAttribute: 'An element had a different attribute value than expected',
  toHaveClass: 'An element had a different style class than expected',
  toHaveCount: 'The number of matching elements was different than expected',
  toHaveURL: 'The browser ended up on a different page than expected',
  toHaveTitle: 'The page title was different than expected',
  toBeTruthy: 'A condition the test checks was false',
  toBeFalsy: 'A condition the test expected to be false was true',
  toBe: 'A value was different than expected',
  toEqual: 'A value was different than expected',
  toStrictEqual: 'A value was different than expected',
  toContain: 'An expected item or text was missing',
  toMatch: 'A value did not match the expected pattern',
  toBeGreaterThan: 'A number was lower than expected',
  toBeGreaterThanOrEqual: 'A number was lower than expected',
  toBeLessThan: 'A number was higher than expected',
  toBeLessThanOrEqual: 'A number was higher than expected',
  toBeDefined: 'A value the test needed was missing',
  toBeNull: 'A value was present when none was expected',
  toPass: 'A retried check never passed within its time limit',
};

function fieldValue(lines: string[], labels: string[]): string | undefined {
  for (const line of lines) {
    for (const label of labels) {
      const m = line.match(new RegExp(`^\\s*${label}:\\s*(.+)$`));
      if (m) return m[1].trim();
    }
  }
  return undefined;
}

function seconds(ms: string): string {
  const n = parseInt(ms, 10);
  return Number.isFinite(n) ? `${Math.round(n / 1000)}s` : `${ms}ms`;
}

/**
 * Turns a Playwright error message into one plain-English sentence.
 * The assertion's own message (e.g. `expect(x, 'Project should be listed')`) is preferred;
 * generic matcher output is translated by matcher name, with the locator / expected / received
 * values appended so the reader sees what was actually on screen. Nothing is guessed from the
 * test ID or module.
 */
export function describeFailure(rawError: string | undefined): string {
  const clean = stripAnsi(rawError || '').trim();
  if (!clean) return 'The test failed without an error message.';

  const lines = clean.split(/\r?\n/).map((l) => l.trimEnd());
  const first = lines[0].replace(/^(?:Error|TimeoutError|AssertionError):\s*/, '').trim();
  const locator = fieldValue(lines, ['Locator']);
  const expected = fieldValue(lines, ['Expected', 'Expected string', 'Expected pattern', 'Expected substring', 'Expected value']);
  const received = fieldValue(lines, ['Received', 'Received string', 'Received value']);
  const waitingFor = lines.map((l) => l.match(/-\s+waiting for (.+)$/)?.[1]).find(Boolean);
  const target = locator || waitingFor;

  const details: string[] = [];
  if (target) details.push(`element: ${truncate(target, 140)}`);
  if (expected) details.push(`expected: ${truncate(expected, 140)}`);
  if (received) details.push(`actual: ${truncate(received, 140)}`);
  const suffix = details.length ? ` (${details.join('; ')})` : '';

  const testTimeout = first.match(/^Test timeout of (\d+)ms exceeded(.*)$/i);
  if (testTimeout) {
    const where = testTimeout[2].replace(/\.$/, '').trim();
    return `The test did not finish within ${seconds(testTimeout[1])}${where ? ` ${where}` : ''}.`;
  }

  const actionTimeout = first.match(/^([\w.]+): Timeout (\d+)ms exceeded/i);
  if (actionTimeout) {
    const action = actionTimeout[1].split('.').pop();
    return `The '${action}' action timed out after ${seconds(actionTimeout[2])}${target ? ` waiting for ${truncate(target, 140)}` : ''}.`;
  }

  if (/net::ERR_|ECONNREFUSED|ENOTFOUND/.test(first)) {
    return `The application could not be reached: ${truncate(first, 200)}`;
  }

  const genericMatcher = first.match(/^(?:Timed out \d+ms waiting for )?expect\((?:locator|page|received|value)\)\.(not\.)?(\w+)\(/);
  if (genericMatcher) {
    const negated = !!genericMatcher[1];
    const matcher = genericMatcher[2];
    const phrase = MATCHER_PHRASES[matcher] || `Check "${matcher}" failed`;
    const timedOut = /^Timed out (\d+)ms/.exec(first);
    const timing = timedOut ? ` within ${seconds(timedOut[1])}` : '';
    return negated ? `Negated check "${matcher}" failed${timing}${suffix}.` : `${phrase}${timing}${suffix}.`;
  }

  // Anything else is either the assertion's custom message or a thrown error: show it as-is.
  return `${truncate(first, 300)}${suffix}`;
}

// ---------------------------------------------------------------------------
// Raw case construction (two sources)
// ---------------------------------------------------------------------------

function outcomeToStatus(outcome: Outcome | undefined, results: Array<{ status?: string }>): CaseStatus {
  switch (outcome) {
    case 'expected':
      return 'passed';
    case 'unexpected':
      return 'failed';
    case 'flaky':
      return 'flaky';
    case 'skipped':
      return 'skipped';
    default: {
      const last = results[results.length - 1];
      if (!last || last.status === 'skipped') return 'skipped';
      if (last.status === 'passed') return results.length > 1 ? 'flaky' : 'passed';
      return 'failed';
    }
  }
}

function errorParts(errors: Array<{ message?: string; stack?: string }> | undefined): { error?: string; stack?: string } {
  if (!errors || errors.length === 0) return {};
  const first = errors[0];
  const message = stripAnsi(first.message || first.stack || '').trim();
  const stack = errors
    .map((e) => stripAnsi(e.stack || e.message || '').trim())
    .filter(Boolean)
    .join('\n\n');
  return { error: message || undefined, stack: stack || undefined };
}

interface AttemptLike {
  status?: string;
  duration: number;
  errors?: Array<{ message?: string; stack?: string }>;
  attachments: Array<{ name: string; contentType: string; path?: string }>;
}

function pickAttachments(status: CaseStatus, results: AttemptLike[]): CaseAttachment[] {
  // Final attempt, plus failed attempts of a flaky test so the transient failure is visible.
  const attempts = status === 'flaky' ? results : results.slice(-1);
  const out: CaseAttachment[] = [];
  attempts.forEach((r, i) => {
    for (const a of r.attachments || []) {
      if (!a.path) continue;
      const label = status === 'flaky' && i < attempts.length - 1 ? `${a.name} (failed attempt ${i + 1})` : a.name;
      out.push({ name: label, contentType: a.contentType, path: a.path });
    }
  });
  return out;
}

function errorsForStatus(status: CaseStatus, results: AttemptLike[]): { error?: string; stack?: string } {
  if (status === 'flaky') {
    const firstFailed = results.find((r) => r.status !== 'passed' && r.status !== 'skipped');
    return errorParts(firstFailed?.errors);
  }
  if (status === 'failed') return errorParts(results[results.length - 1]?.errors);
  return {};
}

function relFile(file: string, rootDir: string): string {
  const rel = rootDir && path.isAbsolute(file) ? path.relative(rootDir, file) : file;
  return rel.replace(/\\/g, '/');
}

/** Builds raw cases from the objects a Playwright reporter receives. */
export function rawCasesFromSuite(rootSuite: Suite, rootDir: string): RawCase[] {
  return rootSuite.allTests().map((test: TestCase) => {
    const results: TestResult[] = test.results;
    const status = outcomeToStatus(test.outcome(), results);
    const last = results[results.length - 1];
    const { error, stack } = errorsForStatus(status, results);
    const steps: CaseStep[] = (last?.steps || []).map((s: TestStep) => ({
      title: s.title,
      durationMs: s.duration,
      ok: !s.error,
    }));
    return {
      title: test.title,
      file: relFile(test.location.file, rootDir),
      line: test.location.line,
      projectName: test.parent.project()?.name || '',
      status,
      durationMs: last?.duration || 0,
      attempts: results.length,
      error,
      errorStack: stack,
      annotations: test.annotations.map((a) => ({ type: a.type, description: a.description })),
      attachments: pickAttachments(status, results),
      steps,
    };
  });
}

function collectSpecs(suite: JSONReportSuite, out: JSONReportSpec[] = []): JSONReportSpec[] {
  for (const spec of suite.specs || []) out.push({ ...spec, file: spec.file || suite.file });
  for (const child of suite.suites || []) collectSpecs(child, out);
  return out;
}

function rawCaseFromJson(spec: JSONReportSpec, test: JSONReportTest): RawCase {
  const results: JSONReportTestResult[] = test.results || [];
  const status = outcomeToStatus(test.status, results);
  const last = results[results.length - 1];
  const { error, stack } = errorsForStatus(status, results);
  return {
    title: spec.title,
    file: spec.file.replace(/\\/g, '/'),
    line: spec.line,
    projectName: test.projectName || '',
    status,
    durationMs: last?.duration || 0,
    attempts: results.length,
    error,
    errorStack: stack,
    annotations: test.annotations || [],
    attachments: pickAttachments(status, results),
    steps: (last?.steps || []).map((s) => ({ title: s.title, durationMs: s.duration, ok: !s.error })),
  };
}

// ---------------------------------------------------------------------------
// Enrichment and run assembly
// ---------------------------------------------------------------------------

const SETUP_PROJECTS = new Set(['setup']);

function skipReasonOf(raw: RawCase): string {
  const ann = raw.annotations.find((a) => a.type === 'skip' || a.type === 'fixme' || a.type === 'fail');
  if (ann?.description) return ann.description;
  if (ann) return ann.type === 'fixme' ? 'Marked as fixme (not yet working).' : 'Skipped by the test without a reason.';
  return 'Not run: an earlier test in the same serial group, a setup step or a dependency failed, or the run was interrupted.';
}

export function enrichCase(raw: RawCase, catalog: Catalog): ReportCase {
  const tcId = extractTcId(raw.title);
  const entry = lookupCatalog(tcId, catalog);
  const cleanTitle = stripTcId(raw.title, tcId);
  const knownDefects = raw.annotations
    .filter((a) => a.type === 'issue')
    .map((a) => a.description || 'Known application defect (no description given).');

  let actualResult: string;
  let failureReason: string | undefined;
  let skipReason: string | undefined;
  switch (raw.status) {
    case 'passed':
      actualResult = 'Passed: every check in this test succeeded.';
      break;
    case 'flaky':
      failureReason = describeFailure(raw.error);
      actualResult = `Flaky: failed on the first attempt and passed on retry (${raw.attempts} attempts). First failure: ${failureReason}`;
      break;
    case 'skipped':
      skipReason = skipReasonOf(raw);
      actualResult = `Skipped: ${skipReason}`;
      break;
    default:
      failureReason = describeFailure(raw.error);
      actualResult = failureReason;
  }
  if (knownDefects.length && raw.status !== 'passed') {
    actualResult += ` Known application defect: ${knownDefects.join('; ')}`;
  }

  return {
    ...raw,
    tcId: tcId || 'NO_ID',
    module: resolveModule(tcId, raw.file),
    inCatalog: !!entry,
    description: entry?.description || cleanTitle,
    plainSteps: entry?.steps || '',
    testData: entry?.testData && entry.testData.trim() !== '-' ? entry.testData : '',
    expectedResult: entry?.expectedResult || '',
    actualResult,
    failureReason,
    skipReason,
    knownDefects,
  };
}

function buildRun(
  raws: RawCase[],
  meta: { startTime: string; durationMs: number; globalErrors: string[]; source: ReportRun['source'] },
  catalog: Catalog,
): ReportRun {
  // A passing auth setup is plumbing, not a test case; keep it only when it breaks the run.
  const visible = raws.filter((r) => !SETUP_PROJECTS.has(r.projectName) || r.status === 'failed');
  return { ...meta, cases: visible.map((r) => enrichCase(r, catalog)) };
}

/** Builds the run from the in-memory objects handed to a reporter's onEnd. */
export function runFromSuite(
  rootSuite: Suite,
  opts: { rootDir: string; startTime: Date; durationMs: number; globalErrors?: string[]; catalog?: Catalog },
): ReportRun {
  return buildRun(
    rawCasesFromSuite(rootSuite, opts.rootDir),
    {
      startTime: opts.startTime.toISOString(),
      durationMs: opts.durationMs,
      globalErrors: opts.globalErrors || [],
      source: 'reporter',
    },
    opts.catalog || loadCatalog(),
  );
}

export function parseSummary(report: JSONReport, catalog: Catalog = loadCatalog()): ReportRun {
  const raws: RawCase[] = [];
  for (const suite of report.suites || []) {
    for (const spec of collectSpecs(suite)) {
      for (const test of spec.tests || []) raws.push(rawCaseFromJson(spec, test));
    }
  }
  return buildRun(
    raws,
    {
      startTime: report.stats?.startTime || new Date(0).toISOString(),
      durationMs: report.stats?.duration || 0,
      globalErrors: (report.errors || []).map((e) => stripAnsi(e.message || e.stack || '').trim()).filter(Boolean),
      source: 'summary.json',
    },
    catalog,
  );
}

export const DEFAULT_SUMMARY_PATH = path.resolve(process.cwd(), 'test-results/summary.json');

/** Reads test-results/summary.json. Throws with a clear message when it is missing or unreadable. */
export function readSummaryJson(summaryPath: string = DEFAULT_SUMMARY_PATH): JSONReport {
  if (!fs.existsSync(summaryPath)) {
    throw new Error(
      `Summary file not found at ${summaryPath}. Run the tests first (the json reporter in playwright.config.ts writes it).`,
    );
  }
  try {
    return JSON.parse(fs.readFileSync(summaryPath, 'utf-8')) as JSONReport;
  } catch (err) {
    throw new Error(`Could not parse ${summaryPath}: ${errorMessage(err)}`);
  }
}

export function loadRunFromSummary(summaryPath: string = DEFAULT_SUMMARY_PATH, catalog?: Catalog): ReportRun {
  return parseSummary(readSummaryJson(summaryPath), catalog);
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export function countStatuses(cases: ReportCase[]): StatusCounts {
  const counts: StatusCounts = { total: 0, passed: 0, failed: 0, flaky: 0, skipped: 0, durationMs: 0 };
  for (const c of cases) {
    counts.total++;
    counts[c.status]++;
    counts.durationMs += c.durationMs;
  }
  return counts;
}

/** Share of tests that ended green (passed or flaky), skipped tests included in the denominator. */
export function passRate(counts: StatusCounts): number {
  return counts.total > 0 ? Math.round(((counts.passed + counts.flaky) / counts.total) * 100) : 0;
}

/** Module summaries in canonical order. `includeEmpty` adds modules with no tests in this run. */
export function summariseModules(cases: ReportCase[], includeEmpty = false): ModuleSummary[] {
  const byKey = new Map<string, ReportCase[]>();
  for (const c of cases) {
    const list = byKey.get(c.module.key) || [];
    list.push(c);
    byKey.set(c.module.key, list);
  }
  const defs = [...MODULES, GENERAL_MODULE].filter((m) => byKey.has(m.key) || (includeEmpty && m !== GENERAL_MODULE));
  return defs.map((module) => {
    const counts = countStatuses(byKey.get(module.key) || []);
    return { module, ...counts, passRate: passRate(counts) };
  });
}

export function knownDefects(cases: ReportCase[]): KnownDefect[] {
  return cases.flatMap((c) =>
    c.knownDefects.map((description) => ({ tcId: c.tcId, title: c.description, description, status: c.status })),
  );
}

export const STATUS_LABEL: Record<CaseStatus, string> = {
  passed: 'Passed',
  failed: 'Failed',
  flaky: 'Flaky',
  skipped: 'Skipped',
};
