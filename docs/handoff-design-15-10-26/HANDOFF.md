# Handoff: HRX app → exact 1:1 replica of the "HRX Drop 2 - 15.10.26" design

Written 19 Oct 2026 by the previous Claude session, stopped on the user's request.
Read all of this before touching anything. It covers what the user wants, the rules
that must not be broken, what is done, what is half-done, and how to carry on.

---

## 1. What the user asked for

> "Make the UI an exact 1:1 replica of the html file, make no mistakes, and make sure
> all the services are still working."

- **Design file:** [`design/HRX Drop 2 - 15.10.26.html`](design/HRX%20Drop%202%20-%2015.10.26.html)
  (in this branch), a single-file HTML prototype. `tools/design.js` opens it from there.
  - It must be opened directly in a browser. In the SharePoint preview its scripts are
    blocked and the page looks broken.
- **App:** `hrx2026/webapp`, SAPUI5 1.150 (XML views + controllers + fragments + i18n),
  launched in the Fiori launchpad. In BAS the user runs `npm run start-bas`.
- **Previous design:** an earlier prototype ("HRX Drop 2 Prototype.html", 8 Oct) is what main's UI
  was built from. The 15.10.26 design is the target now.

## 2. Rules (the user set these; breaking them has caused real problems)

1. **Never push or merge to `main`, in either repo.**
   - HRXDROP2: work on `Functional-UI-Services` or a branch.
   - HRXService (`bluestonex-labs/HRXService`): pull requests into `dev` only; Bala reviews and
     merges. In Oct a PR was merged into HRXService main by mistake and had to be reverted.
2. **Never send real email. Read this carefully.**
   - HRXService's original leave code (`srv/hrx-services.js`, `sendNewLeaveNotificationManager`
     ~l.1155 and `sendNewLeaveNotificationEmp` ~l.1093) sends **real Office 365 email** from
     `visitorapp@bluestonex.com`. The SMTP login is hard-coded, and it ignores `HRX_MAIL_DRY_RUN`.
   - On 15 Oct local test runs created test leave requests for users with real colleague addresses.
     About 50 real emails went to sam.evans@, dan.barton@ and kyle.barnfield@bluestonex.com.
   - The local test service in `tools/local-hrx-service/run-service.sh` now puts a stand-in
     `nodemailer` (`no-mail.js`) in the service copy's `srv/node_modules`. It **refuses to start**
     unless every email path resolves to the stand-in.
   - Every send is only logged as `[email blocked - local test]`. Check the log for
     `Message sent: <` (a real send): it must stay 0.
   - **Test users are made up:** `sam.evans@example.test` (manager), `kyle.barnfield@example.test`
     (employee), `dan.barton@example.test` (manager), plus priya.shah@, tom.reid@ and
     alex.morgan@example.test. Never use a real address in test data.
3. **No dummy data in the app.** The design's people and numbers are placeholders. Where the services
   have no data, keep the "Service needed" note pattern (`services>` model and MessageStrip) instead.
4. **Readable, standard SAP BAS code:**
   - XML views, controllers, fragments and i18n.
   - Descriptive names.
   - No dense one-liners.
   - Comment like the surrounding code.
5. **Never use credentials:**
   - Never use the HRXService `.env` / `db/.env` files or any real BTP credentials.
   - Never deploy. Bala deploys.
   - Don't change git history.

## 3. Where things are (git)

**HRXDROP2** (this repo):

| Branch | State |
|---|---|
| `main` | untouched by us |
| `archive/ui-before-15-10-26-design` | the app before any 15.10.26 work (backup) |
| `Functional-UI-Services` (GitHub) | `aa02143`: the 15.10.26 *delta* (Team Calendar + Team leave, Home approvals = own team, Manage Resources active switch, Manage Projects contacts/Re-assign, Policies tiles). Tested: 33/33 checks. This is what the user tests in BAS. |
| **`wip/design-15-10-26-1to1`** (GitHub, this branch) | everything below: the sidebar commit `1a77280` plus all unfinished 1:1 work and this handoff. **Not tested as a whole. Several pages are mid-edit.** |

**HRXService** (`bluestonex-labs/HRXService`):

- `dev`: deploy fixes (cds-dk 6, Node 22, DMS binding-secret, `@path '/hrx'`). Deployed by Bala.
- `feature/project-contacts`: PR #36 into `dev`, **not merged**. Adds the
  `Projects.Primary/SecondaryContactName/Email` fields that the Manage Projects "Client contacts" tab
  uses. Until it is deployed the tab shows "Service needed".
- **Open problems in HRXService** (suggested to the user, not done):
  1. The legacy leave emails ignore `HRX_MAIL_DRY_RUN`, and the SMTP password is in the code (and in
     git history). Fix: read it from env and honour dry-run; PR into `dev`. Whoever owns the
     `visitorapp` mailbox should change its password.
  2. Requesting leave as someone with **no manager** returns a 500: `ManagerDetail[0]` is undefined
     in `sendNewLeaveNotificationManager`.
  3. `actionOnLeave` reads `RequesterID[0].EMPID_EMPLOYEEID`, which is the HANA upper-case column
     name. It works on HANA, but local SQLite needs the local patch in `run-service.sh`.

## 4. What is done (verified by the previous session)

- **Side rail (sidebar):**
  - "Overview" and "Admin only" groups; the admin pages are listed in the rail for managers.
  - Utilisation → `timesheetreporting?tab=util`.
  - Expenses + "Soon" tag.
  - The design's own line icons: `webapp/img/nav/*.svg`, drawn with a CSS mask keyed by
    `data-nav-key`, which App.controller writes.
  - 248px rail; footer shows name + "job title · employee ID", with View as below.
  - Measured against the design to within about 1px.
  - Files: `view/App.view.xml`, `controller/App.controller.js` (`_showAdminNavigation`,
    `_markNavigationRows`), the SIDEBAR / SIGNED-IN USER sections in `css/style.css`.
  - A hidden NavigationListGroup crashes the launchpad, so the admin group is *removed* for
    employees, not hidden.
- **Page header + health strip:**
  - 68px top bar; the strip is its own row on Home.
  - Page actions in the top-right (`mRouteToPageAction` in App.controller): "Record sickness",
    "Upload document", "Refresh from service". Pressing one calls the page controller's
    `onPageAction()`, or `onRefresh()` if there isn't one.
  - The old refresh icon is gone.
  - Page padding = the design's `.scroll` (26px / 28px, `--gutter: 28px`).
- **Fonts:**
  - The launchpad didn't load the design fonts; only index.html did.
  - `css/style.css` now `@import`s Raleway from Google Fonts.
  - It loads League Spartan 700/800 from `webapp/fonts/`, which are the design's own embedded files.
- **Team Calendar (fully done):**
  - Rebuilt as the design's grid: no PlanningCalendar; a 200px people column + 7 days, with pills
    coloured by leave type and hatched pending.
  - Team leave card: period, search, chips with counts, table, approve/reject; the reject dialog
    uses the shared modal.
  - Person "N pending" popover, request popover (approve / approve all / cancel leave).
  - "Select resource(s)" popover; Team / Site / Project filters.
  - Files: `view/TeamCalendar.view.xml`, `controller/TeamCalendar.controller.js`,
    `fragment/TeamLeavePopover.fragment.xml`, `fragment/TeamResourcesPopover.fragment.xml`,
    `model/TeamLeave.js`, `css/pages/teamcalendar.css`.
  - Measured within 1–2px of the design.
  - **`tools/tc-flows.js`: 20/20 functional checks** (approve, reject with note, week navigation,
    resource filter, Everyone, employee view, no real email).
- **Shared modal style** (`css/style.css` "THE DESIGN'S MODAL"):
  - `class="hrxModal"` (`hrxModalWide`).
  - Buttons: `hrxModalBtn` + `hrxModalBtnPrimary`, `hrxModalBtnDanger` or `hrxModalBtnGhost`;
    action first, Cancel second.
  - Text classes `hrxModalText` / `hrxModalLabel`.
  - The theme's compact rules need `!important` on bar heights and button fills; it's commented in
    the CSS.
- **Per-page CSS:**
  - `css/pages/<page>.css`, all loaded by `manifest.json`, each scoped to its page's root class.
  - Don't put page CSS in `style.css`.
- **My Timesheet (finished by a helper; review it, not yet re-verified):**
  - The helper reported every element within about 1px.
  - Save / comment / add / delete were checked against the local service.
  - The Timesheet controller adds the `hrxTsPopover` class to the WeekPickerPopover only when
    Timesheet opens it, so Missing Timesheets is unaffected.

## 5. What is half-done (helpers were stopped mid-work, so NOT verified)

Each of these was being changed by a separate helper agent following `tools/BRIEF.md`.
They were stopped part-way. **Expect broken or inconsistent states.** For each: render the design
vs the app, fix, measure, then test the functions.

| Page | Files | Where the helper stopped |
|---|---|---|
| Home | `view/Home.view.xml`, `controller/Home.controller.js`, `fragment/HomeDatePopover`, `fragment/HomePendingApprovals`, `css/pages/home.css` | mid-way. Also: the design's health strip has 3 pills ("Timesheet on track" first) and `_updateHealthStrip` should add the timesheet pill first. |
| My Leave | `view/Leave.view.xml`, `controller/Leave.controller.js`, `fragment/EditLeaveDialog`, `LeaveHalfDayDialog`, `LeaveDatePicker`, `CancelLeaveDialog`, `css/pages/leave.css` | mid-way |
| Policies to read + Documents + App Explorer | `view/Policies`, `Documents`, `AppExplorer` (+controllers), `fragment/DocumentUploadDialog`, `model/apps.json`, `css/pages/policies-documents.css`, `css/pages/app-explorer.css` | nearly done ("final re-renders"). Documents must implement `onPageAction` (opens upload) and drop its own upload button. |
| Sickness | `view/Sickness.view.xml`, `controller/Sickness.controller.js`, `fragment/RecordSicknessDialog`, `DismissTriggerDialog`, `SicknessMessageDialog`, `model/SicknessService.js`, `css/pages/sickness.css` | Layout compared and close. Needs `onPageAction` (opens Record sickness) with no own button; check the modals and employee view. The lead was also tuning the shared top-bar button (`.hrxTopBar .hrxTopBarAction` in style.css) to the design's 166.8 × 36px: last edit not yet measured. |
| Timesheet reporting + Utilisation | `view/TimesheetReport.view.xml`, `controller/TimesheetReport.controller.js`, `model/TimesheetReport*.js`, `css/pages/timesheet-reporting.css` | mid-way, measuring tabs. `?tab=util` must look like the design's Utilisation page, otherwise like Timesheet reporting. |
| Manage Resources | `view/ManageResources.view.xml` (+controller), `fragment/AddResourceDialog`, `ResourceFilterDialog`, `ResourceBookLeaveDialog`, `ResourceDeclineLeaveDialog`, `controller/BookLeave.js`, `css/pages/manage-resources.css` | was writing the view |
| Manage Clients | `view/ManageClients.view.xml` (+controller), client dialogs, `ClientConfirmDialog`, `model/HrxLegacyClients.js`, `css/pages/manage-clients.css` | was doing the logo field |
| Manage Projects | `view/ManageProjects.view.xml` (+controller), project dialogs, `ProjectConfirmDialog`, `css/pages/manage-projects.css` | was doing i18n edits |

`i18n/i18n.properties` and `css/style.css` were edited by several hands. Check for duplicate keys,
dead keys and clashing rules at the end.

## 6. How to carry on

1. **Set up the local environment.** Email stays blocked; never skip the guard.
   - `cd docs/handoff-design-15-10-26/tools/local-hrx-service`.
   - Start the fake document service: `node fake-dms.js &` (port 4005).
   - Start the HRX service: `sh run-service.sh` (copies `../HRXService` to `service-copy/`; port
     4004; needs the HRXService repo at `HRX_SERVICE_DIR` with `node_modules`).
   - Seed the test data: `node seed-for-app.js`.
   - Start the app preview: `cd hrx2026 && npx fiori run --config ./ui5.yaml --port 8088`
     (`/hrx` → localhost:4004).
   - Edit the paths in the scripts for your machine. `npm i puppeteer-core@24` in `tools/`
     (version 25 does not load). Chrome is expected at the macOS path in the scripts.
2. **Compare** with `tools/design.js` (design view → png / `--measure`), `tools/app.js` (app route →
   png / `--measure`, waits for the page title) and `tools/compare.py` (side by side, needs Pillow).
   The usage is in the file headers and in `BRIEF.md`.
3. **Finish the pages** in §5, one at a time, checking side by side and by measuring. Then run the
   functional checks against the local service for each page (load, save, approve, upload...).
   `tc-flows.js` is a worked example.
4. **Before committing:** run the UI5 linter (MCP `run_ui5_linter`) on changed files, check all pages
   load with no errors as manager and as employee, and check `Message sent: <` is 0 in the service log.
5. **Commit** with clear messages ending `Co-Authored-By: Claude …`. Push to a branch, not `main`.
   When stable, ask the user before bringing it into `Functional-UI-Services`.

### Known gotchas (UI5 vs the design)

- The theme's compact rules outrank class selectors on Table cells
  (`td.sapMListTblCell`, `th.sapMListTblHeaderCell`), toolbar buttons and dialog bars. Use those
  selectors with `!important` for paddings and fills, with a comment.
- `sap.m.Button`'s `.sapMBtnInner` keeps a 14px font that sets its line box. Set the design's
  font-size / line-height on `.sapMBtnInner` too.
- Select / Input / SearchField get 3px margins in some containers: set `margin: 0`.
- FlexBox item wrappers add height: use `renderType="Bare"`, then give the box `display:flex`.
- The design writes date ranges as "14 – 15 Jul 2026" in every locale: `TeamLeave.rangeLabel`.
- `sap.m.Table` adds hidden highlight / nav columns: hide them so the first visible column gets the
  20px left padding.
