# Brief: make one part of the HRX app an exact 1:1 replica of the 15.10.26 design

## What the user asked for
"Make the UI an exact 1:1 replica of the HTML file, make no mistakes, and make sure all the services are still working."

- Design (single-file HTML prototype, open it read-only): `/Users/davidakilapa/Downloads/HRX Drop 2 - 15.10.26.html`
- App: `/Users/davidakilapa/Documents/GitHub/HRXDROP2/hrx2026/webapp` - SAPUI5 1.150, XML views + controllers + fragments + i18n, branch `Functional-UI-Services`.
- The side rail (sidebar) and the page header/strip above every page are done centrally - do not change them (`view/App.view.xml`, `controller/App.controller.js`, `Component.js`, `manifest.json`).
- Team Calendar is done centrally too - do not touch `view/TeamCalendar.view.xml`, `controller/TeamCalendar.controller.js`, `fragment/TeamLeavePopover.fragment.xml`, `model/TeamLeave.js`.

## The goal for your page(s)
Make each page look and behave like the design's view of it: layout and order of sections, sizes, spacing, alignment, typography (Raleway / League Spartan as in the design), colours, borders, radii, shadows, pills/tags, buttons (text, icon, style), tables (columns, header style, row height), empty states, filters, and the dialogs/pop-overs the design opens from that page. Both the manager view and the employee view (the design's "View as (demo)" switch; in the app, log in as the employee test user).

Rules:
1. **Keep every service working.** The app reads and writes real data through `model/*.js` (HRX OData V4 service, plus the old xsjs-style calls answered by `model/HrxLegacy*.js`). Every load, save, approve, upload etc. that works now must still work. Re-bind the new layout to the same models/handlers; do not drop functionality the app has unless the design clearly removes it (then say so in your report).
2. **No dummy data.** The design's people, numbers and dates are placeholders. The app shows real data. Where the design shows something the services do not provide, keep the app's existing "Service needed" note pattern (`services>` model / MessageStrip) instead of inventing data.
3. **Readable, standard SAP BAS code.** XML views, controllers, fragments, i18n texts; descriptive names; no dense one-liners; comment like the surrounding code does. Prefer sap.m controls styled with design classes (HBox/VBox, `renderType="Bare"` where a wrapper div gets in the way, CSS grid via classes). Use `core:HTML` only for small static decoration.
4. **Files.** Only edit your page's own view/controller/fragments (grep first: if a fragment or helper is also used by another page, change it only in a way that keeps the other page working, and say so in your report). Put ALL your CSS in your page's file under `css/pages/` (already created and loaded by the manifest), scoped under your page's root class (add one to the view's root if it has none, e.g. `class="hrxPageHome"`). Do not edit `css/style.css` - other pages are being changed at the same time. `i18n/i18n.properties` is shared: only add/change your own keys, with Edit; if an edit fails because the file changed, re-read and retry.
5. **Icons.** The design uses Tabler icon-font glyphs (`ti ti-*`) and inline SVGs. Where the design uses an inline SVG, you may reuse that exact SVG: save it under `webapp/img/icons/<page>-<name>.svg` and draw it with a CSS mask (see `.sapTntNLIIcon` in css/style.css for the pattern). For `ti` glyphs use the closest SAP icon at the design's size and colour.
6. **No git.** Do not commit, push, stash, checkout, reset or otherwise change git state. The lead reviews and commits.
7. **Shared local test environment - do not restart it.** A preview server runs at http://localhost:8088 and a local HRX test service at http://localhost:4004 (in-memory database, test records only). Never start, stop or restart them (others use them); if one is down, stop and report. You may add local test records so your page has content, e.g. with curl as a mock user: `curl -u sam.evans@example.test: -H 'Content-Type: application/json' -X POST http://localhost:4004/hrx/<EntitySet> -d '{...}'`, or through the app's own model code inside `app.js --eval`. Never touch real BTP services or any credentials (.env files are off limits).

## Tools (in `/private/tmp/claude-501/-Users-davidakilapa-Documents-GitHub-HRXDROP2/f7e1a2d5-d9d9-4829-b70a-a7d511ec44cd/scratchpad/tools`)
Run them from that directory. Keep your own screenshots in a sub-folder named after your page (e.g. `shots-home/`).

- Design: `node design.js <view> <out.png> [--role employee] [--full] [--eval "<js run after opening the view, e.g. clicking a button to open a modal>"] [--measure '["css selector", ...]']`
  Views (`data-view`): dashboard, timesheet, leave, teamcal, mydocs (Policies to read), explorer, sickness, documents, tsreport, utilisation, resources, clients, projects.
- App: `node app.js <email> <route> <out.png> [--full] [--eval "<js>"] [--measure '[...]']` - prints the app's own errors (launchpad sandbox noise filtered).
  Test users: `sam.evans@example.test` (manager), `kyle.barnfield@example.test` (employee), `dan.barton@example.test` (manager).
  Routes: "" (home), timesheet, leave, teamcalendar, policies, explorer, sickness, documents, timesheetreporting, `timesheetreporting?tab=util`, manageresources, manageclients, manageprojects.
  The app screenshot is cropped to the same 1440x1000 area as the design (the launchpad's 52px bar is above it); `--measure` y values are relative to that area too, so they compare directly with design.js.
- Side by side: `../venv2/bin/python compare.py design.png app.png out.png [x0 y0 x1 y1]` then look at out.png with the Read tool.

## How to work
1. Render the design view(s) and the app page(s), as manager and employee. Write down every difference.
2. Fix them (views/fragments + your css/pages file + controller where the layout needs data shaped differently).
3. Check with side-by-side images and `--measure` of the key elements (cards, headers, tables, buttons, pills): positions and sizes within ~2px of the design, same fonts/colours/radii. Open the design's dialogs for your page and match them too.
4. Check function against the local service: the page loads with no app errors, and the main actions (save, create, approve, filter, open dialogs...) still work and reach the service.
5. If the tool `mcp__ui5-mcp-server__run_ui5_linter` is available, run it on your files (projectDir `/Users/davidakilapa/Documents/GitHub/HRXDROP2/hrx2026`) and fix anything new.

## Report (your final message)
- Files changed, and why for anything outside your own page.
- Differences you could not match and why (e.g. a UI5 control limitation, no service for that data).
- Functional checks you ran and their results.
- Paths of your final side-by-side compare images (design left, app right).

## Updates from the lead (read these - they override anything above)
1. **Email: never send real email.** The original HRX service code sends real Office 365 email on leave requests/decisions. The local test service now blocks ALL email (a stand-in nodemailer; every send is only logged as "[email blocked - local test]"). Never work around that, never start another copy of the service, and never use real colleague addresses. Test users are now made up: `sam.evans@example.test` (manager), `kyle.barnfield@example.test` (employee), `dan.barton@example.test` (manager); others in the data: priya.shah@, tom.reid@, alex.morgan@example.test. Any records you create must use `@example.test` addresses.
2. **The test service was restarted** (in-memory, so earlier test records are gone). It now holds: Dan Barton (Director, Oswestry) manages Sam Evans and Alex Morgan; Sam manages Kyle Barnfield, Priya Shah (Aurangabad) and Tom Reid; all six leave types; client Croda with project "Croda UX Support" (Kyle and Priya assigned). Add what your page needs with curl as above (`-u sam.evans@example.test:`).
3. **Shared modal style.** Every dialog should use the design's modal: add `class="hrxModal"` to the Dialog (`hrxModal hrxModalWide` for the design's .modal.wide), buttons `class="hrxModalBtn hrxModalBtnPrimary|hrxModalBtnDanger|hrxModalBtnGhost"` with the action as beginButton and Cancel (ghost) as endButton, body text `hrxModalText` (.modal-p), field labels `hrxModalLabel` (label.f). Defined in css/style.css - do not redefine it in your page file.
4. **Gotchas found on Team Calendar** (see css/pages/teamcalendar.css for working examples): the theme's compact rules beat class selectors on sap.m.Table cells, toolbar buttons and dialog bars - use `td.sapMListTblCell`, `th.sapMListTblHeaderCell` with !important for paddings; sap.m.Button's outer `.sapMBtnInner` keeps a 14px font that sets its line box, so set the design's font-size and line-height on `.sapMBtnInner` too; sap.m.Select/Input/SearchField get 3px margins in some containers (set margin: 0); FlexBox item wrappers add height - use `renderType="Bare"` (then give the box `display:flex` yourself) where a row comes out taller than the design.
5. `app.js` now waits for the page title before measuring, so screenshots are reliable.
