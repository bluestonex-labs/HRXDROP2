// Local test timesheets for the in-memory HRX service (run after seed-for-app.js; never
// deployed). Books weekdays from 1 Sep to 16 Oct 2026: Kyle and Priya on the billable
// Croda UX Support, Tom on an internal project, Kyle one day a week on it too.
// Every address is made up (@example.test).
const BASE = "http://localhost:4004/hrx";
const SAM = "sam.evans@example.test";
const auth = "Basic " + Buffer.from(SAM + ":").toString("base64");
async function call(sMethod, sPath, oBody) {
	const oResponse = await fetch(BASE + "/" + sPath, { method: sMethod, headers: { Authorization: auth, "Content-Type": "application/json" }, body: oBody ? JSON.stringify(oBody) : undefined });
	const oJson = await oResponse.json().catch(() => ({}));
	if (oResponse.status >= 300) { throw new Error(sPath + " " + oResponse.status + " " + JSON.stringify(oJson)); }
	return oJson;
}
const isoDate = (oDate) => oDate.toISOString().slice(0, 10);
(async () => {
	const oOrg = (await call("GET", "Organisations")).value[0];
	const aUsers = (await call("GET", "Users")).value;
	const user = (sFirst) => aUsers.find((o) => o.FirstName === sFirst);
	const oCroda = (await call("GET", "Projects?$filter=ProjectDesc eq 'Croda UX Support'")).value[0];
	const oSite = (await call("GET", "Sites")).value[0];
	const oScheme = (await call("GET", "BillingScheme?$filter=BillingDesc eq 'Internal billing'")).value[0];

	// An internal project for Bluestonex itself
	const oBsx = await call("POST", "Clients", { OrgID_ID: oOrg.ID, ClientName: "Bluestonex", BaseSite: oSite.ID, IsActive: true });
	const oInternal = await call("POST", "Projects", { OrgID_ID: oOrg.ID, ClientID_ID: oBsx.ID, ProjectDesc: "BSX Internal Development", ProjectType: "INT", IsActive: true, IsTimeBookingAllowed: true, StartDate: "2026-01-01" });
	for (const sFirst of ["Tom", "Kyle"]) {
		await call("POST", "UserToProject", { Employee_EmployeeID: user(sFirst).EmployeeID, Project_ID: oInternal.ID, BillingID_ID: oScheme.ID, DayRate: "0", BillableDays: "0", TotalCharge: "0", IsActive: true });
	}

	let iBooked = 0;
	for (let oDay = new Date("2026-09-01T00:00:00Z"); oDay <= new Date("2026-10-16T00:00:00Z"); oDay.setUTCDate(oDay.getUTCDate() + 1)) {
		const iWeekday = oDay.getUTCDay();
		if (iWeekday === 0 || iWeekday === 6) {
			continue;
		}
		const aBookings = [
			[iWeekday === 5 ? "Kyle" : null, oInternal, "Team tooling"],
			[iWeekday !== 5 ? "Kyle" : null, oCroda, "UX review"],
			["Priya", oCroda, "Prototype build"],
			["Tom", oInternal, "Internal platform work"]
		];
		for (const [sFirst, oProject, sComment] of aBookings) {
			if (!sFirst) {
				continue;
			}
			await call("POST", "TimeLog", { Project_ID: oProject.ID, Employee_EmployeeID: user(sFirst).EmployeeID, Date: isoDate(oDay), Hours: "07:30:00", Comment: sComment });
			iBooked++;
		}
	}
	console.log(iBooked + " time bookings");
})().catch((oError) => { console.error(oError.message); process.exit(1); });
