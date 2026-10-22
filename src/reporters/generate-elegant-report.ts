import fs from 'fs';
import path from 'path';
import {
  CaseStatus,
  ReportCase,
  ReportRun,
  countStatuses,
  errorMessage,
  escapeHtml,
  formatDuration,
  formatRunTime,
  knownDefects,
  loadRunFromSummary,
  passRate,
  summariseModules,
} from './report-data';

/**
 * Elegant dark HTML report.
 *
 * - `renderElegantReport(run, out)` is called by the ElegantDarkReporter with data collected in memory.
 * - `generateElegantReport(summary, out)` (npm run report:build) rebuilds it from test-results/summary.json.
 *
 * Screenshots are copied to <report dir>/assets/ and linked; videos and traces are linked in place
 * (relative path into test-results/), so the HTML stays small. Upload playwright-report/ and
 * test-results/ together (CI does) to keep every link working.
 */

export const DEFAULT_REPORT_PATH = path.resolve(process.cwd(), 'playwright-report/index.html');

interface MediaItem {
  name: string;
  type: 'image' | 'video' | 'trace';
  src: string;
}

interface CardView {
  id: string;
  tcId: string;
  title: string;
  moduleKey: string;
  moduleName: string;
  moduleShort: string;
  file: string;
  line: number;
  status: CaseStatus;
  attempts: number;
  durationMs: number;
  error?: string;
  errorStack?: string;
  inCatalog: boolean;
  description: string;
  plainSteps: string;
  testData: string;
  expectedResult: string;
  actualResult: string;
  knownDefects: string[];
  steps: Array<{ title: string; durationMs: number; ok: boolean }>;
  media: MediaItem[];
}

interface ModuleView {
  key: string;
  name: string;
  shortName: string;
  icon: string;
  total: number;
  passed: number;
  failed: number;
  flaky: number;
  skipped: number;
}

const STATUS_BADGE: Record<CaseStatus, string> = {
  passed: '✓ PASS',
  failed: '✗ FAIL',
  flaky: '⚠ FLAKY',
  skipped: '● SKIP',
};

const ACTUAL_LABEL: Record<CaseStatus, string> = {
  passed: 'Verified Success',
  failed: 'Why it Failed',
  flaky: 'Passed on Retry',
  skipped: 'Not Executed',
};

const ACTUAL_ICON: Record<CaseStatus, string> = {
  passed: '🟢',
  failed: '🔴',
  flaky: '🟣',
  skipped: '●',
};

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-80);
}

/** Copies screenshots into assets/ and links videos / traces in place. */
function collectMedia(tc: ReportCase, index: number, reportDir: string, assetsDir: string): MediaItem[] {
  const media: MediaItem[] = [];
  tc.attachments.forEach((att, n) => {
    if (!fs.existsSync(att.path)) return;
    const lowerPath = att.path.toLowerCase();
    const isImage = att.contentType.startsWith('image/') || /\.(png|jpe?g)$/.test(lowerPath);
    const isVideo = att.contentType.startsWith('video/') || /\.(webm|mp4)$/.test(lowerPath);
    const isTrace = att.name.startsWith('trace') || lowerPath.endsWith('trace.zip');
    try {
      if (isImage) {
        const fileName = `${index}-${n}-${safeName(path.basename(att.path))}`;
        fs.copyFileSync(att.path, path.join(assetsDir, fileName));
        media.push({ name: att.name || 'Screenshot', type: 'image', src: `assets/${fileName}` });
      } else if (isVideo || isTrace) {
        media.push({
          name: att.name || (isVideo ? 'Video' : 'Trace'),
          type: isVideo ? 'video' : 'trace',
          src: toPosix(path.relative(reportDir, att.path)),
        });
      }
    } catch (err) {
      console.warn(`[ElegantReport] Could not attach ${att.path}: ${errorMessage(err)}`);
    }
  });
  return media;
}

function toCardView(tc: ReportCase, index: number, reportDir: string, assetsDir: string): CardView {
  return {
    id: `case_${index}`,
    tcId: tc.tcId,
    title: tc.title,
    moduleKey: tc.module.key,
    moduleName: tc.module.name,
    moduleShort: tc.module.shortName,
    file: tc.file,
    line: tc.line,
    status: tc.status,
    attempts: tc.attempts,
    durationMs: tc.durationMs,
    error: tc.error,
    errorStack: tc.errorStack,
    inCatalog: tc.inCatalog,
    description: tc.description,
    plainSteps: tc.plainSteps,
    testData: tc.testData,
    expectedResult: tc.expectedResult,
    actualResult: tc.actualResult,
    knownDefects: tc.knownDefects,
    steps: tc.steps,
    media: collectMedia(tc, index, reportDir, assetsDir),
  };
}

// Format test steps cleanly into HTML list
function formatPlainStepsHtml(rawSteps: string): string {
  if (!rawSteps || !rawSteps.trim()) {
    return '<p class="plain-step-fallback">No documented steps: this test ID has no entry in the test catalog (src/test-data/catalog).</p>';
  }
  const lines = rawSteps
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  let html = '<ol class="plain-steps-list">';
  for (const line of lines) {
    const cleanText = line.replace(/^(?:\d+[.)]|-|\*|•)\s*/, '').trim();
    if (cleanText) {
      html += `<li><span class="step-text">${escapeHtml(cleanText)}</span></li>`;
    }
  }
  html += '</ol>';
  return html;
}

function pct(part: number, total: number): number {
  return total > 0 ? (part / total) * 100 : 0;
}

function renderMedia(m: MediaItem): string {
  if (m.type === 'image') {
    return `<img src="${escapeHtml(m.src)}" alt="${escapeHtml(m.name)}" class="media-thumb" loading="lazy" title="${escapeHtml(m.name)} (Click to zoom)">`;
  }
  if (m.type === 'video') {
    return `<video controls preload="none" class="video-player" title="${escapeHtml(m.name)}"><source src="${escapeHtml(m.src)}" type="video/webm">Your browser does not support video playback.</video>`;
  }
  return `<a class="trace-link" href="${escapeHtml(m.src)}" download>🧭 ${escapeHtml(m.name)} — open with <code>npx playwright show-trace</code></a>`;
}

function renderKnownDefectsSection(run: ReportRun): string {
  const defects = knownDefects(run.cases);
  if (defects.length === 0) return '';
  return `
    <section class="defects-section" id="knownDefectsSection">
      <div class="defects-header">
        <span>🐞 Known Application Defects (${defects.length})</span>
        <span class="defects-hint">Tests annotated with <code>{ type: 'issue' }</code>: failures here are expected until the app is fixed</span>
      </div>
      <table class="defects-table">
        <thead><tr><th>Test ID</th><th>Test</th><th>Defect</th><th>Status</th></tr></thead>
        <tbody>
          ${defects
            .map(
              (d) => `
            <tr>
              <td class="mono">${escapeHtml(d.tcId)}</td>
              <td>${escapeHtml(d.title)}</td>
              <td>${escapeHtml(d.description)}</td>
              <td><span class="status-badge ${d.status}">${STATUS_BADGE[d.status]}</span></td>
            </tr>`,
            )
            .join('')}
        </tbody>
      </table>
    </section>`;
}

function renderGlobalErrors(run: ReportRun): string {
  if (run.globalErrors.length === 0) return '';
  return `
    <section class="global-errors">
      <strong>⚠ Run-level errors (not tied to a single test):</strong>
      <pre class="error-stack">${escapeHtml(run.globalErrors.join('\n\n'))}</pre>
    </section>`;
}

function renderCard(tc: CardView): string {
  const search = [tc.title, tc.tcId, tc.description, tc.expectedResult, tc.actualResult, tc.moduleName, tc.testData, ...tc.knownDefects]
    .join(' ')
    .toLowerCase();
  return `
          <div class="test-card" data-id="${escapeHtml(tc.id)}" data-status="${tc.status}" data-module="${escapeHtml(tc.moduleKey)}" data-defect="${tc.knownDefects.length > 0 ? 'yes' : 'no'}" data-title="${escapeHtml(tc.title.toLowerCase())} ${escapeHtml(tc.tcId.toLowerCase())}" data-search="${escapeHtml(search)}">
            <div class="test-card-summary">
              <div class="test-card-left">
                <span class="status-badge ${tc.status}">${STATUS_BADGE[tc.status]}</span>
                <span class="tc-id">${escapeHtml(tc.tcId)}</span>
                <span class="tc-title" title="${escapeHtml(tc.title)}">${escapeHtml(tc.title)}</span>
              </div>
              <div class="test-card-right">
                ${tc.knownDefects.length > 0 ? '<span class="defect-chip" title="Annotated as a known application defect">🐞 known defect</span>' : ''}
                ${tc.attempts > 1 ? `<span class="retry-chip" title="Number of attempts including retries">${tc.attempts} attempts</span>` : ''}
                ${tc.media.length > 0 ? `<span class="media-indicator" title="${tc.media.length} media attached">📸 ${tc.media.length}</span>` : ''}
                <span class="mod-tag">${escapeHtml(tc.moduleShort)}</span>
                <span class="duration-tag">${formatDuration(tc.durationMs)}</span>
                <span class="chevron">▼</span>
              </div>
            </div>

            <div class="test-card-details">
              <div class="details-grid">

                <!-- 1. Objective & Test Data Bar -->
                <div class="tc-objective-bar">
                  <div class="tc-objective-title">
                    <span class="tc-badge-id">${escapeHtml(tc.tcId)}</span>
                    <span class="tc-desc-text">${escapeHtml(tc.description || tc.title)}</span>
                    ${tc.inCatalog ? '' : '<span class="catalog-chip" title="Add this ID to src/test-data/catalog/*.json">not in test catalog</span>'}
                  </div>
                  ${
                    tc.testData
                      ? `
                    <div class="tc-data-badge" title="Input test parameters">
                      <span class="tc-data-label">DATA:</span>
                      <span class="tc-data-val">${escapeHtml(tc.testData)}</span>
                    </div>`
                      : ''
                  }
                </div>
                <div class="location-text">${escapeHtml(tc.file)}:${tc.line}</div>

                <!-- 2. Expected vs. Actual (Plain English) -->
                <div class="results-comparison-grid">
                  <div class="result-card expected-box">
                    <div class="result-card-header">
                      <span class="result-icon">🟢</span>
                      <span class="result-label">Expected Result (Acceptance Criteria)</span>
                    </div>
                    <div class="result-card-body">
                      ${escapeHtml(tc.expectedResult || 'Not documented in the test catalog.')}
                    </div>
                  </div>

                  <div class="result-card actual-box ${tc.status}">
                    <div class="result-card-header">
                      <span class="result-icon">${ACTUAL_ICON[tc.status]}</span>
                      <span class="result-label">Actual Result (${ACTUAL_LABEL[tc.status]})</span>
                    </div>
                    <div class="result-card-body">
                      ${escapeHtml(tc.actualResult)}
                    </div>
                  </div>
                </div>

                <!-- 3. Plain English Test Steps -->
                <div class="plain-steps-box">
                  <h4>📋 Documented Test Steps</h4>
                  ${formatPlainStepsHtml(tc.plainSteps)}
                </div>

                <!-- 4. Technical Diagnostics -->
                ${
                  tc.error
                    ? `
                  <details class="dev-diagnostics-details">
                    <summary class="dev-diagnostics-summary">
                      <span>🛠️ View Technical Stack Trace & Playwright Diagnostic${tc.status === 'flaky' ? ' (first failed attempt)' : ''}</span>
                      <span class="dev-summary-hint">For Engineers & Developers</span>
                    </summary>
                    <div class="failure-box">
                      <div class="failure-header">
                        <span>Playwright Failure Stack:</span>
                        <button class="copy-btn">Copy Stack</button>
                      </div>
                      <pre class="error-stack">${escapeHtml(tc.errorStack || tc.error)}</pre>
                    </div>
                  </details>`
                    : ''
                }

                <!-- 5. Step & Hook Timings -->
                <details class="pw-steps-details">
                  <summary class="pw-steps-summary">
                    <span>⏱️ View Recorded Steps (${tc.steps.length})</span>
                    <span style="font-size: 11px; color: var(--text-dim); font-family: 'JetBrains Mono', monospace;">${formatDuration(tc.durationMs)} total</span>
                  </summary>
                  <ul class="steps-list">
                    ${
                      tc.steps.length === 0
                        ? '<li class="step-item"><div class="step-left"><span>No steps were recorded for this attempt.</span></div></li>'
                        : tc.steps
                            .map(
                              (s) => `
                      <li class="step-item">
                        <div class="step-left">
                          <span class="step-icon ${s.ok ? 'ok' : 'fail'}">${s.ok ? '✓' : '✗'}</span>
                          <span>${escapeHtml(s.title)}</span>
                        </div>
                        <span class="step-dur">${formatDuration(s.durationMs)}</span>
                      </li>`,
                            )
                            .join('')
                    }
                  </ul>
                </details>

                <!-- 6. Evidence -->
                ${
                  tc.media.length > 0
                    ? `
                  <div class="media-box">
                    <h4>📸 Evidence & Media Attachments (${tc.media.length})</h4>
                    <div class="media-container">
                      ${tc.media.map(renderMedia).join('')}
                    </div>
                  </div>`
                    : ''
                }

              </div>
            </div>
          </div>`;
}

/** Renders the report for an already-built run. Returns the size of the HTML in bytes. */
export function renderElegantReport(run: ReportRun, outputHtmlPath: string = DEFAULT_REPORT_PATH): number {
  const outputDir = path.dirname(outputHtmlPath);
  const assetsDir = path.join(outputDir, 'assets');
  // Start from a clean asset folder so screenshots of earlier runs never leak into this report.
  fs.rmSync(assetsDir, { recursive: true, force: true });
  fs.rmSync(path.join(outputDir, 'media'), { recursive: true, force: true });
  fs.mkdirSync(assetsDir, { recursive: true });

  const processedCases = run.cases.map((tc, i) => toCardView(tc, i, outputDir, assetsDir));
  const sortedModules: ModuleView[] = summariseModules(run.cases, true).map((s) => ({
    key: s.module.key,
    name: s.module.name,
    shortName: s.module.shortName,
    icon: s.module.icon,
    total: s.total,
    passed: s.passed,
    failed: s.failed,
    flaky: s.flaky,
    skipped: s.skipped,
  }));

  const counts = countStatuses(run.cases);
  const totalTests = counts.total;
  const passedTests = counts.passed;
  const failedTests = counts.failed;
  const flakyTests = counts.flaky;
  const skippedTests = counts.skipped;
  const overallPassRate = passRate(counts);
  const totalDurationMs = run.durationMs || counts.durationMs;
  const activeModules = sortedModules.filter((m) => m.total > 0).length;
  const { date: dateStr, time, zone } = formatRunTime(run.startTime);
  const timeStr = `${time} ${zone}`;
  const defectsSection = renderKnownDefectsSection(run);
  const globalErrorsSection = renderGlobalErrors(run);

  const htmlReport = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RiverStream QA Automation — Executive Test Report</title>
  <meta name="rs-run-start" content="${escapeHtml(run.startTime)}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-base: #07090e;
      --bg-sidebar: #0b0f19;
      --bg-surface: #111827;
      --bg-card: rgba(17, 24, 39, 0.85);
      --bg-elevated: #1e293b;
      --border-subtle: rgba(255, 255, 255, 0.08);
      --border-active: rgba(99, 102, 241, 0.4);
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
      --text-dim: #64748b;
      
      /* Vibrant Status Colors */
      --color-pass: #10b981;
      --color-pass-glow: rgba(16, 185, 129, 0.25);
      --color-fail: #ef4444;
      --color-fail-glow: rgba(239, 68, 68, 0.3);
      --color-skip: #f59e0b;
      --color-skip-glow: rgba(245, 158, 11, 0.25);
      --color-flaky: #a855f7;
      --color-flaky-glow: rgba(168, 85, 247, 0.3);
      --color-brand: #6366f1;
      --color-cyan: #06b6d4;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
      background-color: var(--bg-base);
      color: var(--text-main);
      display: flex;
      min-height: 100vh;
      overflow-x: hidden;
    }

    /* Scrollbar */
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: var(--bg-base); }
    ::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: #475569; }

    /* Left Sidebar */
    aside.sidebar {
      width: 300px;
      background: var(--bg-sidebar);
      border-right: 1px solid var(--border-subtle);
      display: flex;
      flex-direction: column;
      position: fixed;
      top: 0;
      bottom: 0;
      left: 0;
      z-index: 50;
      user-select: none;
    }

    .brand-header {
      padding: 24px 20px 18px;
      border-bottom: 1px solid var(--border-subtle);
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .brand-logo {
      width: 38px;
      height: 38px;
      background: linear-gradient(135deg, #6366f1 0%, #06b6d4 100%);
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      box-shadow: 0 4px 15px rgba(99, 102, 241, 0.4);
    }
    .brand-text h1 {
      font-size: 15px;
      font-weight: 800;
      letter-spacing: -0.02em;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .brand-text p {
      font-size: 12px;
      color: var(--text-muted);
      margin-top: 2px;
    }
    .live-pulse {
      display: inline-block;
      width: 7px;
      height: 7px;
      background: #10b981;
      border-radius: 50%;
      box-shadow: 0 0 8px #10b981;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); }
      70% { transform: scale(1); box-shadow: 0 0 0 6px rgba(16, 185, 129, 0); }
      100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
    }

    .sidebar-search {
      padding: 16px 20px 12px;
    }
    .search-input-wrapper {
      position: relative;
    }
    .search-input-wrapper input {
      width: 100%;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      padding: 9px 12px 9px 34px;
      color: #fff;
      font-size: 13px;
      outline: none;
      transition: all 0.2s ease;
    }
    .search-input-wrapper input:focus {
      border-color: var(--color-brand);
      background: rgba(255, 255, 255, 0.07);
      box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2);
    }
    .search-icon {
      position: absolute;
      left: 11px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--text-dim);
      font-size: 14px;
    }

    .sidebar-menu {
      flex: 1;
      overflow-y: auto;
      padding: 10px 14px;
    }
    .menu-category {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--text-dim);
      padding: 12px 10px 6px;
    }

    .nav-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 12px;
      margin-bottom: 4px;
      border-radius: 8px;
      color: var(--text-muted);
      text-decoration: none;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.18s ease;
      border: 1px solid transparent;
    }
    .nav-item:hover {
      background: rgba(255, 255, 255, 0.06);
      color: #fff;
    }
    .nav-item.active {
      background: linear-gradient(90deg, rgba(99, 102, 241, 0.2) 0%, rgba(6, 182, 212, 0.1) 100%);
      color: #fff;
      border-color: rgba(99, 102, 241, 0.4);
      box-shadow: inset 3px 0 0 #6366f1;
    }
    .nav-item-left {
      display: flex;
      align-items: center;
      gap: 10px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .nav-badge {
      font-size: 11px;
      font-weight: 700;
      padding: 2px 7px;
      border-radius: 9999px;
      background: rgba(255, 255, 255, 0.06);
    }
    .nav-badge.fail {
      background: rgba(239, 68, 68, 0.2);
      color: #f87171;
      border: 1px solid rgba(239, 68, 68, 0.35);
    }
    .nav-badge.pass {
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.3);
    }
    .nav-badge.flaky {
      background: rgba(168, 85, 247, 0.15);
      color: #c084fc;
      border: 1px solid rgba(168, 85, 247, 0.35);
    }
    .nav-item.empty { opacity: 0.45; }

    .sidebar-footer {
      padding: 14px 18px;
      border-top: 1px solid var(--border-subtle);
      font-size: 11px;
      color: var(--text-dim);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    /* Main Container */
    main.main-content {
      margin-left: 300px;
      flex: 1;
      padding: 30px 40px 60px;
      max-width: 1500px;
    }

    /* Top Navigation Bar */
    .top-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 28px;
      flex-wrap: wrap;
      gap: 16px;
    }
    .header-titles h2 {
      font-size: 24px;
      font-weight: 800;
      letter-spacing: -0.02em;
      color: #fff;
    }
    .header-titles p {
      font-size: 13px;
      color: var(--text-muted);
      margin-top: 4px;
    }
    .header-actions {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    /* Filter Pills */
    .filter-pills {
      display: flex;
      gap: 8px;
      background: var(--bg-surface);
      padding: 4px;
      border-radius: 10px;
      border: 1px solid var(--border-subtle);
    }
    .pill-btn {
      padding: 7px 14px;
      font-size: 13px;
      font-weight: 700;
      border-radius: 7px;
      border: none;
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: all 0.2s ease;
    }
    .pill-btn:hover { color: #fff; background: rgba(255, 255, 255, 0.05); }
    .pill-btn.active[data-filter="all"] {
      background: var(--color-brand);
      color: #fff;
      box-shadow: 0 2px 10px rgba(99, 102, 241, 0.35);
    }
    .pill-btn.active[data-filter="passed"] {
      background: var(--color-pass);
      color: #fff;
      box-shadow: 0 2px 10px var(--color-pass-glow);
    }
    .pill-btn.active[data-filter="failed"] {
      background: var(--color-fail);
      color: #fff;
      box-shadow: 0 2px 10px var(--color-fail-glow);
    }
    .pill-btn.active[data-filter="flaky"] {
      background: var(--color-flaky);
      color: #fff;
      box-shadow: 0 2px 10px var(--color-flaky-glow);
    }
    .pill-btn.active[data-filter="skipped"] {
      background: var(--color-skip);
      color: #fff;
      box-shadow: 0 2px 10px var(--color-skip-glow);
    }

    /* Executive KPI Grid */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
      gap: 18px;
      margin-bottom: 26px;
    }
    .kpi-card {
      background: var(--bg-card);
      border-radius: 14px;
      padding: 22px;
      border: 1px solid var(--border-subtle);
      position: relative;
      overflow: hidden;
      backdrop-filter: blur(12px);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .kpi-card:hover {
      transform: translateY(-3px);
      border-color: rgba(255, 255, 255, 0.22);
      box-shadow: 0 8px 25px rgba(0, 0, 0, 0.4);
    }
    .kpi-card::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 3px;
    }
    .kpi-card.total::before { background: linear-gradient(90deg, #6366f1, #06b6d4); }
    .kpi-card.passed::before { background: #10b981; }
    .kpi-card.failed::before { background: #ef4444; }
    .kpi-card.flaky::before { background: #a855f7; }
    .kpi-card.rate::before { background: linear-gradient(90deg, #10b981, #06b6d4); }

    .kpi-title {
      font-size: 12px;
      font-weight: 700;
      color: var(--text-dim);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .kpi-value-row {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      margin-top: 10px;
    }
    .kpi-number {
      font-size: 34px;
      font-weight: 800;
      letter-spacing: -0.03em;
    }
    .kpi-card.total .kpi-number { color: #f8fafc; }
    .kpi-card.passed .kpi-number { color: #34d399; text-shadow: 0 0 16px rgba(16, 185, 129, 0.4); }
    .kpi-card.failed .kpi-number { color: #f87171; text-shadow: 0 0 16px rgba(239, 68, 68, 0.4); }
    .kpi-card.flaky .kpi-number { color: #c084fc; text-shadow: 0 0 16px rgba(168, 85, 247, 0.4); }
    .kpi-card.rate .kpi-number { color: #38bdf8; }

    .kpi-subtext {
      font-size: 12px;
      color: var(--text-muted);
      margin-top: 6px;
    }

    /* Multi-segment Split Progress Bar */
    .split-bar-container {
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 12px;
      padding: 18px 22px;
      margin-bottom: 26px;
    }
    .split-bar-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 13px;
      font-weight: 700;
      margin-bottom: 12px;
    }
    .multi-progress {
      height: 12px;
      background: rgba(255, 255, 255, 0.06);
      border-radius: 9999px;
      display: flex;
      overflow: hidden;
      gap: 2px;
    }
    .prog-segment {
      height: 100%;
      transition: width 0.6s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .prog-segment.pass { background: #10b981; box-shadow: 0 0 8px #10b981; }
    .prog-segment.fail { background: #ef4444; box-shadow: 0 0 8px #ef4444; }
    .prog-segment.flaky { background: #a855f7; }
    .prog-segment.skip { background: #f59e0b; }
    .split-legend {
      display: flex;
      gap: 20px;
      margin-top: 12px;
      font-size: 12px;
      color: var(--text-muted);
    }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
    }
    .legend-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }
    .legend-dot.pass { background: #10b981; }
    .legend-dot.fail { background: #ef4444; }
    .legend-dot.flaky { background: #a855f7; }
    .legend-dot.skip { background: #f59e0b; }

    /* Known defects & run-level errors */
    .defects-section, .global-errors {
      background: var(--bg-card);
      border: 1px solid rgba(168, 85, 247, 0.35);
      border-radius: 12px;
      padding: 18px 22px;
      margin-bottom: 26px;
    }
    .global-errors { border-color: rgba(239, 68, 68, 0.45); color: #fecaca; font-size: 13px; }
    .global-errors .error-stack { margin-top: 10px; }
    .defects-header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      flex-wrap: wrap;
      gap: 8px;
      font-size: 14px;
      font-weight: 800;
      margin-bottom: 12px;
    }
    .defects-hint { font-size: 12px; font-weight: 500; color: var(--text-muted); }
    .defects-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .defects-table th {
      text-align: left;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-dim);
      padding: 6px 10px;
      border-bottom: 1px solid var(--border-subtle);
    }
    .defects-table td { padding: 8px 10px; border-bottom: 1px solid var(--border-subtle); vertical-align: top; color: #e2e8f0; }
    .defects-table .mono, .mono { font-family: 'JetBrains Mono', monospace; color: #a5b4fc; white-space: nowrap; }
    .defect-chip, .retry-chip, .catalog-chip {
      font-size: 11px;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 6px;
      white-space: nowrap;
    }
    .defect-chip { background: rgba(168, 85, 247, 0.15); color: #d8b4fe; border: 1px solid rgba(168, 85, 247, 0.4); }
    .retry-chip { background: rgba(255, 255, 255, 0.05); color: var(--text-muted); border: 1px solid var(--border-subtle); }
    .catalog-chip { background: rgba(245, 158, 11, 0.1); color: #fcd34d; border: 1px solid rgba(245, 158, 11, 0.3); }
    .trace-link { color: var(--color-cyan); font-size: 13px; align-self: center; }
    .location-text { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--text-dim); }

    /* Test Cases Table / List */
    .test-list-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
      flex-wrap: wrap;
      gap: 12px;
    }
    .test-list-title {
      font-size: 17px;
      font-weight: 800;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .active-filter-badge {
      font-size: 12px;
      padding: 3px 10px;
      border-radius: 9999px;
      background: rgba(99, 102, 241, 0.2);
      color: #a5b4fc;
      border: 1px solid rgba(99, 102, 241, 0.4);
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .clear-filter-btn {
      background: none;
      border: none;
      color: #f87171;
      cursor: pointer;
      font-weight: bold;
      font-size: 14px;
    }
    .action-controls {
      display: flex;
      gap: 8px;
    }
    .mini-btn {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
      color: var(--text-muted);
      padding: 6px 12px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .mini-btn:hover {
      background: rgba(255, 255, 255, 0.1);
      color: #fff;
    }

    .test-cards-wrapper {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .test-card {
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 12px;
      overflow: hidden;
      transition: all 0.2s ease;
    }
    .test-card:hover {
      border-color: rgba(255, 255, 255, 0.16);
      background: rgba(23, 32, 54, 0.9);
    }
    .test-card-summary {
      padding: 16px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      cursor: pointer;
      gap: 16px;
      user-select: none;
    }
    .test-card-left {
      display: flex;
      align-items: center;
      gap: 14px;
      flex: 1;
      overflow: hidden;
    }
    .status-badge {
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 4px 10px;
      border-radius: 6px;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      white-space: nowrap;
    }
    .status-badge.passed {
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.35);
    }
    .status-badge.failed {
      background: rgba(239, 68, 68, 0.18);
      color: #f87171;
      border: 1px solid rgba(239, 68, 68, 0.4);
    }
    .status-badge.flaky {
      background: rgba(168, 85, 247, 0.16);
      color: #c084fc;
      border: 1px solid rgba(168, 85, 247, 0.4);
    }
    .status-badge.skipped {
      background: rgba(245, 158, 11, 0.15);
      color: #fbbf24;
      border: 1px solid rgba(245, 158, 11, 0.3);
    }

    .tc-id {
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      font-weight: 700;
      color: #a5b4fc;
      white-space: nowrap;
    }
    .tc-title {
      font-size: 14px;
      font-weight: 600;
      color: #f1f5f9;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .test-card-right {
      display: flex;
      align-items: center;
      gap: 14px;
      white-space: nowrap;
    }
    .media-indicator {
      font-size: 13px;
      color: var(--color-cyan);
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .mod-tag {
      font-size: 11px;
      padding: 3px 8px;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 6px;
      color: var(--text-dim);
    }
    .duration-tag {
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      color: var(--text-muted);
    }
    .chevron {
      color: var(--text-dim);
      transition: transform 0.25s ease;
      font-size: 13px;
      display: inline-block;
    }
    .test-card.open .chevron {
      transform: rotate(180deg);
    }

    /* Test Card Details Accordion */
    .test-card-details {
      display: none;
      padding: 20px 22px 24px;
      border-top: 1px solid var(--border-subtle);
      background: rgba(10, 15, 26, 0.7);
    }
    .test-card.open .test-card-details {
      display: block;
    }

    .details-grid {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    /* Test Case Objective Bar */
    .tc-objective-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
      padding: 12px 16px;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
    }
    .tc-objective-title {
      display: flex;
      align-items: center;
      gap: 10px;
      flex: 1;
      min-width: 250px;
    }
    .tc-badge-id {
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      font-weight: 700;
      padding: 3px 8px;
      background: rgba(99, 102, 241, 0.2);
      border: 1px solid rgba(99, 102, 241, 0.4);
      color: #a5b4fc;
      border-radius: 4px;
    }
    .tc-desc-text {
      font-size: 14px;
      font-weight: 600;
      color: #f1f5f9;
      line-height: 1.4;
    }
    .tc-data-badge {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      padding: 5px 10px;
      background: rgba(6, 182, 212, 0.1);
      border: 1px solid rgba(6, 182, 212, 0.3);
      border-radius: 6px;
      color: #a5f3fc;
      max-width: 100%;
      word-break: break-all;
    }
    .tc-data-label {
      font-weight: 800;
      letter-spacing: 0.05em;
      color: #38bdf8;
    }
    .tc-data-val {
      font-family: 'JetBrains Mono', monospace;
      color: #e0f2fe;
    }

    /* Expected vs. Actual Results Comparison Grid */
    .results-comparison-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 14px;
    }
    .result-card {
      border-radius: 10px;
      padding: 14px 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .result-card.expected-box {
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(5, 150, 105, 0.04) 100%);
      border: 1px solid rgba(16, 185, 129, 0.35);
    }
    .result-card.actual-box.passed {
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(5, 150, 105, 0.04) 100%);
      border: 1px solid rgba(16, 185, 129, 0.35);
    }
    .result-card.actual-box.failed {
      background: linear-gradient(135deg, rgba(239, 68, 68, 0.12) 0%, rgba(185, 28, 28, 0.06) 100%);
      border: 1px solid rgba(239, 68, 68, 0.45);
    }
    .result-card.actual-box.flaky {
      background: rgba(168, 85, 247, 0.08);
      border: 1px solid rgba(168, 85, 247, 0.4);
    }
    .result-card.actual-box.skipped {
      background: rgba(245, 158, 11, 0.08);
      border: 1px solid rgba(245, 158, 11, 0.35);
    }
    .result-card-header {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .result-card.expected-box .result-label {
      font-size: 12px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #34d399;
    }
    .result-card.actual-box.passed .result-label {
      font-size: 12px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #34d399;
    }
    .result-card.actual-box.failed .result-label {
      font-size: 12px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #f87171;
    }
    .result-card.actual-box.flaky .result-label {
      font-size: 12px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #c084fc;
    }
    .result-card.actual-box.skipped .result-label {
      font-size: 12px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #fbbf24;
    }
    .result-card-body {
      font-size: 13px;
      line-height: 1.5;
      color: #e2e8f0;
      font-weight: 500;
    }
    .result-card.actual-box.failed .result-card-body {
      color: #fecaca;
      font-weight: 600;
    }

    /* Plain English Steps List */
    .plain-steps-box {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      padding: 14px 16px;
    }
    .plain-steps-box h4 {
      font-size: 12px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-dim);
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .plain-steps-list {
      margin: 0;
      padding-left: 20px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .plain-steps-list li {
      font-size: 13px;
      color: #cbd5e1;
      line-height: 1.45;
    }
    .plain-steps-list li::marker {
      color: #818cf8;
      font-weight: 700;
      font-family: 'JetBrains Mono', monospace;
    }
    .plain-step-fallback {
      font-size: 13px;
      color: var(--text-muted);
      margin: 0;
    }

    /* Developer Diagnostics Collapsible Details */
    .dev-diagnostics-details {
      margin-top: 4px;
      border: 1px solid rgba(239, 68, 68, 0.3);
      border-radius: 8px;
      background: rgba(15, 23, 42, 0.6);
      overflow: hidden;
    }
    .dev-diagnostics-summary {
      padding: 10px 14px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 700;
      color: #f87171;
      background: rgba(239, 68, 68, 0.08);
      display: flex;
      justify-content: space-between;
      align-items: center;
      user-select: none;
      transition: background 0.2s ease;
    }
    .dev-diagnostics-summary:hover {
      background: rgba(239, 68, 68, 0.14);
    }
    .dev-summary-hint {
      font-size: 11px;
      font-weight: 500;
      color: #fca5a5;
      opacity: 0.8;
    }
    .failure-box {
      padding: 14px 16px;
      background: rgba(0, 0, 0, 0.3);
    }
    .failure-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 12px;
      font-weight: 700;
      color: #fca5a5;
      margin-bottom: 8px;
    }
    .copy-btn {
      background: rgba(239, 68, 68, 0.2);
      border: 1px solid rgba(239, 68, 68, 0.4);
      color: #fca5a5;
      font-size: 11px;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: 4px;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .copy-btn:hover { background: rgba(239, 68, 68, 0.35); }
    .error-stack {
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      color: #fca5a5;
      white-space: pre-wrap;
      word-break: break-all;
      line-height: 1.5;
      max-height: 250px;
      overflow-y: auto;
      margin: 0;
    }

    /* Playwright Step Timings Collapsible Details */
    .pw-steps-details {
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      background: rgba(15, 23, 42, 0.4);
      overflow: hidden;
    }
    .pw-steps-summary {
      padding: 9px 14px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      color: var(--text-muted);
      background: rgba(255, 255, 255, 0.02);
      display: flex;
      justify-content: space-between;
      align-items: center;
      user-select: none;
    }
    .pw-steps-summary:hover {
      background: rgba(255, 255, 255, 0.05);
      color: #fff;
    }
    .steps-list {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 10px 14px;
      margin: 0;
    }
    .step-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 10px;
      background: rgba(255, 255, 255, 0.02);
      border-radius: 4px;
      font-size: 12px;
    }
    .step-left {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .step-icon { font-size: 12px; }
    .step-icon.ok { color: #10b981; }
    .step-icon.fail { color: #ef4444; }
    .step-dur {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      color: var(--text-dim);
    }

    /* Screenshots & Media */
    .media-box {
      margin-top: 14px;
    }
    .media-box h4 {
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-dim);
      margin-bottom: 10px;
    }
    .media-container {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
    }
    .media-thumb {
      max-width: 320px;
      max-height: 200px;
      border-radius: 8px;
      border: 1px solid var(--border-subtle);
      cursor: pointer;
      transition: transform 0.2s ease, border-color 0.2s ease;
    }
    .media-thumb:hover {
      transform: scale(1.02);
      border-color: var(--color-cyan);
    }
    .video-player {
      max-width: 480px;
      border-radius: 8px;
      border: 1px solid var(--border-subtle);
      background: #000;
    }

    /* Lightbox Modal */
    .lightbox-modal {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.9);
      backdrop-filter: blur(8px);
      z-index: 100;
      align-items: center;
      justify-content: center;
      padding: 30px;
    }
    .lightbox-modal.open { display: flex; }
    .lightbox-content {
      max-width: 95%;
      max-height: 95%;
      border-radius: 10px;
      border: 1px solid var(--border-subtle);
      box-shadow: 0 0 40px rgba(0,0,0,0.8);
    }
    .lightbox-close {
      position: absolute;
      top: 24px;
      right: 28px;
      font-size: 32px;
      color: #fff;
      cursor: pointer;
      user-select: none;
    }

    /* Empty state */
    .empty-state {
      text-align: center;
      padding: 50px 20px;
      color: var(--text-dim);
      background: var(--bg-card);
      border-radius: 12px;
      border: 1px dashed var(--border-subtle);
    }

    /* Responsive */
    @media (max-width: 1024px) {
      aside.sidebar { transform: translateX(-100%); transition: transform 0.3s ease; }
      aside.sidebar.mobile-open { transform: translateX(0); }
      main.main-content { margin-left: 0 !important; }
    }

    /* Print & PDF Export Styles */
    @media print {
      body {
        background: #ffffff !important;
        color: #0f172a !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      aside.sidebar,
      .top-header .header-actions,
      .action-controls,
      .filter-pills,
      .copy-btn,
      .lightbox-modal,
      .chevron,
      #emptyState,
      .empty-state {
        display: none !important;
      }
      main.main-content {
        margin-left: 0 !important;
        padding: 0 !important;
        max-width: 100% !important;
      }
      .top-header {
        margin-bottom: 20px !important;
        border-bottom: 2px solid #0f172a !important;
        padding-bottom: 12px !important;
      }
      .header-titles h2 {
        color: #0f172a !important;
        font-size: 24px !important;
        font-weight: 800 !important;
      }
      .header-titles p {
        color: #475569 !important;
        font-size: 13px !important;
      }
      .kpi-card, .split-bar-container {
        border: 1px solid #cbd5e1 !important;
        background: #f8fafc !important;
        color: #0f172a !important;
        box-shadow: none !important;
      }
      .kpi-title, .kpi-subtext {
        color: #475569 !important;
      }
      .kpi-number {
        color: #0f172a !important;
        font-size: 26px !important;
        font-weight: 800 !important;
      }
      .kpi-card.passed .kpi-number {
        color: #16a34a !important;
      }
      .kpi-card.failed .kpi-number {
        color: #dc2626 !important;
      }
      .kpi-card.flaky .kpi-number {
        color: #9333ea !important;
      }
      .kpi-card.rate .kpi-number {
        color: #0284c7 !important;
      }
      .split-bar-header {
        color: #0f172a !important;
        font-weight: 700 !important;
      }
      .test-list-header {
        margin-top: 24px !important;
        margin-bottom: 12px !important;
        border-bottom: 1px solid #e2e8f0 !important;
        padding-bottom: 8px !important;
      }
      .test-list-title, .test-list-title span {
        color: #0f172a !important;
        font-size: 18px !important;
        font-weight: 800 !important;
      }
      .count-indicator {
        color: #64748b !important;
        font-size: 13px !important;
      }
      .test-card {
        display: block !important;
        break-inside: avoid !important;
        page-break-inside: avoid !important;
        border: 1px solid #cbd5e1 !important;
        background: #ffffff !important;
        margin-bottom: 14px !important;
        box-shadow: none !important;
      }
      .test-card-summary {
        background: #f8fafc !important;
        border-bottom: 1px solid #e2e8f0 !important;
        padding: 12px 16px !important;
      }
      .tc-id {
        color: #4338ca !important;
        font-weight: 800 !important;
        font-size: 13px !important;
      }
      .tc-title {
        color: #0f172a !important;
        font-weight: 700 !important;
        font-size: 14px !important;
      }
      .mod-tag {
        color: #334155 !important;
        background: #e2e8f0 !important;
        border: 1px solid #cbd5e1 !important;
        font-weight: 600 !important;
      }
      .duration-tag {
        color: #64748b !important;
        font-weight: 600 !important;
      }
      .test-card-details {
        display: block !important;
        background: #ffffff !important;
        border-top: 1px solid #e2e8f0 !important;
        padding: 16px 18px !important;
      }
      .tc-objective-bar {
        background: #f8fafc !important;
        border: 1px solid #e2e8f0 !important;
      }
      .tc-desc-text {
        color: #0f172a !important;
        font-weight: 600 !important;
      }
      .tc-data-badge {
        background: #f0f9ff !important;
        border: 1px solid #bae6fd !important;
      }
      .tc-data-label {
        color: #0369a1 !important;
      }
      .tc-data-val {
        color: #0c4a6e !important;
        font-weight: 600 !important;
      }
      .result-card.expected-box {
        background: #f0fdf4 !important;
        border: 1px solid #86efac !important;
        color: #15803d !important;
      }
      .result-card.actual-box.failed {
        background: #fef2f2 !important;
        border: 1px solid #fca5a5 !important;
        color: #b91c1c !important;
      }
      .result-card.actual-box.passed {
        background: #f0fdf4 !important;
        border: 1px solid #86efac !important;
        color: #15803d !important;
      }
      .result-card.actual-box.flaky {
        background: #faf5ff !important;
        border: 1px solid #d8b4fe !important;
        color: #6b21a8 !important;
      }
      .result-card.actual-box.skipped {
        background: #fffbeb !important;
        border: 1px solid #fcd34d !important;
        color: #92400e !important;
      }
      .result-card.expected-box .result-card-body {
        color: #14532d !important;
        font-weight: 500 !important;
      }
      .result-card.actual-box .result-card-body {
        color: #1e293b !important;
        font-weight: 500 !important;
      }
      .defects-section, .global-errors {
        background: #ffffff !important;
        border: 1px solid #cbd5e1 !important;
        color: #0f172a !important;
      }
      .defects-table td { color: #0f172a !important; }
      .video-player, .trace-link, .pw-steps-details {
        display: none !important;
      }
      .plain-steps-box {
        background: #f8fafc !important;
        border: 1px solid #e2e8f0 !important;
      }
      .plain-steps-list li {
        color: #1e293b !important;
      }
      .dev-diagnostics-details {
        display: none !important; /* Hide raw Playwright code dumps in formal executive printed PDF */
      }
    }
  </style>
</head>
<body>

  <!-- Left Sidebar Navigation Menu -->
  <aside class="sidebar">
    <div class="brand-header">
      <div class="brand-logo">🌊</div>
      <div class="brand-text">
        <h1>RiverStream QA <span class="live-pulse"></span></h1>
        <p>Enterprise Automation Suite</p>
      </div>
    </div>

    <div class="sidebar-search">
      <div class="search-input-wrapper">
        <span class="search-icon">🔍</span>
        <input type="text" id="sidebarSearch" placeholder="Search test cases, ID, errors...">
      </div>
    </div>

    <div class="sidebar-menu">
      <div class="menu-category">Views</div>
      <div class="nav-item active" data-nav="overview">
        <div class="nav-item-left">
          <span>📊</span>
          <span>Executive Overview</span>
        </div>
        <span class="nav-badge pass">${passedTests + flakyTests}/${totalTests}</span>
      </div>

      <div class="nav-item" data-nav="failures">
        <div class="nav-item-left">
          <span>🚨</span>
          <span>Failures Hub</span>
        </div>
        <span class="nav-badge ${failedTests > 0 ? 'fail' : 'pass'}">${failedTests}</span>
      </div>

      <div class="nav-item" data-nav="flaky">
        <div class="nav-item-left">
          <span>🟣</span>
          <span>Flaky Tests</span>
        </div>
        <span class="nav-badge ${flakyTests > 0 ? 'flaky' : 'pass'}">${flakyTests}</span>
      </div>

      ${
        defectsSection
          ? `<div class="nav-item" data-nav="defects">
        <div class="nav-item-left">
          <span>🐞</span>
          <span>Known Defects</span>
        </div>
        <span class="nav-badge flaky">${knownDefects(run.cases).length}</span>
      </div>`
          : ''
      }

      <div class="nav-item" data-nav="gallery">
        <div class="nav-item-left">
          <span>📸</span>
          <span>Evidence Gallery</span>
        </div>
      </div>

      <div class="menu-category">Modules (Clickable Navigation)</div>
      ${sortedModules
        .map(
          (m) => `
        <div class="nav-item${m.total === 0 ? ' empty' : ''}" data-nav="module" data-module-key="${m.key}" title="${escapeHtml(m.name)}${m.total === 0 ? ' (not part of this run)' : ''}">
          <div class="nav-item-left">
            <span>${m.icon}</span>
            <span>${escapeHtml(m.shortName)}</span>
          </div>
          <span class="nav-badge ${m.failed > 0 ? 'fail' : m.flaky > 0 ? 'flaky' : 'pass'}">${m.total === 0 ? '—' : `${m.passed + m.flaky}/${m.total}`}</span>
        </div>
      `,
        )
        .join('')}
    </div>

    <div class="sidebar-footer">
      <span>QA — Riverstone Org</span>
      <span>${timeStr}</span>
    </div>
  </aside>

  <!-- Main Content Area -->
  <main class="main-content">
    
    <!-- Top Header -->
    <header class="top-header">
      <div class="header-titles">
        <h2 id="viewHeading">Execution Dashboard</h2>
        <p id="viewSubheading">Automated regression run executed on <strong>${dateStr}</strong> at <strong>${timeStr}</strong> against RiverStream QA</p>
      </div>

      <div class="header-actions">
        <!-- Colorful Status Split Pills -->
        <div class="filter-pills">
          <button class="pill-btn active" data-filter="all">
            All (${totalTests})
          </button>
          <button class="pill-btn" data-filter="passed">
            ● Passed (${passedTests})
          </button>
          <button class="pill-btn" data-filter="failed">
            ● Failed (${failedTests})
          </button>
          <button class="pill-btn" data-filter="flaky">
            ● Flaky (${flakyTests})
          </button>
          <button class="pill-btn" data-filter="skipped">
            ● Skipped (${skippedTests})
          </button>
        </div>
      </div>
    </header>

    <!-- Executive KPI Grid (Split metrics, fully clickable!) -->
    <section class="kpi-grid">
      <div class="kpi-card total" data-filter="all" title="Click to view all test cases">
        <div class="kpi-title">
          <span>Total Tests Executed</span>
          <span>⚡</span>
        </div>
        <div class="kpi-value-row">
          <span class="kpi-number">${totalTests}</span>
        </div>
        <div class="kpi-subtext">Across ${activeModules} test modules · Click to view all</div>
      </div>

      <div class="kpi-card passed" data-filter="passed" title="Click to filter passed cases">
        <div class="kpi-title">
          <span>Passed Cases</span>
          <span style="color: #10b981; font-size: 16px;">✓</span>
        </div>
        <div class="kpi-value-row">
          <span class="kpi-number">${passedTests}</span>
        </div>
        <div class="kpi-subtext">Passed on the first attempt · Click to filter</div>
      </div>

      <div class="kpi-card failed" data-filter="failed" title="Click to filter failed cases">
        <div class="kpi-title">
          <span>Failed Cases</span>
          <span style="color: #ef4444; font-size: 16px;">✗</span>
        </div>
        <div class="kpi-value-row">
          <span class="kpi-number">${failedTests}</span>
        </div>
        <div class="kpi-subtext">${failedTests === 0 ? 'Zero regression defects' : 'Needs immediate QA review · Click to filter'}</div>
      </div>

      <div class="kpi-card flaky" data-filter="flaky" title="Click to filter flaky cases">
        <div class="kpi-title">
          <span>Flaky Cases</span>
          <span style="color: #a855f7; font-size: 16px;">⚠</span>
        </div>
        <div class="kpi-value-row">
          <span class="kpi-number">${flakyTests}</span>
        </div>
        <div class="kpi-subtext">${flakyTests === 0 ? 'No test needed a retry' : 'Failed first, passed on retry · Click to filter'}</div>
      </div>

      <div class="kpi-card rate" data-filter="all" title="Total Execution Duration">
        <div class="kpi-title">
          <span>Pass Rate & Duration</span>
          <span>⏱️</span>
        </div>
        <div class="kpi-value-row">
          <span class="kpi-number">${overallPassRate}%</span>
        </div>
        <div class="kpi-subtext">Passed + flaky of all tests · Run time: ${formatDuration(totalDurationMs)}</div>
      </div>
    </section>

    <!-- Multi-Segment Split Progress Bar -->
    <section class="split-bar-container">
      <div class="split-bar-header">
        <span>Execution Status Split</span>
        <span>${passedTests} Passed · ${failedTests} Failed · ${flakyTests} Flaky · ${skippedTests} Skipped</span>
      </div>
      <div class="multi-progress">
        <div class="prog-segment pass" style="width: ${pct(passedTests, totalTests)}%;" title="Passed: ${passedTests}"></div>
        <div class="prog-segment fail" style="width: ${pct(failedTests, totalTests)}%;" title="Failed: ${failedTests}"></div>
        <div class="prog-segment flaky" style="width: ${pct(flakyTests, totalTests)}%;" title="Flaky: ${flakyTests}"></div>
        <div class="prog-segment skip" style="width: ${pct(skippedTests, totalTests)}%;" title="Skipped: ${skippedTests}"></div>
      </div>
      <div class="split-legend">
        <div class="legend-item" data-filter="passed"><span class="legend-dot pass"></span> Passed (${passedTests})</div>
        <div class="legend-item" data-filter="failed"><span class="legend-dot fail"></span> Failed (${failedTests})</div>
        <div class="legend-item" data-filter="flaky"><span class="legend-dot flaky"></span> Flaky (${flakyTests})</div>
        <div class="legend-item" data-filter="skipped"><span class="legend-dot skip"></span> Skipped (${skippedTests})</div>
      </div>
    </section>

    ${globalErrorsSection}
    ${defectsSection}

    <!-- Test List Section -->
    <section class="test-list-section" id="testListSection">
      <div class="test-list-header">
        <div class="test-list-title">
          <span id="testListHeading">All Test Cases</span>
          <span class="count-indicator" id="testCountIndicator">(${totalTests} items)</span>
          <span id="activeFilterBadgeContainer"></span>
        </div>
        <div class="action-controls">
          <button class="mini-btn" id="expandAllBtn">Expand All</button>
          <button class="mini-btn" id="collapseAllBtn">Collapse All</button>
          <button class="mini-btn print-btn" id="printReportBtn" title="Export or print this report as a clean PDF">🖨️ Export PDF</button>
        </div>
      </div>

      <div class="test-cards-wrapper" id="testCardsWrapper">
        ${processedCases.map(renderCard).join('')}
      </div>

      <div class="empty-state" id="emptyState" style="display: none;">
        <h3>No matching test cases found</h3>
        <p style="margin-top: 8px;">Try clearing search keywords or changing the status filter.</p>
      </div>
    </section>

  </main>

  <!-- Lightbox Modal -->
  <div class="lightbox-modal" id="lightbox">
    <span class="lightbox-close">&times;</span>
    <img src="" id="lightboxImg" class="lightbox-content">
  </div>

  <script>
    // State management
    let currentFilter = 'all';
    let currentModule = 'all';
    let searchQuery = '';

    // Filter refresh logic
    function refreshView() {
      const cards = document.querySelectorAll('.test-card');
      let visibleCount = 0;

      cards.forEach(card => {
        const cardStatus = card.getAttribute('data-status');
        const cardModule = card.getAttribute('data-module');
        const cardSearch = (card.getAttribute('data-search') || card.getAttribute('data-title') || '').toLowerCase();

        const matchStatus = (currentFilter === 'all') || (cardStatus === currentFilter);
        const matchModule = (currentModule === 'all') || (cardModule === currentModule);
        const matchSearch = (!searchQuery) || (cardSearch.indexOf(searchQuery) !== -1);

        if (matchStatus && matchModule && matchSearch) {
          card.style.display = 'block';
          visibleCount++;
        } else {
          card.style.display = 'none';
        }
      });

      // Update count indicator
      const countEl = document.getElementById('testCountIndicator');
      if (countEl) {
        countEl.textContent = '(' + visibleCount + ' items displayed)';
      }

      // Empty state
      const emptyEl = document.getElementById('emptyState');
      if (emptyEl) {
        emptyEl.style.display = visibleCount === 0 ? 'block' : 'none';
      }

      // Active filter badge
      const badgeContainer = document.getElementById('activeFilterBadgeContainer');
      if (badgeContainer) {
        if (currentModule !== 'all') {
          const modItem = document.querySelector('.nav-item[data-module-key="' + currentModule + '"]');
          const modName = modItem ? modItem.querySelector('.nav-item-left span:last-child').textContent : currentModule;
          badgeContainer.innerHTML = '<span class="active-filter-badge">Filter: ' + modName + ' <button class="clear-filter-btn" title="Clear module filter">&times;</button></span>';
        } else {
          badgeContainer.innerHTML = '';
        }
      }
    }

    // Set status filter
    function setStatusFilter(status) {
      currentFilter = status;
      document.querySelectorAll('.filter-pills .pill-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-filter') === status);
      });
      refreshView();
    }

    // Set module filter
    function setModuleFilter(modKey) {
      currentModule = modKey;
      document.querySelectorAll('.sidebar .nav-item').forEach(item => {
        item.classList.toggle('active', item.getAttribute('data-module-key') === modKey);
      });

      const heading = document.getElementById('viewHeading');
      if (heading) {
        if (modKey === 'all') {
          heading.textContent = 'Execution Dashboard';
        } else {
          const modItem = document.querySelector('.nav-item[data-module-key="' + modKey + '"]');
          const name = modItem ? modItem.querySelector('.nav-item-left span:last-child').textContent : modKey;
          heading.textContent = 'Module: ' + name;
        }
      }

      refreshView();

      // Scroll smoothly to test list section
      const listSec = document.getElementById('testListSection');
      if (listSec) {
        listSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }

    // Event Delegation: Global Click Handlers
    document.addEventListener('click', function(e) {
      // 1. Toggle Test Card
      const summary = e.target.closest('.test-card-summary');
      if (summary) {
        const card = summary.closest('.test-card');
        if (card) {
          card.classList.toggle('open');
        }
        return;
      }

      // 2. Status Filter Pills
      const pillBtn = e.target.closest('.pill-btn');
      if (pillBtn) {
        const filter = pillBtn.getAttribute('data-filter');
        if (filter) setStatusFilter(filter);
        return;
      }

      // 3. KPI Cards Click to Filter
      const kpiCard = e.target.closest('.kpi-card');
      if (kpiCard) {
        const filter = kpiCard.getAttribute('data-filter');
        if (filter) setStatusFilter(filter);
        const listSec = document.getElementById('testListSection');
        if (listSec) listSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }

      // 4. Progress Legend Items Click to Filter
      const legendItem = e.target.closest('.legend-item');
      if (legendItem) {
        const filter = legendItem.getAttribute('data-filter');
        if (filter) setStatusFilter(filter);
        return;
      }

      // 5. Sidebar Navigation Items
      const navItem = e.target.closest('.sidebar .nav-item');
      if (navItem) {
        const nav = navItem.getAttribute('data-nav');
        if (nav === 'overview') {
          currentModule = 'all';
          setStatusFilter('all');
          document.querySelectorAll('.sidebar .nav-item').forEach(el => el.classList.remove('active'));
          navItem.classList.add('active');
          document.getElementById('viewHeading').textContent = 'Execution Dashboard';
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } else if (nav === 'failures') {
          currentModule = 'all';
          setStatusFilter('failed');
          document.querySelectorAll('.sidebar .nav-item').forEach(el => el.classList.remove('active'));
          navItem.classList.add('active');
          document.getElementById('viewHeading').textContent = 'Failures Hub';
          const listSec = document.getElementById('testListSection');
          if (listSec) listSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else if (nav === 'flaky') {
          currentModule = 'all';
          setStatusFilter('flaky');
          document.querySelectorAll('.sidebar .nav-item').forEach(el => el.classList.remove('active'));
          navItem.classList.add('active');
          document.getElementById('viewHeading').textContent = 'Flaky Tests (passed only on retry)';
          const listSec = document.getElementById('testListSection');
          if (listSec) listSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else if (nav === 'defects') {
          document.querySelectorAll('.sidebar .nav-item').forEach(el => el.classList.remove('active'));
          navItem.classList.add('active');
          const defectsSec = document.getElementById('knownDefectsSection');
          if (defectsSec) defectsSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else if (nav === 'gallery') {
          currentModule = 'all';
          setStatusFilter('all');
          document.querySelectorAll('.sidebar .nav-item').forEach(el => el.classList.remove('active'));
          navItem.classList.add('active');
          document.getElementById('viewHeading').textContent = 'Evidence & Screenshots Gallery';

          // Show & expand all cards that have media
          document.querySelectorAll('.test-card').forEach(card => {
            const hasMedia = card.querySelector('.media-thumb, .video-player, .trace-link');
            if (hasMedia) {
              card.classList.add('open');
              card.style.display = 'block';
            } else {
              card.style.display = 'none';
            }
          });
          const listSec = document.getElementById('testListSection');
          if (listSec) listSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
          return;
        } else if (nav === 'module') {
          const modKey = navItem.getAttribute('data-module-key');
          if (modKey) setModuleFilter(modKey);
        }
        return;
      }

      // 6. Clear Module Filter Button
      const clearBtn = e.target.closest('.clear-filter-btn');
      if (clearBtn) {
        setModuleFilter('all');
        return;
      }

      // 7. Copy Stack Trace Button
      const copyBtn = e.target.closest('.copy-btn');
      if (copyBtn) {
        const stackPre = copyBtn.closest('.failure-box').querySelector('.error-stack');
        if (stackPre) {
          navigator.clipboard.writeText(stackPre.textContent || '');
          copyBtn.textContent = 'Copied!';
          setTimeout(() => { copyBtn.textContent = 'Copy Stack'; }, 1500);
        }
        return;
      }

      // 8. Image Lightbox Click
      const thumb = e.target.closest('.media-thumb');
      if (thumb) {
        const lb = document.getElementById('lightbox');
        const img = document.getElementById('lightboxImg');
        if (lb && img) {
          img.src = thumb.src;
          lb.classList.add('open');
        }
        return;
      }

      // 9. Close Lightbox Click
      if (e.target.id === 'lightbox' || e.target.classList.contains('lightbox-close')) {
        const lb = document.getElementById('lightbox');
        if (lb) lb.classList.remove('open');
      }
    });

    // Expand All / Collapse All buttons
    const expandAllBtn = document.getElementById('expandAllBtn');
    if (expandAllBtn) {
      expandAllBtn.addEventListener('click', function() {
        document.querySelectorAll('.test-card').forEach(c => {
          if (c.style.display !== 'none') c.classList.add('open');
        });
      });
    }

    const collapseAllBtn = document.getElementById('collapseAllBtn');
    if (collapseAllBtn) {
      collapseAllBtn.addEventListener('click', function() {
        document.querySelectorAll('.test-card').forEach(c => c.classList.remove('open'));
      });
    }

    const printBtn = document.getElementById('printReportBtn');
    if (printBtn) {
      printBtn.addEventListener('click', function() {
        // Expand all visible cards before printing so all expected/actual details are included
        document.querySelectorAll('.test-card').forEach(c => {
          if (c.style.display !== 'none') c.classList.add('open');
        });
        window.print();
      });
    }

    // Search Input Event
    const searchInput = document.getElementById('sidebarSearch');
    if (searchInput) {
      searchInput.addEventListener('input', function(e) {
        searchQuery = (e.target.value || '').toLowerCase().trim();
        refreshView();
      });
    }

    // Keyboard Shortcuts
    window.addEventListener('keydown', function(e) {
      if (e.key === '/' && document.activeElement !== searchInput) {
        e.preventDefault();
        if (searchInput) searchInput.focus();
      } else if (e.key === 'Escape') {
        const lb = document.getElementById('lightbox');
        if (lb) lb.classList.remove('open');
      }
    });

    // Initial render
    refreshView();
  </script>
</body>
</html>
`;

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputHtmlPath, htmlReport, 'utf-8');
  const bytes = Buffer.byteLength(htmlReport, 'utf-8');
  const flakyNote = flakyTests > 0 ? `, ${flakyTests} flaky` : '';
  console.log(
    `[ElegantReport] ${totalTests} tests (${passedTests} passed, ${failedTests} failed${flakyNote}, ${skippedTests} skipped) -> ${outputHtmlPath} (${(bytes / 1024).toFixed(1)} KB)`,
  );
  return bytes;
}

/** Rebuilds the report from test-results/summary.json (npm run report:build). Throws on unreadable input. */
export function generateElegantReport(
  summaryJsonPath: string = path.resolve(process.cwd(), 'test-results/summary.json'),
  outputHtmlPath: string = DEFAULT_REPORT_PATH,
): number {
  const run = loadRunFromSummary(summaryJsonPath);
  console.log(`[ElegantReport] Building from ${summaryJsonPath} (run started ${run.startTime}).`);
  return renderElegantReport(run, outputHtmlPath);
}

// Standalone: npm run report:build [-- <summary.json> [<output.html>]]
if (require.main === module) {
  const [summaryArg, outputArg] = process.argv.slice(2);
  try {
    generateElegantReport(
      summaryArg ? path.resolve(summaryArg) : undefined,
      outputArg ? path.resolve(outputArg) : undefined,
    );
  } catch (err) {
    console.error(`[ElegantReport] ${errorMessage(err)}`);
    process.exit(1);
  }
}
