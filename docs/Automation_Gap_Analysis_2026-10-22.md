# RiverStream Automation: gap analysis

**Date:** 22 Oct 2026
**Inputs:** Test case Excel files (module files plus the two original files), the repo code (`src/`, `tests/`, CI, reporting), and a read-only tour of the live QA app (`riverstream-qa.azurewebsites.net`, logged in as superAdmin, write requests blocked).
**Last real run:** 21 Oct 2026, `test:main`, local. 185 tests: **152 passed, 16 failed, 17 skipped**, 65.4 minutes.

---

## 1. Summary

| Area | Status |
|---|---|
| Documented test cases | 299 in the module files (the Master tab says 305) |
| Automated tests | 267 in 8 spec files |
| Documented cases with **no** test | **34** (Dashboard, Clients and Analytics) |
| Tests that **check what the Excel expected result says** | **about 70 of 265** |
| Tests that are **shallow or always pass** | **about 157**; about 37 more are partial |
| Page-object locators that **no longer match the live UI** | **about 30** (broken, wrong element, or 0 matches) |
| Live features with **no automation at all** | Clients, Analytics, Audit Logs, Forgot Password, Dashboard filters and export, Review viewer features, many Recon features |
| App defects or UX issues found | 24 |
| Security issues in the repo | QA admin password committed in 26 files and in git history |

**Bottom line:** almost every Excel ID has a test with the same name, so the suite *looks* fully covered. In practice most tests can't fail. Many locators match the wrong element, such as the page wrapper or a sidebar button. And whole modules visible in the app are not tested. "100% automated" in `00_Master` is not accurate.

---

## 2. Urgent issues

### 2.1 Admin password committed (High)
- The real QA admin password (and email) appears in **26 tracked files**:
  - `.env.example`
  - `src/config/environment.ts` (as a fallback value)
  - `src/test-data/auth.data.ts`
  - `tests/settings/settings.spec.ts`
  - `src/scripts/*`
  - 15 `scratch/*` files
  - `summary_report.json`, `test_cases_extracted.json`, `test-catalog-metadata.json`
- It has been in git history since the first commit (`a3f1aee`) and again in `97a1716`, and it is pushed to GitHub.
- **Action:**
  - Change the QA admin password.
  - Replace the values with placeholders and remove the hard-coded fallbacks (fail fast if the env var is missing).
  - Clean the history (`git filter-repo`) if the repo is or will be shared.
  - Add a gitleaks secret scan to CI.
- The uncommitted change to `.env.example` also adds real recipient email addresses. Use placeholders there.

### 2.2 Test reports published to public GitHub Pages (High)
- The CI workflow deploys `playwright-report` to `babukumar-cell.github.io`.
- The report contains embedded screenshots of QA data, customer names and stack traces.
- **Action:** keep reports as private CI artifacts, or use hosting that requires a login.

### 2.3 CI job will time out (High)
- `timeout-minutes: 60`, but `test:main` alone took 65 minutes locally with retries off. CI adds `retries: 2`.
- The report and email steps may never run.

### 2.4 Tests change shared QA data (High)
- Some tests click **Save** on the real org "MJ", click **Pay Now**, swap addresses on real documents, create projects and upload files on every run. None of it is cleaned up.
- The live tour found **23 leftover `AutoProj_` / `TestList_` projects**.
- One script (`src/scripts/test-create-project.ts`) points at **`riverstream.azurewebsites.net`**, which looks like production, not QA, and creates a project there.

---

## 3. Test case coverage gaps

### 3.1 Coverage per module

| Module | Documented | Automated | Missing | Shallow / partial | Notes |
|---|---|---|---|---|---|
| 01 Auth | 5 | 5 | 0 | 3 / 2 | Test IDs are `TC_001..005`, which don't match the `TC_AUTH_*` catalog |
| 02 Dashboard / Clients / Analytics | 44 | 10 | **34** | 10 / 0 | Clients and Analytics have no tests at all |
| 03 Upload | 32 | 32 | 0 | 21 / 7 | Plus `TC_UP_Batch`, which is not documented |
| 04 Documents | 23 | 23 | 0 | 5 / 7 | |
| 05 PO-ACK Recon | 67 | 67 | 0 | 27 / 9 | 8 conditional skips |
| 06 Review | 28 | 28 | 0 | 19 / 1 | |
| 07 Settings | 82 | 82 | 0 | 56 / 11 | **Never runs**: `test:main` and the weekly CI leave it out |
| 08 Email | 18 | 18 | 0 | 16 / 0 | Only EM_011 and EM_012 are real end-to-end tests |

### 3.2 Documented cases with no test (34)
- **High impact:**
  - DASH_004/005: organisation dropdown and metrics refresh.
  - DASH_010/012/014/016: KPI count accuracy.
  - CLIE_049/050: client search.
  - CLIE_052/055/057/062: Add, View and Delete client, and successful creation.
  - ANAL_063–066: page load, org and date filters, charts update.
- **Lower impact:**
  - DASH_017–020: layout, refresh, responsiveness, console errors.
  - CLIE_044–048, 051, 053, 054, 056, 058–061.
  - ANAL_067.

### 3.3 Tests that exist but never perform the action they're named for
These are the riskiest gaps. They show as PASS but test nothing.
- **Settings:**
  - SETT_074 never submits Create User.
  - SETT_076–079 never reset a password or log in as the new user.
  - SETT_110 never creates an org; SETT_111 never double-submits.
  - SETT_121/130 never delete anything.
  - SETT_129/145 never save an edit.
  - SETT_131–133 don't check payments.
  - SETT_134–136 never upload anything.
- **Review:**
  - REV_005 never clicks Complete; REV_006 never submits to ERP.
  - REV_014 never checks the address swap.
  - REV_016–020 never check against the client JSON.
  - REV_026 never drags; REV_027/028 never delete a row.
- **Recon:** RECON_058 never edits; RECON_063 never changes severity; RECON_065 never modifies a line item; RECON_067 never clicks Complete (identical to 066).
- **Email:**
  - EM_001–005 never disable a document type.
  - EM_013–017 never send the email that triggers the scenario. They read whatever RiverStream email is newest in the inbox.

### 3.4 Shallow tests that always pass (main patterns)

| Pattern | Examples |
|---|---|
| `expect(true)`, `\|\| true`, `>= 0`, `!== undefined` | settings.spec.ts (25), review.spec.ts (9), RECON_016/029/055, DOCU_039/042, UP_027 |
| Negative tests guarded by `if (error) { expect }` | UP_019–026: they pass when **no** error is shown, which is the exact failure they should catch |
| `isUploadSuccessful()` always true | It matches the file name (visible before upload) and the static "Secure Processing" heading |
| Dashboard card locators match the page root | TC_Dashboard_006–015 pass although 3 of the cards **no longer exist** on the dashboard |
| Login and logout only check the domain | Auth TC_001, Logout_002, SETT_080/081; `clickLogout` silently does nothing if the button isn't found |
| `if (await x.isVisible())` with no else | About 35 steps, including RECON_037–043, 060, 064, Nav_021 |
| Assertion unrelated to the title | RECON_057–065 only assert that the Complete button is visible |
| Regex escaping bug | RECON_056: `'text=/\d+…/'` inside a JS string becomes `d+`, so it never matches (this is the real reason it fails) |

### 3.5 Cases dropped from the original Excel
- **Settings (Admin role), TC_Settings_150–156:** General fields, Billing, Pay, Billing History. There is **no role-based (Admin vs Super Admin) coverage** at all.
- **Review:** Review_005 (download), Review_007 (search), Review_008 (scroll), Review_032 (swap row), Review_033 (citation).
- **Other modules:**
  - Document insertion statuses (TC_Document_038).
  - Analytics custom date range (TC_Analytics_068).
  - Client Inactive/Suspended statuses.
  - Drag-and-drop of an unsupported file.
- **Email Process for Corp Design (23 unique) and Hightower (15).** Some of these also apply to Riverstone: Unknown User reply, quota warning, exactly one reply per email.
- **Old PO-ACK Recon version (73 cases), never automated:**
  - Status after Complete per severity (036–039).
  - Complete is disabled after clicking (057).
  - Switching ACK keeps the flags (071).
  - Edits kept after Save (073).
- **7 manual FAILs are shown as PASSED/READY in the module files**, and their tests hide the defect: ANAL_063, SETT_128, SETT_132, SETT_138, Review_005, REV_028, Review_033.

---

## 4. Live app features with no automation

| Area | Not covered |
|---|---|
| Login | Forgot Password flow (page object and test), email-format validation |
| Dashboard | Date range filter, KPI-card tab switching, Document type and File format filters, **Export CSV/XLSX**, table infinite scroll, bell, avatar popover, sidebar collapse, plan badge |
| Clients | **Entire module**: list, search, Create Client modal and validation, details panel, Edit, Delete |
| Analytics | **Entire module**: org and range filters, 3 KPIs, 4 charts |
| Audit Logs / `/settings` | Coming-soon route; own-org settings page |
| Documents | Document Type and Upload Date (calendar) filters, filter summary and badge, Uploaded By hover card, Re-Extract, infinite scroll, Extraction Failed vs Failed |
| Upload | `from=documents` back link, 50 MB limit, the new auto-upload flow (**there is no Process button any more**) |
| Review | Search in PDF, Pick value from PDF, Copy JSON, Download, citation page jump, ERP banner, "ERP Insertion Failed" modal, **XLS / EDI / SIF viewers**, field labels that differ by document type |
| PO-ACK Recon | Per-row Upload ACK, Email Preview modal, severity dropdown, field and row select checkboxes, ACK version switcher, unmatched (red) rows, Awaiting-ACK view, org filter |
| Settings | User Details page (Edit/Delete), Users section on org detail, ERP Data upload, editable limits, Free Trial and Monthly/Yearly plans |
| Cross-cutting | Roles (Admin, Reviewer), direct-URL access without login, responsive layout, accessibility |

---

## 5. Stale and broken locators (checked against the live UI)

**Throw an error when used:**
- `LeftSidePage.userProfile`: invalid RegExp flags.
- `PoAckReconPage.dialogTitle`: selector parse error. The live title is "New Project".

**Resolve to the wrong element:**

| Locator | Actually matches |
|---|---|
| `DashboardPage.logoutButton` | Sidebar "Dashboard" button |
| `LeftSidePage.*Card` (4 locators) | Page root `<div>` |
| `ReviewPage.zoomOutButton` | Sidebar "PO-ACK Recon" button |
| `ReviewPage.statusBadge` | Description paragraph |
| `PoAckReconPage.ackDropdown` | Breadcrumb (use `button[aria-label="Select ACK"]`) |
| `UploadPage.uploadSuccessToast` | Static heading "Secure Processing" |
| `UploadPage.errorMessage`, `LoginPage.errorMessage` | Empty `<div>`, probably the Next.js route announcer |
| `UploadPage.backToDashboardButton` | Sidebar Dashboard button |
| `SettingsPage.enterprisePlanCard` | The "Pro" inside "Intelligent Document **Pro**cessing" (there is no Enterprise plan any more) |
| `SettingsPage.orgNameField` / `orgStatusField` | A user email / "superAdmin" |
| `SettingsPage.userCards` / `orgCards` | Page wrappers (17 and 29 matches) |
| `PoAckReconPage.poDropzone` / `ackDropzone` | The same modal root |

**Zero matches (feature removed or renamed):**
- `LoginPage.emailRequiredError` / `passwordRequiredError`
- `ReviewPage.zoomInButton`, `prevPageButton`, `nextPageButton`, `fitToPageButton`, `selectionButton`, `closeModalButton`
- `UploadPage.processButton`
- `PoAckReconPage.docSearchInput`
- `SettingsPage.addressFileUploadInput`, `uploadCustomDocsButton`, `customDocsSection`

**Stale test data:**
- Severity "Minor" is now **"Low"**.
- The Recon status chips are now multi-select, so RECON_037–044 combine their filters.
- The "Enterprise" plan and "Custom Docs" are gone.
- Hard-coded PO `59544-119559`, org `MJ`, project `Tech_Soluton`, user `manoj`.

---

## 6. Framework and code quality

| # | Severity | Issue | Fix |
|---|---|---|---|
| F1 | High | UI login in every `beforeEach` (about 250 logins per run) | Log in once in a setup project with `storageState` |
| F2 | High | 125 `waitForTimeout` calls, 55 `isVisible({timeout})` (that timeout is ignored), 157 `.catch(() => …)` swallowing failures | Web-first `expect(...).toBeVisible()`, `waitForResponse` |
| F3 | High | Comma-joined `text=` selectors (settings.page.ts:171/181, left-side, login) never match; each settings test wastes ≥20 s | Use `.or()` / `getByRole` |
| F4 | High | Custom reporter runs **before** the JSON reporter writes `summary.json`, so the local HTML report and the emailed PDF show the **previous run** | Build from reporter events, or run `report:build` as a separate step |
| F5 | High | `mail.service.ts` downloads every message in Inbox and Spam on each 5 s poll and swallows authentication errors. This caused the 21 Oct email `beforeAll` timeout, which skipped 17 tests | IMAP `SINCE` + subject-token search, rethrow auth errors |
| F6 | Med | No `actionTimeout` / `navigationTimeout`; REV_011 hung for 133 s | `actionTimeout: 15000`, `navigationTimeout: 30000` |
| F7 | Med | `test:main:email` exits 0 even when tests fail; email send errors only logged | Keep the exit code |
| F8 | Med | CI `retries: 2` plus last-result-only reporting hides flaky tests | Report a "Flaky" status |
| F9 | Med | Tests depend on each other within Recon (RECON_033's upload changes which document is "first") | Each test creates and cleans up its own data in a fixture |
| F10 | Med | 87 generated temp files committed (including a 30 MB PDF and `setup.exe`), plus 41 `scratch/` files. `.gitignore` has no effect because they are already tracked | `git rm --cached`, use `testInfo.outputPath()` |
| F11 | Med | 69 raw locators in specs (some duplicate or contradict the page objects); god page objects (Recon 70 members, Settings 67); about 55 unused members | Component objects, eslint-plugin-playwright |
| F12 | Med | `screenshot: 'on'` plus base64 inlining gives a 21 MB HTML report; allure-results holds 365 MB of old runs | `only-on-failure`, clean before each run |
| F13 | Med | Env config scattered (dotenv loaded in 3 places), no validation; Node 18 locally vs 20 in CI | One validated `env.ts`, `.nvmrc` |
| F14 | Low | npm scripts `test:upload:sif*` and `test:upload:batch` match **0 tests**; `report` only works on Windows; `test` = `test:full` = `test:all` | Clean up the scripts |
| F15 | Low | `--transpile-only` scripts, no `tsc` in CI, `any` types, module stubs hiding `@types` | Add a `typecheck` step |
| F16 | Low | README is 221 bytes; no ESLint or Prettier | Write setup/run/CI docs, add linting |

**Failures in the last run (16):**
- Email `beforeAll` timeout (F5).
- Recon filter chips missing because the QA data has no Matched/Medium/Minor/Failed documents.
- Hard-coded PO not found.
- Project-creation flow changed (now opens the new project).
- RECON_056 regex bug.
- RECON_032 close button clicks the wrong button.
- REV_011 hang.
- Empty tables in DOCU_035/040 and REV_028.

---

## 7. App defects and UX issues for the dev team
Screenshots for each are in the live-tour evidence folder.

| # | Area | Issue |
|---|---|---|
| 1 | Clients | Page header shows "Dashboard" |
| 2 | Header | Bell icon does nothing |
| 3 | Analytics | KPIs count up from 0 while "On target" is already shown; charts empty for about 3 s |
| 4 | Analytics | Document Types legend shows raw enums (PURCHASE_ORDER, PO_ACK_RECON, UNKNOWN) |
| 5 | Documents | Search with no matches shows "No more documents to load" instead of an empty state |
| 6 | Dashboard | A document has been stuck in **Processing since 12 Oct** |
| 7 | Dashboard | The "Reviewed" KPI includes Failed documents |
| 8 | Review (XLS) | Double currency symbol "$$1,360.01" |
| 9 | Review (EDI) | Invoice date shown raw: "20261007" |
| 10 | Review | Line-items modal: "Is Matched" shows raw `true`; header style is inconsistent |
| 11 | Accessibility | Modals lack `role=dialog`; Preview modal doesn't close on Escape; nested `<main>`; chips lack `aria-pressed`; icon-only buttons have no labels |
| 12 | Recon | Complete is disabled on Critical documents with no explanation |
| 13 | Recon | PDF zoom shows "0%" while loading (about 4 s) |
| 14 | Recon | Document "Pending Review" while showing 8 Critical discrepancies; org name casing differs between list and dropdown |
| 15 | Upload | Clicking the drop zone doesn't open the file chooser ("or click to browse"); file can be chosen before a document type is selected |
| 16 | Login | Stale "Invalid username or password" shown with "Password is required"; no email-format check; Forgot Password uses different (native) validation; no show-password toggle |
| 17 | Auth | `/documents` briefly renders before redirecting when logged out; `/organizations` gives a 401 and a JSON parse console error; deep link lost after login |
| 18 | 404 | Generic Next.js 404 page, header still says "Dashboard" |
| 19 | Mobile | At 390 px the dashboard is 478 px wide (horizontal scroll) |
| 20 | Billing | "50 / 30 documents" on a Free Trial; "6/3 users"; Bill History shows a 799 USD payment for the $249 Starter plan; Last Payment date doesn't match |
| 21 | Naming | "Review Document" vs "Document Review"; "Partially Success"; "Po Number" vs "Purchase Order"; 6 spellings of document types; "Email Preview" button opens "Preview Selected Fields" |
| 22 | Performance | Opening a review takes 7.7–14 s (SIF with 189 items: 14 s); Recon review takes about 6.5 s |
| 23 | Security | Auth token in non-HttpOnly cookies (`userToken`, `userInfo`) |
| 24 | Dashboard | "File format" filter has no "All" option to reset |

The live tour also found a SignalR "stopped during negotiation" console error on fast navigation into a Recon project. Otherwise there were no uncaught errors and no 5xx responses while logged in.

---

## 8. Problems in the test case documents
- **`00_Master` is out of date:**
  - It says 100% automated (module 02 is 10 of 44).
  - It says 305 cases (actual: 299) and 73 Recon cases (actual: 67).
  - It gives wrong spec paths for modules 04 and 07.
- **`05_PO_ACK_Recon.xlsx` and `_backup.xlsx` are identical** (the old 73-case version). `_Updated` (67) is the current one.
  - The two versions reuse IDs for different cases.
  - They contradict each other on flag colours.
- `test-catalog-metadata.json` still contains stale RECON_068–073.
- The two original Excel files (repo root and `Test Cases/`) **have different content**.
- Several cases are duplicated across modules: DASH_003 = DOCU_022, CLIE_055 = SETT_073, CLIE_060 = ANAL_067, SETT_070 = SETT_142, SETT_094 = SETT_146.
- No priority column; 66 rows have empty Test Data.
- A stale Excel lock file is sitting in the folder: `~$River Stream Test cases.xlsx`.
- Dashboard test IDs (`TC_Dashboard_*`, `TC_Logout_*`) and auth test IDs (`TC_001`…) don't match the catalog keys, so the reports have no description for them.

---

## 9. Recommended order of work

| Phase | Work | Why |
|---|---|---|
| **0. Now** | Change the password and remove the hard-coded copies; stop public Pages deploys; remove the production-host script | Security |
| **1. Make results trustworthy** | Replace the always-true assertions (or mark the tests `test.fixme`); fix the about 30 stale locators; fix the Upload success and error checks and the dashboard cards; fix the reporter order and exit codes | Today a PASS doesn't mean much |
| **2. Stability and speed** | `storageState` login, `actionTimeout`, remove sleeps and swallowed catches, enable parallel runs for the read-only specs, fix IMAP polling | 65 min → about 15–20 min; fits the CI limit |
| **3. Test data** | Create and clean up projects, orgs and documents in fixtures (API where possible); move fixed IDs into an env-keyed data file; delete the 23 leftover projects in QA | Removes order dependence and pollution of shared QA data |
| **4. Fill coverage** | Dashboard KPIs, filters and export; Clients; Analytics; Forgot Password; Review viewers (XLS/EDI/SIF); Recon Email Preview, severity and ACK switching; role-based tests; per-scenario email tests | The 34 missing cases plus untested live features |
| **5. Housekeeping** | Clean up the Excel files and Master summary, remove tracked temp/scratch files, add ESLint and a typecheck step to CI, write a README, add Settings to the weekly run | Maintainability |

---

### Where the evidence is
Session scratchpad (`C:\Users\Babukumar\AppData\Local\Temp\claude\d--RiverStream-Automation\d46506a9-ff4e-43c7-9370-d2d50e87d09e\scratchpad\`):
- `coverage\`: extracted Excel cases (`excel.json`) and the mapping.
- `ui\`: live tour scripts and JSON dumps; `ui\shots\` has the screenshots; `ui\locator-audit.json` has the per-locator live audit.
