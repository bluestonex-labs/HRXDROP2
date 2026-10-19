// Local test records for the in-memory HRX service (never deployed; for the app test only).
// Every address is made up (@example.test) - and the test service blocks all email anyway.
const BASE = "http://localhost:4004/hrx";
const SAM = "sam.evans@example.test";
const auth = "Basic " + Buffer.from(SAM + ":").toString("base64");
async function post(sPath, oBody) {
	const oResponse = await fetch(BASE + "/" + sPath, { method: "POST", headers: { Authorization: auth, "Content-Type": "application/json" }, body: JSON.stringify(oBody) });
	const oJson = await oResponse.json().catch(() => ({}));
	if (oResponse.status >= 300) { throw new Error(sPath + " " + oResponse.status + " " + JSON.stringify(oJson)); }
	return oJson;
}
(async () => {
	const oOrg = await post("Organisations", { OrgDesc: "Bluestonex" });
	const oOswestry = await post("Sites", { OrgID_ID: oOrg.ID, SiteDesc: "Oswestry" });
	const oAurangabad = await post("Sites", { OrgID_ID: oOrg.ID, SiteDesc: "Aurangabad" });
	const user = (sFirst, sLast, sTitle, oSite, oManager) => post("Users", {
		OrgID_ID: oOrg.ID, FirstName: sFirst, LastName: sLast, WorkEmail: (sFirst + "." + sLast).toLowerCase() + "@example.test",
		IsActive: true, BaseSite_ID: oSite.ID, UserType: "S", JobTitle: sTitle, Manager_EmployeeID: oManager ? oManager.EmployeeID : null
	});
	const oDan = await user("Dan", "Barton", "Director", oOswestry, null);
	const oSam = await user("Sam", "Evans", "SAP Consultant", oOswestry, oDan);
	const oKyle = await user("Kyle", "Barnfield", "Developer", oOswestry, oSam);
	const oPriya = await user("Priya", "Shah", "Consultant", oAurangabad, oSam);
	const oTom = await user("Tom", "Reid", "Consultant", oOswestry, oSam);
	const oAlex = await user("Alex", "Morgan", "UX Designer", oOswestry, oDan);
	for (const oUser of [oDan, oSam, oKyle, oPriya, oTom, oAlex]) {
		await post("WorkSchedule", { EmployeeID_EmployeeID: oUser.EmployeeID, Mo: true, Tu: true, We: true, Th: true, Fr: true, Sa: false, Su: false, AnnualLeaveQuota: "25", TargetHrsPerWeek: "40:00", TargetUtilization: "80" });
	}
	for (const [sName, bAccountable] of [["Holiday", true], ["Sick", false], ["Compassionate", false], ["Maternity", false], ["Paternity", false], ["Unpaid", false]]) {
		await post("LeaveType", { OrgID_ID: oOrg.ID, LeaveCategoryDesc: sName, isAccountable: bAccountable });
	}
	const oClient = await post("Clients", { OrgID_ID: oOrg.ID, ClientName: "Croda", BaseSite: oOswestry.ID, IsActive: true });
	const oProject = await post("Projects", { OrgID_ID: oOrg.ID, ClientID_ID: oClient.ID, ProjectDesc: "Croda UX Support", ProjectType: "TNM", IsActive: true, IsTimeBookingAllowed: true, StartDate: "2026-01-01" });
	const oScheme = await post("BillingScheme", { Org_ID: oOrg.ID, BillingDesc: "Consultant", DayRate: "500", Currency: "GBP" });
	for (const oUser of [oKyle, oPriya]) {
		await post("UserToProject", { Employee_EmployeeID: oUser.EmployeeID, Project_ID: oProject.ID, BillingID_ID: oScheme.ID, DayRate: "500", BillableDays: "10", TotalCharge: "5000", IsActive: true });
	}
	console.log(JSON.stringify({ dan: oDan.EmployeeID, sam: oSam.EmployeeID, kyle: oKyle.EmployeeID, client: oClient.ID, project: oProject.ID }));
})().catch((oError) => { console.error(oError.message); process.exit(1); });
