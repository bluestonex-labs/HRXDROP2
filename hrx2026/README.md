# HRX2026

## Backend

The app's backend is the **HRX service** (`bsx-hrx-srv`, OData V4, CAP), reached at `/hrx`.

| Running as | `/hrx` goes to |
| --- | --- |
| Deployed on BTP | the `hrxservice` destination (`xs-app.json`), which `mta.yaml` creates with the app: `OAuth2UserTokenExchange` against the service's own XSUAA (`bsx-hrx-xsuaa`), so the service receives the signed-in user |
| Local preview (`npm run start-noflp`) | `http://localhost:4004` (`ui5.yaml`) - a local copy of the HRX service |
| Local preview without the CAP project (`npm run start-hrx`) | `mock/` (`ui5-hrx.yaml`): with `HRX_TOKEN=<bearer token>` it proxies to the deployed service; without, an in-memory stand-in with the service's entities, functions, actions and response shapes answers (development only - not part of the app, never deployed) |

Writes to `/hrx` carry an `X-CSRF-Token` (`model/Hrx.js`), as the approuter route requires.

Pictures and client logos are SAP Document Management documents (`ImageObjectID` / `LogoObjectID`):
the app shows them through the `/browser` route (destination `dms_service`), and stores new ones
through the HRX service's `Documents` entity.

The deployed service only answers a signed-in user, so a local preview needs its own copy of the
service running on port 4004 (`cds watch` in the CAP project).

### Previewing with real data in Business Application Studio

A BAS dev space runs inside the BTP subaccount, so its preview can reach both services through the
subaccount's destinations instead of a local copy:

1. Open a SAP Fiori dev space, clone the repository and check out `Joes-Branc`.
2. `cd hrx2026 && npm install`
3. `npm run start-bas` (uses `ui5-bas.yaml`: `/hrx` through `hrxservices`, `/services` through
   `bsxorgappsservices`).

For BAS to offer a destination, it needs these additional properties in the BTP cockpit:
`WebIDEEnabled = true`, `WebIDEUsage = odata_gen`, `HTML5.DynamicDestination = true`. A BAS
preview has no approuter in front of it, so the app uses its development identity unless told
otherwise: change the preview url's `#app-preview` to `#app-preview?email=<your email>` to load your
own employee record (or use the "View as (demo)" switch for full access).

### How the pages use it

The pages were written against the older xsjs commands (`timesheet.xsjs?cmd=fetch`, ...) and the
`services.xsodata` OData V2 service. Rather than rewrite every page, `model/Backend.js` hands their
calls to `model/HrxLegacy.js`, which answers them from `/hrx` in the shapes the pages already read.
`Backend.USE_HRX` switches this on and off.

Some data has no home in the HRX service and still comes from the original services
(`bsxorgappsservices`): client SLAs, licensed apps and components, BTP services, client support
users, project attachments and project tasks. Sickness trigger reviews and return-to-work
checklists have no home anywhere yet (see `model/SicknessService.js`).

| File | What it does |
| --- | --- |
| `model/Hrx.js` | Small client for the HRX service: paged reads, create, update, delete, functions, actions |
| `model/HrxTime.js` | People, bookings, projects, rates, and each person's expected hours |
| `model/HrxLegacy.js` | Answers the old xsjs commands and OData reads from `/hrx` |
| `model/TimesheetReportService.js` | Timesheet Reporting's reads |
| `model/SicknessService.js` | Sickness absences (as Sick leave) and the parts still to be stored |
| `model/DocumentService.js` | Documents and acknowledgements - the contract for the DMS service still to be built (`ENDPOINT` unset until then) |

### How the HRX service's data is read (checked against its handlers, `srv/hrx-services.js`)

- **Leave status** is `Leaves.Status_ID`: requested `e7ab05aa-…`, approved `e7ab02da-…`, rejected
  `e7ab06f4-…` (`HrxTime.LEAVE_STATUS`). `actionOnLeave` changes `Status_ID` and never `WFFlag`, so
  the state is read from `Status_ID`; `WFFlag` is only a fallback for a row without a known status.
  Lists of requests waiting for a decision filter on the requested status.
- **Project types.** Every project is billable except `INT` (internal) - as the service counts
  utilisation and bonus - and `FOC` (free of charge) (`HrxTime.isBillable`).
- **Leave year** is April to March, as `fetchUserLeave` counts it (`leaveYear` in `model/HrxLegacy.js`).
- **Leave rows** are one per day; each row's `NoOfDays` is that day (1 or 0.5).
- **Client location** is a site's ID in `Clients.BaseSite`; the pages show and edit the site's name.

### Services still needed

These parts of the pages have no HRX endpoint. Nothing is made up for them: they show empty states
or "not connected yet", or still use the original services.

| Needed for | Where | Today |
| --- | --- | --- |
| Policies & acknowledgements (`Policies`, `PolicyAcknowledgements`, `fetchMyPolicies()`, `acknowledgePolicy`, `fetchPolicyAcknowledgements`, Documents type `Policy`) | Policies to read, Documents, Home tile, notifications | Not connected (`DocumentService.ENDPOINT` unset) |
| Sickness follow-up (`SicknessReviews`, `ReturnToWork`) | Sickness - trigger reviews, return-to-work checklists | Not connected (`SicknessService.ENDPOINT` unset); absences themselves are real Sick leave |
| Client support users, SLAs, licensed components, application services (`ClientUsers`, `ClientSLAs`, `ClientComponents`, `ClientApplications`) | Manage Clients tabs | Original services (`supportx/*.xsjs`, `services.xsodata`) |
| Project areas / tasks, client team, attachments (`ProjectAreas`, `ProjectClientTeam`, Documents type `Project`) | Manage Projects | Original services |
| Reminders (`sendReminder`) and a stored notification list | Remind buttons, the bell | Reminders open an email draft; the bell is worked out from live data, read state kept in the browser |
| `Users.JobTitle`, `Contacts.FirstName` / `LastName`, `UserToProject.DayCost` | Team Calendar / Manage Resources, Manage Clients contact, Manage Projects resourcing | Not held |
