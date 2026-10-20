// Local test records for checking every page against real rows (run after seed-for-app.js
// and seed-timesheets.js; never deployed). Everything goes in through the same service
// calls the app makes, so the records look exactly like ones the app saved:
//  - pictures for Sam, Kyle and Priya and a logo for Croda (Dan, Tom and Alex keep
//    their initials), stored in the fake Document Management server;
//  - leave in every state: Kyle's own request waiting for Sam, an approved request,
//    an approved half day, Tom's rejected day and booked days, Priya's approved day;
//  - sickness: three absences for Tom (a policy trigger) and one for Priya with a
//    return-to-work checklist, plus a logged review;
//  - a bank holiday, two published policies (one acknowledged by Kyle);
//  - Croda's contact, support users, service levels, a component and an
//    application service; project areas, a client team member and a project file.
// Every address is made up (@example.test) - and the test service blocks all email.
const zlib = require("zlib");

const BASE = "http://localhost:4004/hrx";
const SAM = "sam.evans@example.test";
const KYLE = "kyle.barnfield@example.test";

async function call(sUser, sMethod, sPath, vBody, mHeaders) {
	const bForm = vBody instanceof FormData;
	const oResponse = await fetch(BASE + "/" + sPath, {
		method: sMethod,
		headers: Object.assign({ Authorization: "Basic " + Buffer.from(sUser + ":").toString("base64") }, bForm ? {} : { "Content-Type": "application/json" }, mHeaders || {}),
		body: vBody === undefined ? undefined : (bForm ? vBody : JSON.stringify(vBody))
	});
	const oJson = await oResponse.json().catch(() => ({}));
	if (oResponse.status >= 300) {
		throw new Error(sMethod + " " + sPath + " " + oResponse.status + " " + JSON.stringify(oJson));
	}
	return oJson;
}
const get = async (sPath) => (await call(SAM, "GET", sPath)).value;

// A plain square PNG in one colour: enough to tell a picture from initials.
function png(iRed, iGreen, iBlue) {
	const iSize = 64;
	const crcTable = Array.from({ length: 256 }, (_, n) => {
		let c = n;
		for (let k = 0; k < 8; k++) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		}
		return c >>> 0;
	});
	const crc = (oBuffer) => {
		let c = 0xffffffff;
		for (const iByte of oBuffer) {
			c = crcTable[(c ^ iByte) & 0xff] ^ (c >>> 8);
		}
		return (c ^ 0xffffffff) >>> 0;
	};
	const chunk = (sType, oData) => {
		const oLength = Buffer.alloc(4);
		oLength.writeUInt32BE(oData.length);
		const oTypeAndData = Buffer.concat([Buffer.from(sType), oData]);
		const oCrc = Buffer.alloc(4);
		oCrc.writeUInt32BE(crc(oTypeAndData));
		return Buffer.concat([oLength, oTypeAndData, oCrc]);
	};
	const oHeader = Buffer.alloc(13);
	oHeader.writeUInt32BE(iSize, 0);
	oHeader.writeUInt32BE(iSize, 4);
	oHeader.set([8, 2, 0, 0, 0], 8);
	const oRow = Buffer.concat([Buffer.from([0]), Buffer.from(Array(iSize).fill([iRed, iGreen, iBlue]).flat())]);
	const oPixels = zlib.deflateSync(Buffer.concat(Array(iSize).fill(oRow)));
	return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", oHeader), chunk("IDAT", oPixels), chunk("IEND", Buffer.alloc(0))]);
}

// As the app's Hrx.upload: PUT the file to Documents(objectID, objectType, objectFolderID)/content.
function upload(sType, sId, oContent, sFileName, sMime) {
	const oForm = new FormData();
	oForm.append("file", new Blob([oContent], { type: sMime }), sFileName);
	return call(SAM, "PUT", "Documents(objectID='" + sId + "',objectType='" + sType + "',objectFolderID='')/content", oForm);
}

const day = (sDate, oFields) => Object.assign({ StartDate: sDate, EndDate: sDate, DayTime: "Full Day", NoOfDays: "1", IsPaid: true }, oFields);

(async () => {
	const oOrg = (await get("Organisations"))[0];
	const aUsers = await get("Users");
	const user = (sFirst) => aUsers.find((o) => o.FirstName === sFirst).EmployeeID;
	const aTypes = await get("LeaveType");
	const type = (sName) => aTypes.find((o) => o.LeaveCategoryDesc === sName).ID;
	const oCroda = (await get("Clients?$filter=ClientName eq 'Croda'"))[0];
	const oProject = (await get("Projects?$filter=ProjectDesc eq 'Croda UX Support'"))[0];
	const oSite = (await get("Sites?$filter=SiteDesc eq 'Oswestry'"))[0];

	// ── Pictures and a logo ──
	await upload("User", user("Sam"), png(37, 99, 235), "sam.png", "image/png");
	await upload("User", user("Kyle"), png(16, 185, 129), "kyle.png", "image/png");
	await upload("User", user("Priya"), png(217, 70, 239), "priya.png", "image/png");
	await upload("Client", oCroda.ID, png(14, 165, 233), "croda.png", "image/png");

	// ── Leave ──
	// Kyle asks for Thu 29 - Fri 30 Oct (waiting for Sam) and had 14 - 15 Sep, which Sam approved
	const oHoliday = { LeaveCategoryId_ID: type("Holiday"), ApprovalRequired: true, ApproverID_EmployeeID: user("Sam") };
	await call(KYLE, "POST", "createLeaveRequest", { userLog: [day("2026-10-29", Object.assign({ RequesterComments: "Half-term" }, oHoliday)), day("2026-10-30", Object.assign({ RequesterComments: "Half-term" }, oHoliday))] });
	await call(KYLE, "POST", "createLeaveRequest", { userLog: [day("2026-09-14", Object.assign({ RequesterComments: "Wedding" }, oHoliday)), day("2026-09-15", Object.assign({ RequesterComments: "Wedding" }, oHoliday))] });
	// ... and a morning off on Fri 23 Oct
	await call(KYLE, "POST", "createLeaveRequest", { userLog: [day("2026-10-23", Object.assign({ DayTime: "AM", NoOfDays: "0.5", RequesterComments: "Dentist" }, oHoliday))] });
	const aKyleToApprove = await get("Leaves?$filter=EmpID_EmployeeID eq '" + user("Kyle") + "' and (StartDate eq 2026-09-14 or StartDate eq 2026-09-15 or StartDate eq 2026-10-23)");
	await call(SAM, "POST", "actionOnLeave", { LeaveLog: aKyleToApprove.map((o) => ({ ID: o.ID, WFFlag: true, ApproverComments: "" })) });
	// Tom: Mon 2 - Tue 3 Nov booked by Sam (a manager's booking is approved straight
	// away), Mon 12 Oct rejected
	await call(SAM, "POST", "createLeaveRequestForTeamCalendar", { userLog: [day("2026-11-02", Object.assign({}, oHoliday, { EmpID_EmployeeID: user("Tom"), RequesterComments: "Family visit" })), day("2026-11-03", Object.assign({}, oHoliday, { EmpID_EmployeeID: user("Tom"), RequesterComments: "Family visit" }))] });
	await call(SAM, "POST", "createLeaveRequestForTeamCalendar", { userLog: [day("2026-10-12", Object.assign({}, oHoliday, { EmpID_EmployeeID: user("Tom"), RequesterComments: "Short notice" }))] });
	// Priya: Wed 21 Oct, booked and approved by Sam
	await call(SAM, "POST", "createLeaveRequestForTeamCalendar", { userLog: [day("2026-10-21", Object.assign({}, oHoliday, { EmpID_EmployeeID: user("Priya"), ApprovalRequired: false, RequesterComments: "Diwali" }))] });
	const aTom = await get("Leaves?$filter=EmpID_EmployeeID eq '" + user("Tom") + "'");
	const aPriya = await get("Leaves?$filter=EmpID_EmployeeID eq '" + user("Priya") + "'");
	await call(SAM, "POST", "actionOnLeave", { LeaveLog: aPriya.map((o) => ({ ID: o.ID, WFFlag: true, ApproverComments: "" })) });
	await call(SAM, "POST", "actionOnLeave", { LeaveLog: aTom.filter((o) => o.StartDate === "2026-10-12").map((o) => ({ ID: o.ID, WFFlag: false, ApproverComments: "Release week" })) });

	// ── Sickness, as the Sickness page records it ──
	const sick = (sFirst, aDates, sReason) => call(SAM, "POST", "createLeaveRequestForTeamCalendar", {
		userLog: aDates.map((sDate) => day(sDate, {
			EmpID_EmployeeID: user(sFirst), LeaveCategoryId_ID: type("Sick"), NoOfDays: String(aDates.length), ApprovalRequired: false,
			ApproverID_EmployeeID: user("Sam"), RequesterComments: sReason, LeaveGrpID: crypto.randomUUID(), WFFlag: null
		}))
	});
	await sick("Tom", ["2026-09-08"], "Migraine");
	await sick("Tom", ["2026-09-22", "2026-09-23"], "Flu");
	await sick("Tom", ["2026-10-06"], "Back pain");
	await sick("Priya", ["2026-10-19"], "Cold");
	await call(SAM, "POST", "openReturnToWork", { EmployeeID: user("Priya"), Steps: [
		{ StepNo: 1, Text: "Return-to-work interview", Done: true },
		{ StepNo: 2, Text: "Fit note received", Done: false },
		{ StepNo: 3, Text: "Adjustments agreed", Done: false }
	] });
	await call(SAM, "POST", "reviewSicknessTrigger", { EmployeeID: user("Tom"), FiscalYear: 2026, Status: "EMAILED", Note: "Policy reminder sent", InstanceCount: 2 });

	// ── A bank holiday ──
	await call(SAM, "POST", "BankHolidays", { Org_ID: oOrg.ID, Site_ID: oSite.ID, Date: "2026-12-25", Day: "Friday", HolidayDesc: "Christmas Day" });

	// ── Policies ──
	const oPdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
	const oHandbook = await call(SAM, "POST", "Policies", { Name: "Employee Handbook 2026", Category: "Handbook", AckRequired: true });
	await upload("Policy", oHandbook.ID, oPdf, "employee-handbook-2026.pdf", "application/pdf");
	const oExpenses = await call(SAM, "POST", "Policies", { Name: "Expenses Procedure", Category: "Procedure", AckRequired: false });
	await upload("Policy", oExpenses.ID, oPdf, "expenses-procedure.pdf", "application/pdf");
	await call(KYLE, "POST", "acknowledgePolicy", { PolicyID: oHandbook.ID });

	// ── Croda: contact, support users, service levels, component, application service ──
	await call(SAM, "POST", "Contacts", { ObjectType: "C", ObjectID: oCroda.ID, FirstName: "Ava", LastName: "Patel", WorkEmail: "ava.patel@example.test", MobileNo: "+44 1234 567890", IsActive: true });
	const oBen = await call(SAM, "POST", "ClientUsers", { Client_ID: oCroda.ID, FirstName: "Ben", LastName: "Hart", Email: "ben.hart@example.test", Mobile: "+44 1234 000111", IsActive: true, IsAdmin: true });
	await call(SAM, "POST", "ClientUsers", { Client_ID: oCroda.ID, FirstName: "Cara", LastName: "Lee", Email: "cara.lee@example.test", IsActive: true, IsAdmin: false });
	for (const [sSeverity, iResponse, iResolution] of [["Very High", 1, 4], ["High", 4, 24], ["Medium", 8, 72], ["Low", 24, 120]]) {
		await call(SAM, "POST", "ClientSLAs", { Client_ID: oCroda.ID, Severity: sSeverity, ResponseHours: iResponse, ResolutionHours: iResolution });
	}
	await call(SAM, "POST", "ClientComponents", { Client_ID: oCroda.ID, Software: "SAP S/4HANA", Component: "FI", SubComponent: "GL", ValidFrom: "2026-01-01", ValidTill: "2026-12-31", IsSupported: true, SystemNo: "000012345", SAPVersion: "2023 FPS02" });
	await call(SAM, "POST", "ClientApplications", { Client_ID: oCroda.ID, AppName: "HRX", ServiceName: "Support", ValidFrom: "2026-01-01", ValidTill: "2026-12-31", DeployedVersion: "1.4.0" });

	// ── Project areas, Kyle's area, Ben on the client team, a project file ──
	const aAreas = [];
	for (const sArea of ["Basis", "Development", "UX"]) {
		aAreas.push(await call(SAM, "POST", "ProjectAreas", { AreaName: sArea, IsActive: true }));
	}
	await call(SAM, "POST", "setProjectAreas", { ProjectID: oProject.ID, AreaIDs: [aAreas[1].ID, aAreas[2].ID] });
	await call(SAM, "POST", "setResourceAreas", { ProjectID: oProject.ID, EmployeeID: user("Kyle"), AreaIDs: [aAreas[2].ID] });
	await call(SAM, "POST", "ProjectClientTeam", { Project_ID: oProject.ID, ClientUser_ID: oBen.ID, IsActive: true });
	await upload("Project", oProject.ID, oPdf, "statement-of-work.pdf", "application/pdf");

	console.log("Rich test records added");
})().catch((oError) => {
	console.error(oError.message);
	process.exit(1);
});
