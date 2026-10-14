# HRX2026

## Backend

The app's backend is the **HRX service** (`bsx-hrx-srv`, OData V4, CAP), reached at `/hrx`.

| Running as | `/hrx` goes to |
| --- | --- |
| Deployed on BTP | the `hrxservice` destination (`xs-app.json`), which `mta.yaml` creates with the app: `OAuth2UserTokenExchange` against the service's own XSUAA (`bsx-hrx-xsuaa`), so the service receives the signed-in user |
| Local preview (`npm run start-noflp`) | `http://localhost:4004` (`ui5.yaml`) - a local copy of the HRX service |

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

### Drop 2 services (HRXService pull request #34)

The pages below use HRX services added in `bluestonex-labs/HRXService` pull request #34. The app
checks which of them are deployed when it starts (`model/HrxServices.js` reads the service's
`$metadata`; the answers are also in the component model `services`). Until a service is
deployed, its page keeps its earlier behaviour and shows a "Service needed" note; once it is,
the page uses it and the note goes - no app change needed.

| What | HRX service | Pages | App code |
| --- | --- | --- | --- |
| Policies and acknowledgements (whole organisation) | `Policies`, `PolicyAcknowledgements`, `acknowledgePolicy`, `removePolicy`; file via `Documents` type `Policy` | Policies to read, Documents, Home tile, notifications | `model/DocumentService.js` |
| Sickness follow-up | `SicknessReviews`, `ReturnsToWork`, `reviewSicknessTrigger`, `openReturnToWork`, `completeReturnToWorkStep`, `completeReturnToWork` | Sickness, Home tile | `model/SicknessService.js` |
| Client support users, SLAs, components, application services | `ClientUsers`, `ClientSLAs`, `ClientComponents`, `ClientApplications` | Manage Clients tabs | `model/HrxLegacyClients.js` |
| Project areas, client team, attachments | `ProjectAreas`, `ProjectAreaAssignments`, `ResourceAreaAssignments`, `ProjectClientTeam`, `fetchProjectDocuments`, `deleteProjectDocument`; files via `Documents` type `Project` | Manage Projects | `model/HrxLegacyProjects.js` |
| Reminders | `sendReminder` (falls back to an email draft until email is set up on the service) | Documents, Timesheet Reporting, Sickness | `model/Reminders.js` |
| Notification read state | `fetchReadNotifications`, `markNotificationsRead` | The bell | `model/NotificationService.js` |
| Job title, client contact name, day cost | `Users.JobTitle`, `Contacts.FirstName` / `LastName`, `UserToProject.DayCost` | Manage Resources, Team Calendar, Sickness, Manage Clients, Manage Projects | `model/HrxLegacy.js` |

Software, components, apps and services on the client tabs are names typed in (the lists
suggest the names already used); nothing is copied from the original services.
